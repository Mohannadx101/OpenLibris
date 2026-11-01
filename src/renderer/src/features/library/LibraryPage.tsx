import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@renderer/lib/api'
import type { Book } from '@shared/library'
import { Bookshelf } from './components/Bookshelf'
import { ConfirmRemoveDialog } from './components/ConfirmRemoveDialog'
import { DropOverlay } from './components/DropOverlay'
import { EmptyState } from './components/EmptyState'
import { ErrorBanner } from './components/ErrorBanner'
import { ImportReport } from './components/ImportReport'
import { LibraryToolbar } from './components/LibraryToolbar'
import { continueReading, visibleBooks } from './shelf'
import type { SortKey } from './shelf'
import { useLibrary } from './store'
import styles from './LibraryPage.module.css'

/** True when a drag carries files from the operating system (not, say, selected text). */
function dragHasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

export function LibraryPage() {
  const {
    books,
    loadState,
    error,
    importing,
    report,
    load,
    importFromDialog,
    importPaths,
    remove,
    dismissReport,
    dismissError,
  } = useLibrary()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [pendingRemoval, setPendingRemoval] = useState<Book | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // Files dropped on the window are imported. The preload reads the paths; this only shows
  // the overlay while a drag is over the window.
  useEffect(() => {
    const stopListening = api.library.onFilesDropped((paths) => void importPaths(paths))

    let depth = 0
    const enter = (event: DragEvent) => {
      if (!dragHasFiles(event)) return
      depth++
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!dragHasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const end = () => {
      depth = 0
      setDragging(false)
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', end)
    return () => {
      stopListening()
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', end)
    }
  }, [importPaths])

  const shown = useMemo(() => visibleBooks(books, query, sort), [books, query, sort])

  // Only offered on the whole library: while searching, the results are what matters.
  const resumable = useMemo(() => (query.trim() ? [] : continueReading(books, 4)), [books, query])

  const confirmRemoval = useCallback(
    (book: Book) => {
      setPendingRemoval(null)
      void remove(book.id)
    },
    [remove],
  )

  const loading = loadState === 'idle' || loadState === 'loading'

  return (
    <main className={styles.page}>
      <LibraryToolbar
        bookCount={books.length}
        query={query}
        sort={sort}
        importing={importing}
        onQueryChange={setQuery}
        onSortChange={setSort}
        onAddBooks={() => void importFromDialog()}
      />

      {error && <ErrorBanner message={error} onDismiss={dismissError} />}
      {report && <ImportReport outcomes={report} onDismiss={dismissReport} />}

      {loading ? null : books.length === 0 ? (
        loadState === 'ready' && (
          <EmptyState
            filtered={false}
            importing={importing}
            onAddBooks={() => void importFromDialog()}
          />
        )
      ) : shown.length === 0 ? (
        <EmptyState filtered importing={importing} onAddBooks={() => void importFromDialog()} />
      ) : (
        <div className={styles.scroll}>
          {resumable.length > 0 && (
            <section className={styles.continue} aria-labelledby="continue-heading">
              <h2 id="continue-heading" className={styles.sectionHeading}>
                Continue reading
              </h2>
              <Bookshelf books={resumable} onRemove={setPendingRemoval} />
            </section>
          )}
          {resumable.length > 0 && <h2 className={styles.sectionHeading}>All books</h2>}
          <Bookshelf books={shown} onRemove={setPendingRemoval} />
        </div>
      )}

      <ConfirmRemoveDialog
        book={pendingRemoval}
        onConfirm={confirmRemoval}
        onCancel={() => setPendingRemoval(null)}
      />
      {dragging && <DropOverlay />}
    </main>
  )
}
