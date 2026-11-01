import { create } from 'zustand'
import { api, unwrap } from '@renderer/lib/api'
import { extractPdfInfo } from '@renderer/lib/pdfInfo'
import { libraryFileUrl } from '@renderer/lib/libraryUrl'
import type { Book, ImportOutcome } from '@shared/library'

interface LibraryState {
  books: Book[]
  loadState: 'idle' | 'loading' | 'ready' | 'error'
  /** A problem with the library as a whole (could not load, could not remove, …). */
  error: string | null
  importing: boolean
  /** The outcome of the latest import, shown until dismissed. */
  report: ImportOutcome[] | null

  load(): Promise<void>
  importFromDialog(): Promise<void>
  importPaths(paths: string[]): Promise<void>
  remove(id: string): Promise<void>
  dismissReport(): void
  dismissError(): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// PDFs are imported immediately with a file-name title; this fills in the real title, author
// and cover one book at a time. It runs outside the store state so two triggers (a load and an
// import finishing together) never process the same book twice.
let enriching = false

export const useLibrary = create<LibraryState>()((set, get) => {
  /** Replaces a book in the list, keeping its position. */
  const replaceBook = (updated: Book) =>
    set((state) => ({ books: state.books.map((b) => (b.id === updated.id ? updated : b)) }))

  async function enrichPendingPdfs(): Promise<void> {
    if (enriching) return
    enriching = true
    try {
      for (;;) {
        const next = get().books.find((b) => b.format === 'pdf' && b.needsEnrichment)
        if (!next) return

        let request
        try {
          const info = await extractPdfInfo(libraryFileUrl(next.id, 'book.pdf'))
          request = { id: next.id, failed: false, ...info }
        } catch (error) {
          console.warn(`[pdf] could not read "${next.title}":`, error)
          request = { id: next.id, failed: true }
        }

        try {
          replaceBook(unwrap(await api.library.completePdfMetadata(request)))
        } catch (error) {
          // The book was probably removed meanwhile. Drop it from the queue either way.
          console.warn('[pdf] could not save metadata:', error)
          set((state) => ({ books: state.books.filter((b) => b.id !== next.id) }))
        }
      }
    } finally {
      enriching = false
    }
  }

  async function runImport(start: () => Promise<{ canceled: boolean; outcomes: ImportOutcome[] }>) {
    if (get().importing) return
    set({ importing: true, error: null })
    try {
      const result = await start()
      if (result.canceled) return
      set({ report: result.outcomes })
      set({ books: unwrap(await api.library.list()) })
      void enrichPendingPdfs()
    } catch (error) {
      set({ error: `Import failed: ${messageOf(error)}` })
    } finally {
      set({ importing: false })
    }
  }

  return {
    books: [],
    loadState: 'idle',
    error: null,
    importing: false,
    report: null,

    async load() {
      set({ loadState: 'loading', error: null })
      try {
        set({ books: unwrap(await api.library.list()), loadState: 'ready' })
        void enrichPendingPdfs()
      } catch (error) {
        set({ loadState: 'error', error: `Could not load your library: ${messageOf(error)}` })
      }
    },

    importFromDialog: () => runImport(async () => unwrap(await api.library.importFromDialog())),

    importPaths: (paths) => runImport(async () => unwrap(await api.library.importPaths({ paths }))),

    async remove(id) {
      try {
        unwrap(await api.library.remove({ id }))
      } catch (error) {
        set({ error: `Could not remove the book: ${messageOf(error)}` })
      }
      // Reload either way, so the shelf shows what is really in the library.
      try {
        set({ books: unwrap(await api.library.list()) })
      } catch (error) {
        set({ error: `Could not refresh your library: ${messageOf(error)}` })
      }
    },

    dismissReport: () => set({ report: null }),
    dismissError: () => set({ error: null }),
  }
})
