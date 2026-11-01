import type { LibraryService } from '../services/library/libraryService'
import type { ChannelsOf, HandlersFor } from './dispatch'

export interface LibraryHandlerDeps {
  library: LibraryService
  /** Shows the system "open files" dialog; resolves to the chosen paths (empty if canceled). */
  pickBookFiles: () => Promise<string[]>
}

export function createLibraryHandlers(
  deps: LibraryHandlerDeps,
): HandlersFor<ChannelsOf<'library'>> {
  return {
    'library:list': () => deps.library.list(),

    'library:importFromDialog': async () => {
      const paths = await deps.pickBookFiles()
      if (paths.length === 0) return { canceled: true, outcomes: [] }
      return { canceled: false, outcomes: await deps.library.importFiles(paths) }
    },

    'library:importPaths': async ({ paths }) => ({
      canceled: false,
      outcomes: await deps.library.importFiles(paths),
    }),

    'library:remove': async ({ id }) => {
      await deps.library.remove(id)
      return null
    },

    'library:completePdfMetadata': (input) => deps.library.completePdfMetadata(input),
  }
}
