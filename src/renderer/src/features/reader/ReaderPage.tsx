import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Book } from '@shared/library'
import type { SavePositionInput } from '@shared/reading'
import { api, unwrap } from '@renderer/lib/api'
import { libraryFileUrl } from '@renderer/lib/libraryUrl'
import { EpubAdapter } from './adapters/EpubAdapter'
import { PdfAdapter } from './adapters/PdfAdapter'
import type { ReaderAdapter, ReaderKey, ReaderPosition, TocItem } from './adapters/ReaderAdapter'
import { chapterForHref, formatPercent } from './chapters'
import { TocPanel } from './components/TocPanel'
import { keyAction } from './keys'
import { PositionSaver } from './positionSaver'
import styles from './ReaderPage.module.css'

type Status = 'loading' | 'ready' | 'error'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<ReaderAdapter | null>(null)

  const [status, setStatus] = useState<Status>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [book, setBook] = useState<Book | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [position, setPosition] = useState<ReaderPosition | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [zoomable, setZoomable] = useState(false)
  const [zoom, setZoom] = useState(1)

  const handleKey = useCallback((key: ReaderKey) => {
    const action = keyAction(key)
    if (action === 'next') void adapterRef.current?.next()
    else if (action === 'prev') void adapterRef.current?.prev()
    else if (action === 'toc') setTocOpen((open) => !open)
  }, [])

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    let adapter: ReaderAdapter | null = null

    const saver = new PositionSaver<SavePositionInput>(
      async (input) => {
        unwrap(await api.reading.save(input))
      },
      { onError: (error) => console.warn('[reader] could not save position', error) },
    )

    async function start(id: string) {
      try {
        const opened = unwrap(await api.reading.open({ bookId: id }))
        if (cancelled) return
        setBook(opened.book)

        const container = containerRef.current
        if (!container) return

        const isPdf = opened.book.format === 'pdf'
        setZoomable(isPdf)
        adapter = isPdf ? new PdfAdapter(container) : new EpubAdapter(container)
        adapterRef.current = adapter
        adapter.onKey(handleKey)
        adapter.onPosition((next) => {
          setPosition(next)
          saver.update({ bookId: id, locator: next.locator, progress: next.progress })
        })

        await adapter.open(
          libraryFileUrl(id, isPdf ? 'book.pdf' : 'book.epub'),
          opened.state?.locator ?? null,
        )
        if (cancelled) return
        setToc(adapter.toc())
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        console.error('[reader] could not open book', error)
        setErrorMessage(error instanceof Error ? error.message : 'The book could not be opened.')
        setStatus('error')
      }
    }
    void start(bookId)

    // Whatever is waiting to be saved must reach the database when the reader goes away:
    // leaving the page, hiding the window, or closing the app.
    const stopCloseHook = api.app.onBeforeClose(() => saver.flush())
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flush()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stopCloseHook()
      document.removeEventListener('visibilitychange', onVisibility)
      adapter?.destroy()
      adapterRef.current = null
      void saver.flush()
    }
  }, [bookId, handleKey])

  // Keys pressed outside the book (toolbar, margins). Keys inside it arrive via the adapter.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const onControl = event.target instanceof Element && event.target.closest('button, a')
      if (event.key === ' ' && onControl) return // let Space press the focused button
      if (event.key === 'Escape') {
        setTocOpen(false)
        return
      }
      const action = keyAction(event)
      if (action) {
        event.preventDefault()
        handleKey(event)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleKey])

  const chapter = chapterForHref(toc, position?.href ?? null)
  const progress = position?.progress ?? 0
  const canRead = status === 'ready'

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <Link to="/" className={styles.back}>
          ← Library
        </Link>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => setTocOpen((open) => !open)}
          disabled={!canRead}
          aria-expanded={tocOpen}
        >
          Contents
        </button>
        {zoomable && (
          <div className={styles.zoom} role="group" aria-label="Zoom">
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => setZoom(adapterRef.current?.zoomOut?.() ?? 1)}
              disabled={!canRead}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => setZoom(adapterRef.current?.zoomReset?.() ?? 1)}
              disabled={!canRead}
              aria-label="Reset zoom to fit width"
              data-testid="zoom-level"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => setZoom(adapterRef.current?.zoomIn?.() ?? 1)}
              disabled={!canRead}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        )}
        <div className={styles.titleBlock}>
          <span className={styles.title}>{book?.title ?? ''}</span>
          {book?.author && <span className={styles.author}>{book.author}</span>}
        </div>
      </header>

      <main className={styles.stage}>
        <button
          type="button"
          className={`${styles.edge} ${styles.edgeLeft}`}
          onClick={() => void adapterRef.current?.prev()}
          disabled={!canRead}
          aria-label={zoomable ? 'Scroll up' : 'Previous page'}
        >
          ‹
        </button>

        <div className={styles.column}>
          <div ref={containerRef} className={styles.book} data-testid="book-container" />
        </div>

        <button
          type="button"
          className={`${styles.edge} ${styles.edgeRight}`}
          onClick={() => void adapterRef.current?.next()}
          disabled={!canRead}
          aria-label={zoomable ? 'Scroll down' : 'Next page'}
        >
          ›
        </button>

        {status === 'loading' && <div className={styles.notice}>Opening book…</div>}
        {status === 'error' && (
          <div className={styles.notice} role="alert">
            <strong>This book could not be opened.</strong>
            <span>{errorMessage}</span>
            <Link to="/">Back to library</Link>
          </div>
        )}

        {tocOpen && canRead && (
          <TocPanel
            items={toc}
            currentId={chapter?.id ?? null}
            onSelect={(item) => {
              setTocOpen(false)
              void adapterRef.current?.goTo(item.href)
            }}
            onClose={() => setTocOpen(false)}
          />
        )}
      </main>

      <footer className={styles.footer}>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(progress * 100)}
          aria-label="Reading progress"
        >
          <div className={styles.fill} style={{ width: `${progress * 100}%` }} />
        </div>
        <div className={styles.status}>
          <span className={styles.chapter}>{chapter?.label ?? ''}</span>
          <span data-testid="progress-text">
            {canRead && position?.locator.format === 'pdf' && position.pageCount
              ? `Page ${position.locator.page} of ${position.pageCount} · `
              : ''}
            {canRead ? formatPercent(progress) : ''}
          </span>
        </div>
      </footer>
    </div>
  )
}
