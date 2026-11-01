import type { Book } from '@shared/library'
import { libraryUrlFor } from '../../libraryUrl'
import type { BookRecord } from '../../repositories/booksRepository'

/** Converts a database record into what the renderer is allowed to see. */
export function toBook(record: BookRecord): Book {
  return {
    id: record.id,
    format: record.format,
    title: record.title,
    author: record.author,
    language: record.language,
    coverUrl: record.coverPath ? libraryUrlFor(record.coverPath) : null,
    fileSize: record.fileSize,
    addedAt: record.addedAt,
    lastOpenedAt: record.lastOpenedAt,
    needsEnrichment: record.needsEnrichment,
    progress: record.progress,
  }
}
