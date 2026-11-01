import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '@main/db/connection'
import type { Db } from '@main/db/connection'
import { loadBundledMigrations, runMigrations } from '@main/db/migrate'
import { BooksRepository } from '@main/repositories/booksRepository'
import { LibraryService } from '@main/services/library/libraryService'
import type { LibraryServiceDeps } from '@main/services/library/libraryService'
import type { ImportOutcome } from '@shared/library'
import {
  buildEpub,
  buildOpf,
  buildPdf,
  JPEG,
  makeTempDir,
  PNG,
  uuidSequence,
} from './helpers/fixtures'

let db: Db
let books: BooksRepository
let workspace: ReturnType<typeof makeTempDir>
let libraryDir: string

function makeService(overrides: Partial<LibraryServiceDeps> = {}): LibraryService {
  return new LibraryService({
    books,
    libraryDir,
    newId: uuidSequence(),
    now: () => 5000,
    ...overrides,
  })
}

/** Narrows an outcome, failing the test with the real outcome if it is something else. */
function expectStatus<S extends ImportOutcome['status']>(
  outcome: ImportOutcome | undefined,
  status: S,
): Extract<ImportOutcome, { status: S }> {
  expect(outcome?.status, JSON.stringify(outcome)).toBe(status)
  return outcome as Extract<ImportOutcome, { status: S }>
}

const libraryFolders = () => readdirSync(libraryDir)

beforeEach(() => {
  db = openDatabase(':memory:')
  runMigrations(db, loadBundledMigrations())
  books = new BooksRepository(db)
  workspace = makeTempDir()
  libraryDir = join(workspace.dir, 'library')
  mkdirSync(libraryDir, { recursive: true })
})

afterEach(() => {
  db.close()
  workspace.cleanup()
})

describe('importing an EPUB', () => {
  it('copies the file, reads its metadata and stores the cover', async () => {
    const path = workspace.file(
      'dune.epub',
      await buildEpub({
        opf: buildOpf({
          titles: ['Dune'],
          creators: [{ name: 'Frank Herbert' }],
          languages: ['en'],
          manifest: [
            { id: 'c', href: 'c.jpg', mediaType: 'image/jpeg', properties: 'cover-image' },
          ],
        }),
        files: { 'OEBPS/c.jpg': JPEG },
      }),
    )

    const [outcome] = await makeService().importFiles([path])
    const { book } = expectStatus(outcome, 'imported')

    expect(book).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      language: 'en',
      format: 'epub',
      needsEnrichment: false,
      addedAt: 5000,
      coverUrl: 'book://library/00000000-0000-4000-8000-000000000001/cover.jpg',
    })
    const folder = join(libraryDir, book.id)
    expect(statSync(join(folder, 'book.epub')).size).toBe(book.fileSize)
    expect(existsSync(join(folder, 'cover.jpg'))).toBe(true)
  })

  it('leaves the original file in place', async () => {
    const path = workspace.file('keep.epub', await buildEpub())
    await makeService().importFiles([path])
    expect(existsSync(path)).toBe(true)
  })

  it('falls back to the file name when the EPUB has no title', async () => {
    const path = workspace.file('My_Untitled_Book.epub', await buildEpub({ opf: buildOpf() }))
    const [outcome] = await makeService().importFiles([path])
    const { book } = expectStatus(outcome, 'imported')
    expect(book.title).toBe('My Untitled Book')
    expect(book.author).toBeNull()
    expect(book.coverUrl).toBeNull()
  })
})

describe('importing a PDF', () => {
  it('imports with a file-name title and queues it for metadata extraction', async () => {
    const path = workspace.file('Some_Paper.pdf', buildPdf())
    const [outcome] = await makeService().importFiles([path])
    const { book } = expectStatus(outcome, 'imported')
    expect(book).toMatchObject({
      title: 'Some Paper',
      format: 'pdf',
      needsEnrichment: true,
      coverUrl: null,
    })
    expect(existsSync(join(libraryDir, book.id, 'book.pdf'))).toBe(true)
  })
})

