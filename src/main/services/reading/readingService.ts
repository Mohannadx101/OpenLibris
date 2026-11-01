import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppFailure } from '@shared/result'
import type { OpenedBook, SavePositionInput } from '@shared/reading'
import type { BooksRepository } from '../../repositories/booksRepository'
import type { ReadingStateRepository } from '../../repositories/readingStateRepository'
import { toBook } from '../library/bookMapper'

export interface ReadingServiceDeps {
  books: BooksRepository
  reading: ReadingStateRepository
  libraryDir: string
  now?: () => number
}

/** Opening books for reading and remembering where the reader stopped. */
export class ReadingService {
  private readonly books: BooksRepository
  private readonly reading: ReadingStateRepository
  private readonly libraryDir: string
  private readonly now: () => number

  constructor(deps: ReadingServiceDeps) {
    this.books = deps.books
    this.reading = deps.reading
    this.libraryDir = deps.libraryDir
    this.now = deps.now ?? Date.now
  }

  open(bookId: string): OpenedBook {
    const record = this.books.get(bookId)
    if (!record) throw new AppFailure('NOT_FOUND', 'That book is no longer in your library.')

    // Say so plainly if the file has gone missing, instead of letting the reader fail oddly.
    if (!existsSync(join(this.libraryDir, record.filePath))) {
      throw new AppFailure('NOT_FOUND', 'The book file is missing from your library folder.')
    }

    this.books.markOpened(bookId, this.now())
    const updated = this.books.get(bookId) ?? record
    return { book: toBook(updated), state: this.reading.get(bookId) ?? null }
  }

  save({ bookId, locator, progress }: SavePositionInput): void {
    const record = this.books.get(bookId)
    if (!record) throw new AppFailure('NOT_FOUND', 'That book is no longer in your library.')

    // An EPUB position can never be valid for a PDF, and vice versa.
    if (locator.format !== record.format) {
      throw new AppFailure('VALIDATION', 'That position does not belong to this kind of book.')
    }
    this.reading.save(bookId, locator, progress, this.now())
  }
}
