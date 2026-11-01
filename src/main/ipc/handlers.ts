import type { Handlers } from './dispatch'
import { createAppHandlers } from './appHandlers'
import type { AppHandlerDeps } from './appHandlers'
import { createLibraryHandlers } from './libraryHandlers'
import type { LibraryHandlerDeps } from './libraryHandlers'
import { createReadingHandlers } from './readingHandlers'
import type { ReadingHandlerDeps } from './readingHandlers'

export type HandlerDeps = AppHandlerDeps & LibraryHandlerDeps & ReadingHandlerDeps

/**
 * Every handler in the app. `Handlers` requires one per channel in the contract, so a channel
 * added to `src/shared/ipc.ts` without an implementation here fails to compile.
 */
export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    ...createAppHandlers(deps),
    ...createLibraryHandlers(deps),
    ...createReadingHandlers(deps),
  }
}
