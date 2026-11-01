import { describe, expect, it } from 'vitest'
import {
  formatFileSize,
  hueForTitle,
  matchesQuery,
  visibleBooks,
} from '@renderer/features/library/shelf'
import { summarize } from '@renderer/features/library/importSummary'
import { cleanPdfAuthor, cleanPdfTitle } from '@renderer/lib/pdfText'
import type { Book, ImportOutcome } from '@shared/library'

const book = (overrides: Partial<Book>): Book => ({
  id: 'x',
  format: 'epub',
  title: 'Untitled',
  author: null,
  language: null,
  coverUrl: null,
  fileSize: 100,
  addedAt: 0,
  lastOpenedAt: null,
  needsEnrichment: false,
  ...overrides,
})

const library = [
  book({ id: '1', title: 'Dune', author: 'Frank Herbert', addedAt: 10 }),
  book({ id: '2', title: 'Emma', author: 'Jane Austen', addedAt: 30 }),
  book({ id: '3', title: 'Anonymous Tales', author: null, addedAt: 20 }),
  book({ id: '4', title: 'Book 10', author: 'Zed', addedAt: 5 }),
  book({ id: '5', title: 'Book 2', author: 'Abe', addedAt: 6 }),
]

describe('searching', () => {
  it('matches title or author, ignoring case', () => {
    expect(visibleBooks(library, 'DUNE', 'title').map((b) => b.id)).toEqual(['1'])
    expect(visibleBooks(library, 'austen', 'title').map((b) => b.id)).toEqual(['2'])
  })

  it('requires every word to match, in any order', () => {
    expect(matchesQuery(library[0]!, 'herbert dune')).toBe(true)
    expect(matchesQuery(library[0]!, 'dune austen')).toBe(false)
  })

  it('shows everything for an empty or blank query', () => {
    expect(visibleBooks(library, '', 'title')).toHaveLength(5)
    expect(visibleBooks(library, '   ', 'title')).toHaveLength(5)
  })

  it('does not fail on books without an author', () => {
    expect(visibleBooks(library, 'anonymous', 'title').map((b) => b.id)).toEqual(['3'])
  })
})

describe('sorting', () => {
  it('puts the most recently added first', () => {
    expect(visibleBooks(library, '', 'recent').map((b) => b.id)).toEqual(['2', '3', '1', '5', '4'])
  })

  it('sorts titles naturally, so "Book 2" comes before "Book 10"', () => {
    const titles = visibleBooks(library, '', 'title').map((b) => b.title)
    expect(titles.indexOf('Book 2')).toBeLessThan(titles.indexOf('Book 10'))
    expect(titles[0]).toBe('Anonymous Tales')
  })

  it('sorts by author with unknown authors last', () => {
    expect(visibleBooks(library, '', 'author').map((b) => b.author)).toEqual([
      'Abe',
      'Frank Herbert',
      'Jane Austen',
      'Zed',
      null,
    ])
  })

  it('does not modify the input array', () => {
    const copy = [...library]
    visibleBooks(library, '', 'title')
    expect(library).toEqual(copy)
  })
})

describe('placeholder colour', () => {
  it('is stable and in range', () => {
    expect(hueForTitle('Dune')).toBe(hueForTitle('Dune'))
    for (const title of ['', 'a', 'Dune', '日本語のタイトル']) {
      const hue = hueForTitle(title)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('differs between titles', () => {
    expect(hueForTitle('Dune')).not.toBe(hueForTitle('Emma'))
  })
})

describe('formatFileSize', () => {
  it('formats common sizes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB')
    expect(formatFileSize(3 * 1024 ** 3)).toBe('3.0 GB')
  })
})

describe('summarize', () => {
  const imported = (n: number): ImportOutcome[] =>
    Array.from({ length: n }, (_, i) => ({
      status: 'imported' as const,
      fileName: `f${i}`,
      book: book({ id: String(i) }),
    }))

  it('describes each kind of outcome', () => {
    expect(summarize(imported(1))).toBe('1 book added')
    expect(summarize(imported(3))).toBe('3 books added')
    expect(
      summarize([
        ...imported(2),
        { status: 'duplicate', fileName: 'd', existingTitle: 'T' },
        { status: 'failed', fileName: 'x', reason: 'bad' },
      ]),
    ).toBe('2 books added · 1 already in your library · 1 could not be imported')
  })
})

describe('PDF text cleanup', () => {
  it('strips authoring-tool noise from titles', () => {
    expect(cleanPdfTitle('Microsoft Word - Annual Report.docx')).toBe('Annual Report')
    expect(cleanPdfTitle('  Spaced   Out  ')).toBe('Spaced Out')
    expect(cleanPdfTitle('report.pdf')).toBe('report')
  })

  it('rejects titles that say nothing', () => {
    for (const junk of [
      '',
      '   ',
      'Untitled',
      'untitled 2',
      'Microsoft Word - .docx',
      null,
      undefined,
      42,
    ]) {
      expect(cleanPdfTitle(junk), String(junk)).toBeNull()
    }
  })

  it('rejects placeholder authors but keeps real ones', () => {
    expect(cleanPdfAuthor('Unknown')).toBeNull()
    expect(cleanPdfAuthor('ADMIN')).toBeNull()
    expect(cleanPdfAuthor('')).toBeNull()
    expect(cleanPdfAuthor(undefined)).toBeNull()
    expect(cleanPdfAuthor(' Ursula K. Le Guin ')).toBe('Ursula K. Le Guin')
  })
})
