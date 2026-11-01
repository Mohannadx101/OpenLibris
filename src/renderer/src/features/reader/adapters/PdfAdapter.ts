import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import type { Locator } from '@shared/reading'
import { loadPdfJs, type PdfJs } from '@renderer/lib/pdfjs'
import {
  clampZoom,
  computeLayout,
  positionAt,
  progressAt,
  scrollTopFor,
  stepZoom,
  visiblePages,
  type PageSize,
  type PdfLayout,
} from '../pdfLayout'
import type { ReaderAdapter, ReaderKey, ReaderPosition, TocItem } from './ReaderAdapter'
import styles from './PdfAdapter.module.css'

/** Zoom 1 fits the page width to the reading area; the fit is kept within these bounds. */
const MIN_FIT_SCALE = 0.2
const MAX_FIT_SCALE = 3
/** A page is drawn when it is within this many view-heights of the screen, and freed beyond the second. */
const RENDER_AHEAD = 1
const KEEP_AHEAD = 3
const MAX_PARALLEL_RENDERS = 2
/** Pixels in one page's canvas. Beyond this the picture is drawn a little softer, not larger. */
const MAX_CANVAS_PIXELS = 16_000_000
/** Fraction of the view that "next page" scrolls, so the last line stays on screen as a cue. */
const PAGE_SCROLL = 0.9
const SIZE_BATCH = 32
const WHEEL_ZOOM_INTERVAL_MS = 80

const PAGE_HREF = 'pdf-page:'

interface PageView {
  number: number
  el: HTMLDivElement
  /** Bumped whenever the page is freed or re-laid out, so work that finishes late can tell. */
  token: number
  renderedScale: number | null
  queuedScale: number | null
  renderTask: RenderTask | null
  textLayer: { cancel(): void } | null
}

export class PdfAdapter implements ReaderAdapter {
  private pdfjs: PdfJs | null = null
  private task: PDFDocumentLoadingTask | null = null
  private doc: PDFDocumentProxy | null = null

  private scroller: HTMLDivElement | null = null
  private pagesEl: HTMLDivElement | null = null
  private views: PageView[] = []
  private sizes: PageSize[] = []
  private layout: PdfLayout = { tops: [], heights: [], totalHeight: 0 }
  private zoom = 1
  private scale = 1

  private tocItems: TocItem[] = []
  private tocPages: number[] = []

  private pending: PageView[] = []
  private activeRenders = 0
  private scrollFrame = 0
  private resizeFrame = 0
  private resizeObserver: ResizeObserver | null = null
  private lastWheelZoom = 0
  private settling = false
  private ready = false
  private destroyed = false
  private latest: ReaderPosition | null = null
  private emitted = ''
  private readonly positionListeners = new Set<(position: ReaderPosition) => void>()
  private readonly keyListeners = new Set<(key: ReaderKey) => void>()

  constructor(private readonly container: HTMLElement) {}

  async open(url: string, initial: Locator | null): Promise<void> {
    const pdfjs = await loadPdfJs()
    if (this.destroyed) return
    this.pdfjs = pdfjs

    // Streaming from the book:// URL lets PDF.js fetch only the parts it needs (HTTP Range).
    const task = pdfjs.getDocument({ url, useSystemFonts: true, useWasm: false })
    this.task = task
    const doc = await task.promise
    if (this.destroyed) return
    this.doc = doc

    this.sizes = await this.measurePages(doc)
    if (this.destroyed) return
    if (this.sizes.length === 0) throw new Error('This PDF has no pages.')

    this.buildDom()
    const target = initial?.format === 'pdf' ? initial : { page: 1, offsetY: 0 }
    this.applyLayout({
      page: Math.min(Math.max(target.page, 1), this.sizes.length),
      offsetY: target.offsetY,
    })

    // The contents are not needed to show the page, so a broken outline must not stop reading.
    try {
      await this.loadOutline(doc)
    } catch (error) {
      console.warn('[reader] could not read the PDF outline', error)
    }
    if (this.destroyed) return

    // Settled: from here on, every position change is the reader's own.
    this.ready = true
    this.reportPosition(true)
    this.watchSize()
  }

  next(): Promise<void> {
    this.scrollByView(1)
    return Promise.resolve()
  }

  prev(): Promise<void> {
    this.scrollByView(-1)
    return Promise.resolve()
  }

