import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/connection'
import type { Db } from '@main/db/connection'
import { loadBundledMigrations, runMigrations } from '@main/db/migrate'
import { createReadingHandlers } from '@main/ipc/readingHandlers'
import { dispatch } from '@main/ipc/dispatch'
import { BooksRepository } from '@main/repositories/booksRepository'
import { ReadingStateRepository } from '@main/repositories/readingStateRepository'
import { ReadingService } from '@main/services/reading/readingService'
import type { Locator } from '@shared/reading'
import { makeTempDir } from './helpers/fixtures'

const EPUB_ID = '00000000-0000-4000-8000-000000000001'
const PDF_ID = '00000000-0000-4000-8000-000000000002'
const MISSING_FILE_ID = '00000000-0000-4000-8000-000000000003'

const epubLocator: Locator = { format: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)' }
const pdfLocator: Locator = { format: 'pdf', page: 3, offsetY: 0.5 }

let db: Db
let temp: ReturnType<typeof makeTempDir>
let books: BooksRepository
let states: ReadingStateRepository
let clock: number
let service: ReadingService

function addBook(id: string, format: 'epub' | 'pdf', withFile = true) {
  const filePath = `${id}/book.${format}`
  books.insert({
    id,
    contentHash: `hash-${id}`,
    format,
    title: `Book ${id.slice(-1)}`,
    author: null,
    language: null,
    filePath,
    coverPath: null,
    fileSize: 10,
    addedAt: 1,
    needsEnrichment: false,
  })
  if (withFile) {
    mkdirSync(join(temp.dir, id), { recursive: true })
    writeFileSync(join(temp.dir, filePath), 'x')
  }
}

beforeEach(() => {
  db = openDatabase(':memory:')
  runMigrations(db, loadBundledMigrations())
  temp = makeTempDir()
  books = new BooksRepository(db)
  states = new ReadingStateRepository(db)
  clock = 5000
  service = new ReadingService({
    books,
    reading: states,
    libraryDir: temp.dir,
    now: () => clock,
  })
  addBook(EPUB_ID, 'epub')
  addBook(PDF_ID, 'pdf')
  addBook(MISSING_FILE_ID, 'epub', false)
})

afterEach(() => {
  db.close()
  temp.cleanup()
})

describe('ReadingStateRepository', () => {
  it('has nothing for a book that was never read', () => {
    expect(states.get(EPUB_ID)).toBeUndefined()
  })

  it('round-trips a position and replaces it on the next save', () => {
    states.save(EPUB_ID, epubLocator, 0.25, 10)
    expect(states.get(EPUB_ID)).toEqual({ locator: epubLocator, progress: 0.25, updatedAt: 10 })

    const later: Locator = { format: 'epub', cfi: 'epubcfi(/6/8!/4/2/1:0)' }
    states.save(EPUB_ID, later, 0.5, 20)
    expect(states.get(EPUB_ID)).toEqual({ locator: later, progress: 0.5, updatedAt: 20 })
  })

  it('stores a PDF position', () => {
    states.save(PDF_ID, pdfLocator, 0.1, 10)
    expect(states.get(PDF_ID)?.locator).toEqual(pdfLocator)
  })

  it('treats unreadable stored positions as "no saved position"', () => {
    const insert = db.prepare(
      'INSERT INTO reading_state (book_id, locator, progress, updated_at) VALUES (?, ?, 0, 1)',
    )
    insert.run(EPUB_ID, '{not json')
    expect(states.get(EPUB_ID)).toBeUndefined()

    db.prepare('UPDATE reading_state SET locator = ? WHERE book_id = ?').run(
      JSON.stringify({ format: 'epub' }),
      EPUB_ID,
    )
    expect(states.get(EPUB_ID)).toBeUndefined()
  })

  it('is removed together with its book', () => {
    states.save(EPUB_ID, epubLocator, 0.2, 10)
    books.delete(EPUB_ID)
    expect(states.get(EPUB_ID)).toBeUndefined()
  })
})

describe('ReadingService.open', () => {
  it('opens a book with no saved position', () => {
    const opened = service.open(EPUB_ID)
    expect(opened.book.id).toBe(EPUB_ID)
    expect(opened.state).toBeNull()
  })

  it('returns the saved position and records when the book was opened', () => {
    states.save(EPUB_ID, epubLocator, 0.4, 10)
    const opened = service.open(EPUB_ID)
    expect(opened.state).toEqual({ locator: epubLocator, progress: 0.4, updatedAt: 10 })
    expect(opened.book.lastOpenedAt).toBe(5000)
  })

  it('fails clearly for an unknown book', () => {
    expect(() => service.open('00000000-0000-4000-8000-0000000000ff')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
  })

  it('fails clearly when the file has gone missing, without marking it opened', () => {
    expect(() => service.open(MISSING_FILE_ID)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    expect(books.get(MISSING_FILE_ID)?.lastOpenedAt).toBeNull()
  })
})

describe('ReadingService.save', () => {
  it('saves a position that matches the book format', () => {
    service.save({ bookId: EPUB_ID, locator: epubLocator, progress: 0.3 })
    expect(states.get(EPUB_ID)).toEqual({ locator: epubLocator, progress: 0.3, updatedAt: 5000 })
  })

  it('rejects a position of the wrong format', () => {
    expect(() =>
      service.save({ bookId: EPUB_ID, locator: pdfLocator, progress: 0.3 }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
    expect(() =>
      service.save({ bookId: PDF_ID, locator: epubLocator, progress: 0.3 }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
    expect(states.get(EPUB_ID)).toBeUndefined()
  })

  it('rejects an unknown book', () => {
    expect(() =>
      service.save({
        bookId: '00000000-0000-4000-8000-0000000000ff',
        locator: epubLocator,
        progress: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
})

describe('reading IPC handlers', () => {
  const handlers = () => ({ ...createReadingHandlers({ reading: service }) }) as never

  it('opens and saves through validated channels', async () => {
    const h = handlers()
    const saved = await dispatch(
      'reading:save',
      { bookId: EPUB_ID, locator: epubLocator, progress: 0.6 },
      h,
    )
    expect(saved).toEqual({ ok: true, data: null })

    const opened = await dispatch('reading:open', { bookId: EPUB_ID }, h)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.data.state?.progress).toBe(0.6)
  })

  it('rejects malformed positions before they reach the service', async () => {
    const h = handlers()
    const bad = [
      { bookId: 'not-a-uuid', locator: epubLocator, progress: 0.1 },
      { bookId: EPUB_ID, locator: epubLocator, progress: 1.5 },
      { bookId: EPUB_ID, locator: { format: 'epub', cfi: '' }, progress: 0.1 },
      { bookId: PDF_ID, locator: { format: 'pdf', page: 0, offsetY: 0 }, progress: 0.1 },
      { bookId: PDF_ID, locator: { format: 'pdf', page: 1, offsetY: 2 }, progress: 0.1 },
    ]
    for (const payload of bad) {
      const result = await dispatch('reading:save', payload, h)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION')
    }
  })
})
