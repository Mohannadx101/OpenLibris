import ePub from 'epubjs'
import type { Book, Contents, Location, NavItem, Rendition } from 'epubjs'
import type { Locator } from '@shared/reading'
import { dirName, estimateProgress, resolveHref } from '../chapters'
import type { ReaderAdapter, ReaderKey, ReaderPosition, TocItem } from './ReaderAdapter'

/** How long resizing must pause before the reader is put back where it was. */
const RESIZE_SETTLE_MS = 250

/** Colours and type for the text inside the book. Phase 7 swaps these for real themes. */
const READING_STYLES = {
  html: { 'background-color': '#fffdf8' },
  body: {
    color: '#2b2620',
    'font-family': "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
    'line-height': '1.65',
    'font-size': '1.05rem',
  },
  a: { color: '#8a4b2a' },
  'img, svg': { 'max-width': '100% !important', 'max-height': '96vh !important' },
}

/** The pieces of epubjs that exist at runtime but are missing from its type definitions. */
interface BookInternals {
  spine: { length?: number }
  packaging?: { navPath?: string; ncxPath?: string }
}

export class EpubAdapter implements ReaderAdapter {
  private book: Book | null = null
  private rendition: Rendition | null = null
  private tocItems: TocItem[] = []
  private spineLength = 0
  private resizeObserver: ResizeObserver | null = null
  private resizeFrame = 0
  private resizing = false
  private anchor: string | null = null
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private ready = false
  private destroyed = false
  private latest: ReaderPosition | null = null
  private readonly positionListeners = new Set<(position: ReaderPosition) => void>()
  private readonly keyListeners = new Set<(key: ReaderKey) => void>()

  constructor(private readonly container: HTMLElement) {}