  goTo(href: string): Promise<void> {
    if (href.startsWith(PAGE_HREF) && this.scroller) {
      const page = Number.parseInt(href.slice(PAGE_HREF.length), 10)
      if (Number.isFinite(page)) this.scroller.scrollTop = scrollTopFor(this.layout, page, 0)
    }
    return Promise.resolve()
  }

  toc(): TocItem[] {
    return this.tocItems
  }

  onPosition(listener: (position: ReaderPosition) => void): () => void {
    this.positionListeners.add(listener)
    return () => this.positionListeners.delete(listener)
  }

  onKey(listener: (key: ReaderKey) => void): () => void {
    this.keyListeners.add(listener)
    return () => this.keyListeners.delete(listener)
  }

  resize(): void {
    this.relayout()
  }

  zoomIn(): number {
    return this.setZoom(stepZoom(this.zoom, 1))
  }

  zoomOut(): number {
    return this.setZoom(stepZoom(this.zoom, -1))
  }

  zoomReset(): number {
    return this.setZoom(1)
  }

  destroy(): void {
    this.destroyed = true
    this.resizeObserver?.disconnect()
    cancelAnimationFrame(this.scrollFrame)
    cancelAnimationFrame(this.resizeFrame)
    for (const view of this.views) this.release(view)
    this.pending = []
    this.positionListeners.clear()
    this.keyListeners.clear()
    this.container.replaceChildren()
    this.scroller = null
    this.pagesEl = null
    void this.task?.destroy().catch(() => undefined)
    this.task = null
    this.doc = null
  }

  /** The size of every page at scale 1. Done up front so the scroll bar and positions are exact. */
  private async measurePages(doc: PDFDocumentProxy): Promise<PageSize[]> {
    const sizes: PageSize[] = []
    for (let start = 1; start <= doc.numPages; start += SIZE_BATCH) {
      const end = Math.min(start + SIZE_BATCH - 1, doc.numPages)
      const numbers = Array.from({ length: end - start + 1 }, (_, i) => start + i)
      const batch = await Promise.all(
        numbers.map(async (number) => {
          const page = await doc.getPage(number)
          const { width, height } = page.getViewport({ scale: 1 })
          return { width, height }
        }),
      )
      if (this.destroyed) return []
      sizes.push(...batch)
    }
    return sizes
  }

  private buildDom(): void {
    const scroller = document.createElement('div')
    scroller.className = styles.scroller ?? ''
    scroller.tabIndex = -1
    scroller.dataset['testid'] = 'pdf-scroller'

    const pagesEl = document.createElement('div')
    pagesEl.className = styles.pages ?? ''

    this.views = this.sizes.map((_, index) => {
      const el = document.createElement('div')
      el.className = styles.page ?? ''
      el.dataset['page'] = String(index + 1)
      pagesEl.append(el)
      return {
        number: index + 1,
        el,
        token: 0,
        renderedScale: null,
        queuedScale: null,
        renderTask: null,
        textLayer: null,
      }
    })

    scroller.append(pagesEl)
    this.container.replaceChildren(scroller)
    this.scroller = scroller
    this.pagesEl = pagesEl

    scroller.addEventListener('scroll', () => this.scheduleScroll(), { passive: true })
    scroller.addEventListener('wheel', (event) => this.onWheel(event), { passive: false })
  }

  /**
   * Lays every page out at the current zoom and puts `anchor` at the top of the view.
   * The anchor is a page and a fraction down it, so it means the same thing at any scale.
   */
  private applyLayout(anchor: { page: number; offsetY: number }): void {
    const scroller = this.scroller
    if (!scroller || this.sizes.length === 0) return

    const firstWidth = this.sizes[0]?.width ?? 1
    const room = scroller.clientWidth - 2 * 16
    const fit = Math.min(Math.max(room / firstWidth, MIN_FIT_SCALE), MAX_FIT_SCALE)
    this.scale = fit * this.zoom
    this.layout = computeLayout(this.sizes, this.scale)

    // Pictures drawn at the old scale are stale. Work on them is abandoned; the old picture
    // stays (stretched) until the new one is ready, so zooming never flashes blank pages.
    this.pending = []
    for (const view of this.views) {
      const size = this.sizes[view.number - 1]
      if (!size) continue
      view.token++
      view.renderTask?.cancel()
      view.renderTask = null
      view.textLayer?.cancel()
      view.textLayer = null
      view.queuedScale = null
      view.el.style.width = `${size.width * this.scale}px`
      view.el.style.height = `${size.height * this.scale}px`
      view.el.querySelector(`.${styles.textLayer}`)?.remove()
    }

    this.settling = true
    scroller.scrollTop = scrollTopFor(this.layout, anchor.page, anchor.offsetY)
    scroller.scrollLeft = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2)
    this.updateVisible()

