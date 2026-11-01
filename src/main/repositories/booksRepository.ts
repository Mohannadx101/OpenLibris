import type { Db } from '../db/connection'
import type { BookFormat } from '@shared/types'

/** A row of the `books` table, mapped to camelCase. File paths are relative to the library dir. */
export interface BookRecord {
  id: string
  contentHash: string
  format: BookFormat
  title: string
  author: string | null
  language: string | null
  filePath: string
  coverPath: string | null
  fileSize: number
  addedAt: number
  lastOpenedAt: number | null
  needsEnrichment: boolean
  /** How far the reader has got, 0..1, or null if the book has never been read. */
  progress: number | null
}

export type NewBook = Omit<BookRecord, 'lastOpenedAt' | 'progress'>

export interface BookMetadataUpdate {
  title: string
  author: string | null
  language: string | null
  /** Pass undefined to keep the existing cover. */
  coverPath?: string | null
  needsEnrichment: boolean
}

interface BookRow {
  id: string
  content_hash: string
  format: BookFormat
  title: string
  author: string | null
  language: string | null
  file_path: string
  cover_path: string | null
  file_size: number
  added_at: number
  last_opened_at: number | null
  needs_enrichment: number
  progress: number | null
}

function toRecord(row: BookRow): BookRecord {
  return {
    id: row.id,
    contentHash: row.content_hash,
    format: row.format,
    title: row.title,
    author: row.author,
    language: row.language,
    filePath: row.file_path,
    coverPath: row.cover_path,
    fileSize: row.file_size,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    needsEnrichment: row.needs_enrichment === 1,
    progress: row.progress,
  }
}

export class BooksRepository {
  private readonly insertStmt
  private readonly selectAll
  private readonly selectById
  private readonly selectByHash
  private readonly deleteStmt
  private readonly updateStmt
  private readonly updateKeepCoverStmt
  private readonly markOpenedStmt

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO books (id, content_hash, format, title, author, language, file_path,
                          cover_path, file_size, added_at, needs_enrichment)
       VALUES (@id, @contentHash, @format, @title, @author, @language, @filePath,
               @coverPath, @fileSize, @addedAt, @needsEnrichment)`,
    )
    const withProgress = `SELECT books.*, reading_state.progress AS progress FROM books
       LEFT JOIN reading_state ON reading_state.book_id = books.id`
    this.selectAll = db.prepare(`${withProgress} ORDER BY books.added_at DESC, books.id`)
    this.selectById = db.prepare(`${withProgress} WHERE books.id = ?`)
    this.selectByHash = db.prepare(`${withProgress} WHERE books.content_hash = ?`)
    this.deleteStmt = db.prepare('DELETE FROM books WHERE id = ?')
    this.updateStmt = db.prepare(
      `UPDATE books SET title = @title, author = @author, language = @language,
                        cover_path = @coverPath, needs_enrichment = @needsEnrichment
       WHERE id = @id`,
    )
    this.markOpenedStmt = db.prepare('UPDATE books SET last_opened_at = ? WHERE id = ?')
    this.updateKeepCoverStmt = db.prepare(
      `UPDATE books SET title = @title, author = @author, language = @language,
                        needs_enrichment = @needsEnrichment
       WHERE id = @id`,
    )
  }

  insert(book: NewBook): void {
    this.insertStmt.run({ ...book, needsEnrichment: book.needsEnrichment ? 1 : 0 })
  }

  list(): BookRecord[] {
    return (this.selectAll.all() as BookRow[]).map(toRecord)
  }

  get(id: string): BookRecord | undefined {
    const row = this.selectById.get(id) as BookRow | undefined
    return row && toRecord(row)
  }

  findByHash(contentHash: string): BookRecord | undefined {
    const row = this.selectByHash.get(contentHash) as BookRow | undefined
    return row && toRecord(row)
  }

  /** Returns false when the book does not exist. */
  updateMetadata(id: string, update: BookMetadataUpdate): boolean {
    const params = {
      id,
      title: update.title,
      author: update.author,
      language: update.language,
      needsEnrichment: update.needsEnrichment ? 1 : 0,
    }
    const result =
      update.coverPath === undefined
        ? this.updateKeepCoverStmt.run(params)
        : this.updateStmt.run({ ...params, coverPath: update.coverPath })
    return result.changes > 0
  }

  markOpened(id: string, at: number): void {
    this.markOpenedStmt.run(at, id)
  }

  /** Returns false when the book does not exist. */
  delete(id: string): boolean {
    return this.deleteStmt.run(id).changes > 0
  }
}