describe('duplicates', () => {
  it('recognises the same content under another file name', async () => {
    const service = makeService()
    const first = workspace.file('a.pdf', buildPdf('same'))
    const second = workspace.file('b.pdf', buildPdf('same'))

    await service.importFiles([first])
    const [outcome] = await service.importFiles([second])

    const dup = expectStatus(outcome, 'duplicate')
    expect(dup.existingTitle).toBe('a')
    expect(libraryFolders()).toHaveLength(1)
    expect(books.list()).toHaveLength(1)
  })

  it('catches a duplicate inside one batch', async () => {
    const a = workspace.file('a.pdf', buildPdf('same'))
    const b = workspace.file('b.pdf', buildPdf('same'))
    const outcomes = await makeService().importFiles([a, b])
    expect(outcomes.map((o) => o.status)).toEqual(['imported', 'duplicate'])
  })

  it('treats different content as different books', async () => {
    const outcomes = await makeService().importFiles([
      workspace.file('a.pdf', buildPdf('one')),
      workspace.file('b.pdf', buildPdf('two')),
    ])
    expect(outcomes.map((o) => o.status)).toEqual(['imported', 'imported'])
  })
})

describe('rejected files', () => {
  it.each([
    ['an unsupported type', 'notes.txt', 'hello', /Only EPUB and PDF/],
    ['an empty file', 'empty.pdf', '', /empty/],
    ['text renamed to .pdf', 'fake.pdf', 'just some text', /not a valid PDF/],
    ['text renamed to .epub', 'fake.epub', 'just some text', /not a valid EPUB/],
  ])('rejects %s', async (_label, name, content, message) => {
    const path = workspace.file(name, content)
    const [outcome] = await makeService().importFiles([path])
    expect(expectStatus(outcome, 'failed').reason).toMatch(message)
    expect(libraryFolders()).toHaveLength(0)
    expect(books.list()).toHaveLength(0)
  })

  it('rejects a missing file, a folder and a relative path', async () => {
    const service = makeService()
    const outcomes = await service.importFiles([
      join(workspace.dir, 'missing.pdf'),
      workspace.dir,
      'relative/path.pdf',
    ])
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed', 'failed'])
    expect(libraryFolders()).toHaveLength(0)
  })

  it('rejects a zip that is not an EPUB, with a clear message and no leftovers', async () => {
    const path = workspace.file('broken.epub', await buildEpub({ container: null }))
    const [outcome] = await makeService().importFiles([path])
    expect(expectStatus(outcome, 'failed').reason).toMatch(/not a valid EPUB/)
    expect(libraryFolders()).toHaveLength(0)
    expect(books.list()).toHaveLength(0)
  })

  it('does not let one bad file stop the rest of a batch', async () => {
    const outcomes = await makeService().importFiles([
      workspace.file('bad.pdf', 'nope'),
      workspace.file('good.pdf', buildPdf()),
    ])
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'imported'])
    expect(books.list()).toHaveLength(1)
  })
})

describe('rollback', () => {
  it('removes the copied folder when metadata reading fails unexpectedly', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = makeService({
      readEpub: () => Promise.reject(new Error('disk on fire')),
    })
    const [outcome] = await service.importFiles([workspace.file('a.epub', await buildEpub())])
    spy.mockRestore()

    const failed = expectStatus(outcome, 'failed')
    expect(failed.reason).toBe('The file could not be imported.')
    expect(failed.reason).not.toContain('fire')
    expect(libraryFolders()).toHaveLength(0)
    expect(books.list()).toHaveLength(0)
  })

  it('removes the copied folder when the database insert fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingBooks = Object.create(books) as BooksRepository
    failingBooks.insert = () => {
      throw new Error('constraint failed')
    }
    const [outcome] = await makeService({ books: failingBooks }).importFiles([
      workspace.file('a.pdf', buildPdf()),
    ])
    spy.mockRestore()

    expectStatus(outcome, 'failed')
    expect(libraryFolders()).toHaveLength(0)
  })
})

