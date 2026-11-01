import type { ReadingService } from '../services/reading/readingService'
import type { ChannelsOf, HandlersFor } from './dispatch'

export interface ReadingHandlerDeps {
  reading: ReadingService
}

export function createReadingHandlers(
  deps: ReadingHandlerDeps,
): HandlersFor<ChannelsOf<'reading'>> {
  return {
    'reading:open': ({ bookId }) => deps.reading.open(bookId),

    'reading:save': (input) => {
      deps.reading.save(input)
      return null
    },
  }
}
