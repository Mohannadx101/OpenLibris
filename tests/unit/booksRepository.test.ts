import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/connection'
import type { Db } from '@main/db/connection'
import { loadBundledMigrations, runMigrations } from '@main/db/migrate'
import { BooksRepository } from '@main/repositories/booksRepository'
import type { NewBook } from '@main/repositories/booksRepository'

let db: Db
let books: BooksRepository

const sample = (overrides: Partial<NewBook> = {}): NewBook => ({
  id: 'id-1',
  contentHash: 'hash-1',
  format: 'epub',
  title: 'Dune',
  author: 'Frank Herbert',
  language: 'en',
  filePath: 'id-1/book.epub',
  coverPath: 'id-1/cover.jpg',
  fileSize: 1234,
  addedAt: 1000,
  needsEnrichment: false,
  ...overrides,
})

beforeEach(() => {
  db = openDatabase(':memory:')
  runMigrations(db, loadBundledMigrations())
  books = new BooksRepository(db)
})

afterEach(() => db.close())

describe('BooksRepository', () => {
  it('round-trips a book', () => {
    books.insert(sample())
    expect(books.get('id-1')).toEqual({ ...sample(), lastOpenedAt: null, progress: null })
  })

  it('stores the enrichment flag as a boolean', () => {
    books.insert(sample({ id: 'p', contentHash: 'h', format: 'pdf', needsEnrichment: true }))
    expect(books.get('p')?.needsEnrichment).toBe(true)
  })

  it('returns undefined for unknown ids and hashes', () => {
    expect(books.get('nope')).toBeUndefined()
    expect(books.findByHash('nope')).toBeUndefined()
  })

  it('finds a book by content hash', () => {
    books.insert(sample())
    expect(books.findByHash('hash-1')?.id).toBe('id-1')
  })

  it('refuses a second book with the same content hash', () => {
    books.insert(sample())
    expect(() => books.insert(sample({ id: 'id-2' }))).toThrow(/UNIQUE/)
  })

  it('lists newest first', () => {
    books.insert(sample({ id: 'a', contentHash: 'ha', addedAt: 1 }))
    books.insert(sample({ id: 'b', contentHash: 'hb', addedAt: 3 }))
    books.insert(sample({ id: 'c', contentHash: 'hc', addedAt: 2 }))
    expect(books.list().map((b) => b.id)).toEqual(['b', 'c', 'a'])
  })

  it('updates metadata and keeps the cover when none is given', () => {
    books.insert(sample({ needsEnrichment: true }))
    expect(
      books.updateMetadata('id-1', {
        title: 'New',
        author: null,
        language: 'fr',
        needsEnrichment: false,
      }),
    ).toBe(true)
    expect(books.get('id-1')).toMatchObject({
      title: 'New',
      author: null,
      language: 'fr',
      coverPath: 'id-1/cover.jpg',
      needsEnrichment: false,
    })
  })

  it('can replace or clear the cover', () => {
    books.insert(sample())
    books.updateMetadata('id-1', {
      title: 'T',
      author: null,
      language: null,
      coverPath: 'id-1/cover.png',
      needsEnrichment: false,
    })
    expect(books.get('id-1')?.coverPath).toBe('id-1/cover.png')
    books.updateMetadata('id-1', {
      title: 'T',
      author: null,
      language: null,
      coverPath: null,
      needsEnrichment: false,
    })
    expect(books.get('id-1')?.coverPath).toBeNull()
  })

  it('reports whether an update or delete matched anything', () => {
    expect(
      books.updateMetadata('nope', {
        title: 'x',
        author: null,
        language: null,
        needsEnrichment: false,
      }),
    ).toBe(false)
    expect(books.delete('nope')).toBe(false)
    books.insert(sample())
    expect(books.delete('id-1')).toBe(true)
    expect(books.get('id-1')).toBeUndefined()
  })

  it('removes dependent reading data when a book is deleted', () => {
    books.insert(sample())
    db.prepare(
      "INSERT INTO reading_state (book_id, locator, progress, updated_at) VALUES ('id-1', '{}', 0.2, 1)",
    ).run()
    books.delete('id-1')
    const row = db.prepare('SELECT COUNT(*) AS n FROM reading_state').get() as { n: number }
    expect(row.n).toBe(0)
  })
})

describe('BooksRepository reading progress', () => {
  const locator = JSON.stringify({ format: 'epub', cfi: 'epubcfi(/6/2)' })
  const save = (id: string, progress: number) =>
    db
      .prepare(
        'INSERT INTO reading_state (book_id, locator, progress, updated_at) VALUES (?, ?, ?, 1)',
      )
      .run(id, locator, progress)

  it('is null for a book that has never been read', () => {
    books.insert(sample())
    expect(books.get('id-1')?.progress).toBeNull()
    expect(books.list()[0]?.progress).toBeNull()
  })

  it('comes from the saved reading state, in lists, lookups and hash searches', () => {
    books.insert(sample())
    books.insert(sample({ id: 'id-2', contentHash: 'h2', addedAt: 2000 }))
    save('id-1', 0.4)
    expect(books.get('id-1')?.progress).toBe(0.4)
    expect(books.findByHash('hash-1')?.progress).toBe(0.4)
    expect(books.findByHash('h2')?.progress).toBeNull()
    const byId = Object.fromEntries(books.list().map((b) => [b.id, b.progress]))
    expect(byId).toEqual({ 'id-1': 0.4, 'id-2': null })
  })
})