describe('list and remove', () => {
  it('lists imported books, newest first', async () => {
    let clock = 0
    const service = makeService({ now: () => ++clock })
    await service.importFiles([
      workspace.file('a.pdf', buildPdf('a')),
      workspace.file('b.pdf', buildPdf('b')),
    ])
    expect(service.list().map((b) => b.title)).toEqual(['b', 'a'])
  })

  it('removes the row and the files, but not the original', async () => {
    const service = makeService()
    const original = workspace.file('a.pdf', buildPdf())
    const [outcome] = await service.importFiles([original])
    const { book } = expectStatus(outcome, 'imported')

    await service.remove(book.id)

    expect(service.list()).toEqual([])
    expect(existsSync(join(libraryDir, book.id))).toBe(false)
    expect(existsSync(original)).toBe(true)
  })

  it('reports a book that is already gone', async () => {
    await expect(
      makeService().remove('00000000-0000-4000-8000-0000000000ff'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('allows the same file to be imported again after removal', async () => {
    const service = makeService()
    const path = workspace.file('a.pdf', buildPdf())
    const [first] = await service.importFiles([path])
    await service.remove(expectStatus(first, 'imported').book.id)
    const [again] = await service.importFiles([path])
    expectStatus(again, 'imported')
  })
})

describe('completePdfMetadata', () => {
  async function importPdf(service: LibraryService) {
    const [outcome] = await service.importFiles([workspace.file('p.pdf', buildPdf())])
    return expectStatus(outcome, 'imported').book
  }

  it('stores the title, author and cover, and clears the flag', async () => {
    const service = makeService()
    const pdf = await importPdf(service)

    const updated = await service.completePdfMetadata({
      id: pdf.id,
      failed: false,
      title: '  Real   Title ',
      author: 'An Author',
      language: 'en',
      cover: JPEG,
    })

    expect(updated).toMatchObject({
      title: 'Real Title',
      author: 'An Author',
      language: 'en',
      needsEnrichment: false,
      coverUrl: `book://library/${pdf.id}/cover.jpg`,
    })
    expect(existsSync(join(libraryDir, pdf.id, 'cover.jpg'))).toBe(true)
  })

  it('keeps the file-name title when none was extracted', async () => {
    const service = makeService()
    const pdf = await importPdf(service)
    const updated = await service.completePdfMetadata({ id: pdf.id, failed: false, title: null })
    expect(updated.title).toBe('p')
    expect(updated.needsEnrichment).toBe(false)
  })

  it('just clears the flag when extraction failed', async () => {
    const service = makeService()
    const pdf = await importPdf(service)
    const updated = await service.completePdfMetadata({
      id: pdf.id,
      failed: true,
      title: 'Ignored',
      cover: JPEG,
    })
    expect(updated).toMatchObject({ title: 'p', coverUrl: null, needsEnrichment: false })
    expect(existsSync(join(libraryDir, pdf.id, 'cover.jpg'))).toBe(false)
  })

  it('refuses to store a "cover" that is not an image', async () => {
    const service = makeService()
    const pdf = await importPdf(service)
    const updated = await service.completePdfMetadata({
      id: pdf.id,
      failed: false,
      cover: Buffer.from('<script>alert(1)</script>'),
    })
    expect(updated.coverUrl).toBeNull()
    expect(libraryFolders().length).toBe(1)
    expect(readdirSync(join(libraryDir, pdf.id))).toEqual(['book.pdf'])
  })

  it('accepts PNG covers too', async () => {
    const service = makeService()
    const pdf = await importPdf(service)
    const updated = await service.completePdfMetadata({ id: pdf.id, failed: false, cover: PNG })
    expect(updated.coverUrl).toMatch(/cover\.png$/)
  })

  it('cannot be used to rewrite a book that is already complete', async () => {
    const service = makeService()
    const pdf = await importPdf(service)
    await service.completePdfMetadata({ id: pdf.id, failed: false, title: 'First' })

    const second = await service.completePdfMetadata({
      id: pdf.id,
      failed: false,
      title: 'Hijacked',
    })
    expect(second.title).toBe('First')
  })

  it('cannot be used on an EPUB', async () => {
    const service = makeService()
    const [outcome] = await service.importFiles([
      workspace.file('e.epub', await buildEpub({ opf: buildOpf({ titles: ['Real'] }) })),
    ])
    const { book } = expectStatus(outcome, 'imported')
    const result = await service.completePdfMetadata({ id: book.id, failed: false, title: 'Fake' })
    expect(result.title).toBe('Real')
  })

  it('reports an unknown book', async () => {
    await expect(
      makeService().completePdfMetadata({
        id: '00000000-0000-4000-8000-0000000000ff',
        failed: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