  async open(url: string, initial: Locator | null): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`The book file could not be read (${response.status}).`)
    const data = await response.arrayBuffer()
    if (this.destroyed) return

    // Passing the bytes (not a URL) keeps epubjs from making its own network requests.
    const book = ePub(data)
    this.book = book
    await book.ready
    if (this.destroyed) return

    const internals = book as unknown as BookInternals
    this.spineLength = internals.spine.length ?? 0

    const navigation = await book.loaded.navigation
    const navPath = internals.packaging?.navPath || internals.packaging?.ncxPath || ''
    this.tocItems = flattenToc(navigation.toc, dirName(navPath))
    if (this.destroyed) return

    const rendition = book.renderTo(this.container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
      // The book's own scripts never run. Reading does not need them.
      allowScriptedContent: false,
    })
    this.rendition = rendition

    rendition.themes.default(READING_STYLES)
    rendition.hooks.content.register((contents: Contents) => this.openLinksExternally(contents))
    rendition.on('keydown', (event: KeyboardEvent) => this.emitKey(event))
    rendition.on('relocated', (location: Location) => this.handleRelocated(location))

    const cfi = initial?.format === 'epub' ? initial.cfi : undefined
    try {
      await rendition.display(cfi)
    } catch (error) {
      if (cfi === undefined) throw error
      // The saved place no longer exists (the file changed, say). Start from the beginning.
      console.warn('[reader] saved position could not be shown, starting at the beginning', error)
      await rendition.display()
    }
    if (this.destroyed) return

    // Positions reported while the first page was still being shown are not the reader's
    // doing; report only the final one, so a half-finished restore can never be saved.
    this.ready = true
    if (this.latest) this.emitPosition(this.latest)

    this.watchContainerSize()
  }

  next(): Promise<void> {
    this.abandonResize()
    return this.rendition?.next() ?? Promise.resolve()
  }

  prev(): Promise<void> {
    this.abandonResize()
    return this.rendition?.prev() ?? Promise.resolve()
  }

  goTo(href: string): Promise<void> {
    this.abandonResize()
    return this.rendition?.display(href) ?? Promise.resolve()
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
    const { width, height } = this.container.getBoundingClientRect()
    if (width > 0 && height > 0) this.rendition?.resize(width, height)
  }

  destroy(): void {
    this.destroyed = true
    this.resizeObserver?.disconnect()
    cancelAnimationFrame(this.resizeFrame)
    clearTimeout(this.settleTimer)
    this.positionListeners.clear()
    this.keyListeners.clear()
    try {
      this.rendition?.destroy()
      this.book?.destroy()
    } catch (error) {
      console.warn('[reader] cleanup failed', error)
    }
    this.rendition = null
    this.book = null
  }

  private handleRelocated(location: Location): void {
    const start = location.start
    if (!start?.cfi) return

    this.latest = {
      locator: { format: 'epub', cfi: start.cfi },
      progress: estimateProgress({
        spineIndex: start.index,
        spineLength: this.spineLength,
        page: start.displayed?.page ?? 1,
        pageCount: start.displayed?.total ?? 0,
        atEnd: location.atEnd,
      }),
      href: start.href ?? null,
    }
    // While the window is being resized, EPUB.js reports places that are only provisional.
    if (this.ready && !this.resizing) this.emitPosition(this.latest)
  }

  private emitPosition(position: ReaderPosition): void {
    for (const listener of this.positionListeners) listener(position)
  }

  private emitKey(event: KeyboardEvent): void {
    const key: ReaderKey = {
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
    }
    for (const listener of this.keyListeners) listener(key)
  }

  /**
   * Links to websites open in the user's browser. The book's frame is sandboxed and cannot
   * open windows itself, so the click is handed to the app, which only opens https links.
   */
  private openLinksExternally(contents: Contents): void {
    contents.document.addEventListener('click', (event) => {
      const target = event.target as Element | null
      const link = target?.closest?.('a[href]')
      const href = link?.getAttribute('href') ?? ''
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    })
  }

  private watchContainerSize(): void {
    let first = true
    this.resizeObserver = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      this.beginResize()
    })
    this.resizeObserver.observe(this.container)
  }

  /**
   * Keeps the reader on the same text when the window or panel changes size.
   *
   * The text re-flows into a different number of pages. EPUB.js shows its own guess straight
   * away, while the new layout is still being built, and that guess is often a page or two
   * off. So: remember where the reader was when resizing began, ignore what EPUB.js reports
   * while it is busy, and once resizing has paused, show the remembered place again. That
   * second display works on a finished layout and is exact.
   */
  private beginResize(): void {
    if (!this.resizing) {
      this.resizing = true
      this.anchor = this.latest?.locator.format === 'epub' ? this.latest.locator.cfi : null
    }
    cancelAnimationFrame(this.resizeFrame)
    this.resizeFrame = requestAnimationFrame(() => this.resize())
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => void this.finishResize(), RESIZE_SETTLE_MS)
  }

  private async finishResize(): Promise<void> {
    const anchor = this.anchor
    this.anchor = null
    try {
      if (anchor && this.rendition && !this.destroyed) await this.rendition.display(anchor)
    } catch (error) {
      console.warn('[reader] could not return to the reading place after resizing', error)
    }
    // EPUB.js reports the new location a frame or two after displaying it.
    await nextFrame()
    await nextFrame()
    if (this.destroyed) return
    this.resizing = false
    if (this.latest) this.emitPosition(this.latest)
  }

  /** The reader moved on their own; the remembered place no longer applies. */
  private abandonResize(): void {
    clearTimeout(this.settleTimer)
    this.anchor = null
    this.resizing = false
  }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function flattenToc(items: NavItem[], baseDir: string, depth = 0): TocItem[] {
  const result: TocItem[] = []
  for (const item of items) {
    result.push({
      id: item.id || item.href,
      label: item.label.trim() || 'Untitled',
      href: resolveHref(baseDir, item.href),
      depth,
    })
    if (item.subitems?.length) result.push(...flattenToc(item.subitems, baseDir, depth + 1))
  }
  return result
}