    // The browser reports the scroll we just made a frame later; that is not the reader's doing.
    void nextFrame()
      .then(nextFrame)
      .then(() => {
        this.settling = false
        if (this.ready && !this.destroyed) this.reportPosition(true)
      })
  }

  private relayout(): void {
    if (!this.scroller || !this.ready) return
    const anchor = this.latest?.locator.format === 'pdf' ? this.latest.locator : null
    this.applyLayout(
      anchor ? { page: anchor.page, offsetY: anchor.offsetY } : { page: 1, offsetY: 0 },
    )
  }

  private setZoom(next: number): number {
    const zoom = clampZoom(next)
    if (zoom !== this.zoom) {
      this.zoom = zoom
      this.relayout()
    }
    return this.zoom
  }

  private onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return
    event.preventDefault() // Otherwise the whole app zooms.
    const now = performance.now()
    if (now - this.lastWheelZoom < WHEEL_ZOOM_INTERVAL_MS) return
    this.lastWheelZoom = now
    if (event.deltaY < 0) this.zoomIn()
    else if (event.deltaY > 0) this.zoomOut()
  }

  private scrollByView(direction: 1 | -1): void {
    const scroller = this.scroller
    if (!scroller) return
    scroller.scrollBy({ top: direction * scroller.clientHeight * PAGE_SCROLL })
  }

  private scheduleScroll(): void {
    if (this.scrollFrame) return
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0
      this.updateVisible()
      if (this.ready && !this.settling) this.reportPosition(false)
    })
  }

  private watchSize(): void {
    const scroller = this.scroller
    if (!scroller) return
    let first = true
    let lastWidth = scroller.clientWidth
    this.resizeObserver = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      // Height changes only reveal more or less of the page; only width changes the layout.
      const width = scroller.clientWidth
      if (width === lastWidth) {
        this.scheduleScroll()
        return
      }
      lastWidth = width
      cancelAnimationFrame(this.resizeFrame)
      this.resizeFrame = requestAnimationFrame(() => this.relayout())
    })
    this.resizeObserver.observe(scroller)
  }

  /** Draws the pages near the screen and frees the ones far from it. */
  private updateVisible(): void {
    const scroller = this.scroller
    if (!scroller) return
    const height = scroller.clientHeight
    const top = scroller.scrollTop

    const [drawFirst, drawLast] = visiblePages(
      this.layout,
      top - height * RENDER_AHEAD,
      top + height * (1 + RENDER_AHEAD),
    )
    const [keepFirst, keepLast] = visiblePages(
      this.layout,
      top - height * KEEP_AHEAD,
      top + height * (1 + KEEP_AHEAD),
    )
    const [centreFirst] = visiblePages(this.layout, top, top + height)

    const wanted: PageView[] = []
    for (const view of this.views) {
      if (view.number < keepFirst || view.number > keepLast) {
        if (view.renderedScale !== null || view.renderTask) this.release(view)
        continue
      }
      const inDrawZone = view.number >= drawFirst && view.number <= drawLast
      if (inDrawZone && view.renderedScale !== this.scale && view.queuedScale !== this.scale) {
        wanted.push(view)
      }
    }

    // The page on screen first, then outwards.
    wanted.sort((a, b) => Math.abs(a.number - centreFirst) - Math.abs(b.number - centreFirst))
    for (const view of wanted) {
      view.queuedScale = this.scale
      this.pending.push(view)
    }
    this.pending.sort((a, b) => Math.abs(a.number - centreFirst) - Math.abs(b.number - centreFirst))
    this.pump()
  }

  private pump(): void {
    while (this.activeRenders < MAX_PARALLEL_RENDERS && this.pending.length > 0) {
      const view = this.pending.shift()
      if (!view || view.queuedScale !== this.scale) continue
      this.activeRenders++
      void this.renderPage(view, view.token, this.scale)
        .catch((error) => console.warn(`[reader] page ${view.number} could not be drawn`, error))
        .finally(() => {
          this.activeRenders--
          if (view.queuedScale === this.scale && view.renderedScale !== this.scale) {
            view.queuedScale = null
          }
          if (!this.destroyed) this.pump()
        })
    }
  }

  private async renderPage(view: PageView, token: number, scale: number): Promise<void> {
    const { doc, pdfjs } = this
    if (!doc || !pdfjs) return
    const stale = () => this.destroyed || view.token !== token

    const page = await doc.getPage(view.number)
    if (stale()) return

    const cssViewport = page.getViewport({ scale })
    const dpr = window.devicePixelRatio || 1
    let outputScale = scale * dpr
    const pixels = cssViewport.width * cssViewport.height * dpr * dpr
    if (pixels > MAX_CANVAS_PIXELS) outputScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
    const viewport = page.getViewport({ scale: outputScale })

    const canvas = document.createElement('canvas')
    canvas.className = styles.canvas ?? ''
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) return

    const render = page.render({ canvasContext: context, canvas, viewport })
    view.renderTask = render
    try {
      await render.promise
    } catch (error) {
      if (isCancelled(error)) return
      throw error
    } finally {
      if (view.renderTask === render) view.renderTask = null
    }
    if (stale()) return

    // Swap in the finished picture in one step, so the page is never seen half drawn.
    view.el.replaceChildren(canvas)
    view.renderedScale = scale

    const layer = document.createElement('div')
    layer.className = styles.textLayer ?? ''
    layer.style.setProperty('--scale-factor', String(scale))
    layer.style.setProperty('--total-scale-factor', String(scale))
    view.el.append(layer)
    try {
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport: cssViewport,
      })
      view.textLayer = textLayer
      await textLayer.render()
    } catch (error) {
      // Selectable text is a convenience; the page itself is already showing. A page that was
      // freed or re-laid out while its text loaded cancels the work, which is not a failure.
      if (!stale() && !isCancelled(error))
        console.warn(`[reader] text of page ${view.number} unavailable`, error)
    }
  }

  private release(view: PageView): void {
    view.token++
    view.renderTask?.cancel()
    view.renderTask = null
    view.textLayer?.cancel()
    view.textLayer = null
    view.renderedScale = null
    view.queuedScale = null
    view.el.replaceChildren()
    this.pending = this.pending.filter((candidate) => candidate !== view)
  }

  private reportPosition(force: boolean): void {
    const scroller = this.scroller
    if (!scroller) return
    const { page, offsetY } = positionAt(this.layout, scroller.scrollTop)
    const rounded = Math.round(offsetY * 10_000) / 10_000
    const atBottom =
      page === this.sizes.length &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2

    const position: ReaderPosition = {
      locator: { format: 'pdf', page, offsetY: rounded },
      progress: progressAt(page, rounded, this.sizes.length, atBottom),
      href: this.chapterHref(page),
      pageCount: this.sizes.length,
    }
    this.latest = position

    const key = `${page}:${rounded}`
    if (!force && key === this.emitted) return
    this.emitted = key
    for (const listener of this.positionListeners) listener(position)
  }

  /** The contents entry the reader is under: the last one that starts on or before this page. */
  private chapterHref(page: number): string | null {
    let bestPage = -1
    for (const start of this.tocPages) if (start <= page && start > bestPage) bestPage = start
    if (bestPage === -1) return null
    const index = this.tocPages.indexOf(bestPage)
    return this.tocItems[index]?.href ?? null
  }

  private async loadOutline(doc: PDFDocumentProxy): Promise<void> {
    const outline = await doc.getOutline()
    if (!outline) return
    const items: TocItem[] = []
    const pages: number[] = []
    const visit = async (nodes: OutlineNode[], depth: number): Promise<void> => {
      for (const node of nodes) {
        const page = await this.pageOfDestination(doc, node.dest)
        if (page !== null) {
          const label = node.title.trim() || 'Untitled'
          items.push({ id: `${items.length}`, label, href: `${PAGE_HREF}${page}`, depth })
          pages.push(page)
        }
        if (node.items?.length) await visit(node.items, depth + 1)
      }
    }
    await visit(outline as OutlineNode[], 0)
    this.tocItems = items
    this.tocPages = pages
  }

  /** Resolves an outline destination (named or explicit) to a 1-based page number. */
  private async pageOfDestination(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
    try {
      let explicit = dest
      if (typeof explicit === 'string') explicit = await doc.getDestination(explicit)
      if (!Array.isArray(explicit)) return null
      const target: unknown = explicit[0]
      if (typeof target === 'number') return target + 1
      if (target && typeof target === 'object') {
        return (await doc.getPageIndex(target as Parameters<typeof doc.getPageIndex>[0])) + 1
      }
    } catch {
      // An entry that points nowhere is left out of the contents.
    }
    return null
  }
}

interface OutlineNode {
  title: string
  dest: unknown
  items?: OutlineNode[]
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}
