import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AppFailure } from '@shared/result'
import type { Book, ImportOutcome, PdfMetadataInput } from '@shared/library'
import type { BookFormat } from '@shared/types'
import type { BookRecord, BooksRepository } from '../../repositories/booksRepository'
import { toBook } from './bookMapper'
import { EpubError, readEpubMetadata } from '../metadata/epubMetadata'
import type { EpubMetadata } from '../metadata/epubMetadata'
import {
  baseName,
  detectFormat,
  extensionOf,
  hashFile,
  sniffImageExtension,
  titleFromFileName,
} from './fileUtils'

export interface LibraryServiceDeps {
  books: BooksRepository
  libraryDir: string
  /** Injectable for tests. */
  now?: () => number
  newId?: () => string
  readEpub?: (data: Uint8Array) => Promise<EpubMetadata>
}

/** Raised inside the import steps for problems the user should be told about plainly. */
class ImportRejection extends Error {}

/**
 * Owns the life of a book in the library: importing, listing, completing PDF metadata and
 * removing. All file-system and database changes for one book happen here, so a failure can
 * be rolled back in one place.
 */
export class LibraryService {
  private readonly books: BooksRepository
  private readonly libraryDir: string
  private readonly now: () => number
  private readonly newId: () => string
  private readonly readEpub: (data: Uint8Array) => Promise<EpubMetadata>

  constructor(deps: LibraryServiceDeps) {
    this.books = deps.books
    this.libraryDir = deps.libraryDir
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
    this.readEpub = deps.readEpub ?? readEpubMetadata
  }

  list(): Book[] {
    return this.books.list().map(toBook)
  }

  /** Imports files one at a time, so one bad file never affects the others. */
  async importFiles(paths: string[]): Promise<ImportOutcome[]> {
    const outcomes: ImportOutcome[] = []
    for (const path of paths) {
      outcomes.push(await this.importOne(path))
    }
    return outcomes
  }

  async remove(id: string): Promise<void> {
    if (!this.books.get(id))
      throw new AppFailure('NOT_FOUND', 'That book is no longer in your library.')

    // The row goes first: a leftover folder is harmless clutter, while a row pointing at
    // missing files would show a broken book.
    this.books.delete(id)
    try {
      await rm(join(this.libraryDir, id), { recursive: true, force: true })
    } catch (error) {
      console.error(`[library] could not delete files of removed book ${id}:`, error)
    }
  }

  /**
   * Stores what the renderer extracted from a PDF. Only applies to a book that is still
   * waiting for it, so the renderer cannot use this to rewrite a book's details later.
   */
  async completePdfMetadata(input: PdfMetadataInput): Promise<Book> {
    const record = this.books.get(input.id)
    if (!record) throw new AppFailure('NOT_FOUND', 'That book is no longer in your library.')
    if (!record.needsEnrichment) return toBook(record)

    if (input.failed) {
      this.books.updateMetadata(record.id, {
        title: record.title,
        author: record.author,
        language: record.language,
        needsEnrichment: false,
      })
      return toBook(this.books.get(record.id) as BookRecord)
    }

    let coverPath: string | undefined
    if (input.cover && input.cover.length > 0) {
      const extension = sniffImageExtension(input.cover)
      if (extension) {
        coverPath = `${record.id}/cover.${extension}`
        await writeFile(join(this.libraryDir, record.id, `cover.${extension}`), input.cover)
      }
    }

    this.books.updateMetadata(record.id, {
      title: clean(input.title) ?? record.title,
      author: clean(input.author) ?? record.author,
      language: clean(input.language) ?? record.language,
      ...(coverPath ? { coverPath } : {}),
      needsEnrichment: false,
    })
    return toBook(this.books.get(record.id) as BookRecord)
  }

  private async importOne(path: string): Promise<ImportOutcome> {
    const fileName = baseName(path)
    let folder: string | undefined

    try {
      const format = await this.validate(path)
      const contentHash = await hashFile(path)

      const existing = this.books.findByHash(contentHash)
      if (existing) return { status: 'duplicate', fileName, existingTitle: existing.title }

      const id = this.newId()
      folder = join(this.libraryDir, id)
      await mkdir(folder, { recursive: true })

      const destination = join(folder, `book.${format}`)
      await copyFile(path, destination)
      const { size } = await stat(destination)
      const source = await stat(path)
      if (size !== source.size)
        throw new ImportRejection('The file changed while it was being copied.')

      let title = titleFromFileName(path)
      let author: string | null = null
      let language: string | null = null
      let coverPath: string | null = null

      if (format === 'epub') {
        const metadata = await this.readEpubOrReject(destination)
        title = metadata.title ?? title
        author = metadata.author
        language = metadata.language
        if (metadata.cover) {
          await writeFile(join(folder, `cover.${metadata.cover.extension}`), metadata.cover.bytes)
          coverPath = `${id}/cover.${metadata.cover.extension}`
        }
      }

      this.books.insert({
        id,
        contentHash,
        format,
        title,
        author,
        language,
        filePath: `${id}/book.${format}`,
        coverPath,
        fileSize: size,
        addedAt: this.now(),
        // PDF.js lives in the renderer, which fills in the real title, author and cover.
        needsEnrichment: format === 'pdf',
      })

      return { status: 'imported', fileName, book: toBook(this.books.get(id) as BookRecord) }
    } catch (error) {
      // Leave nothing behind: no half-copied folder, no orphan files.
      if (folder) await rm(folder, { recursive: true, force: true }).catch(() => undefined)

      if (error instanceof ImportRejection || error instanceof EpubError) {
        return { status: 'failed', fileName, reason: error.message }
      }
      console.error(`[library] importing ${fileName} failed:`, error)
      return { status: 'failed', fileName, reason: 'The file could not be imported.' }
    }
  }

  private async validate(path: string): Promise<BookFormat> {
    if (!isAbsolute(path)) throw new ImportRejection('The file location is not valid.')

    let info
    try {
      info = await stat(path)
    } catch {
      throw new ImportRejection('The file could not be found.')
    }
    if (!info.isFile()) throw new ImportRejection('That is not a file.')
    if (info.size === 0) throw new ImportRejection('The file is empty.')

    const extension = extensionOf(path)
    if (extension !== 'epub' && extension !== 'pdf') {
      throw new ImportRejection('Only EPUB and PDF files can be imported.')
    }

    const format = await detectFormat(path)
    if (!format) {
      throw new ImportRejection(`This file is not a valid ${extension.toUpperCase()} file.`)
    }
    return format
  }

  private async readEpubOrReject(path: string): Promise<EpubMetadata> {
    return this.readEpub(await readFile(path))
  }
}

function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text : null
}
