import { describe, expect, it } from 'vitest'
import {
  chapterForHref,
  dirName,
  estimateProgress,
  formatPercent,
  resolveHref,
} from '@renderer/features/reader/chapters'
import { keyAction } from '@renderer/features/reader/keys'
import type { TocItem } from '@renderer/features/reader/adapters/ReaderAdapter'

const key = (k: string, extra: object = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
})

describe('keyAction', () => {
  it('maps page-turning keys', () => {
    expect(keyAction(key('ArrowRight'))).toBe('next')
    expect(keyAction(key('PageDown'))).toBe('next')
    expect(keyAction(key(' '))).toBe('next')
    expect(keyAction(key('ArrowLeft'))).toBe('prev')
    expect(keyAction(key('PageUp'))).toBe('prev')
    expect(keyAction(key(' ', { shiftKey: true }))).toBe('prev')
  })

  it('toggles the contents with T', () => {
    expect(keyAction(key('t'))).toBe('toc')
    expect(keyAction(key('T'))).toBe('toc')
  })

  it('leaves keys with modifiers and unrelated keys alone', () => {
    expect(keyAction(key('ArrowRight', { ctrlKey: true }))).toBeNull()
    expect(keyAction(key('ArrowLeft', { metaKey: true }))).toBeNull()
    expect(keyAction(key('t', { altKey: true }))).toBeNull()
    expect(keyAction(key('a'))).toBeNull()
    expect(keyAction(key('Enter'))).toBeNull()
  })
})

describe('estimateProgress', () => {
  const base = { spineLength: 10, pageCount: 4, atEnd: false }

  it('starts at zero and moves through each file', () => {
    expect(estimateProgress({ ...base, spineIndex: 0, page: 1 })).toBe(0)
    expect(estimateProgress({ ...base, spineIndex: 0, page: 3 })).toBeCloseTo(0.05)
    expect(estimateProgress({ ...base, spineIndex: 5, page: 1 })).toBeCloseTo(0.5)
  })

  it('is exactly one at the end of the book', () => {
    expect(estimateProgress({ ...base, spineIndex: 9, page: 4, atEnd: true })).toBe(1)
  })

  it('stays within 0..1 for odd input', () => {
    expect(estimateProgress({ ...base, spineIndex: 0, page: 99 })).toBeLessThanOrEqual(1)
    expect(estimateProgress({ ...base, spineIndex: 50, page: 1 })).toBe(1)
    expect(estimateProgress({ ...base, spineIndex: -1, page: 1 })).toBe(0)
    expect(estimateProgress({ ...base, spineLength: 0, spineIndex: 0, page: 1 })).toBe(0)
    expect(estimateProgress({ ...base, pageCount: 0, spineIndex: 2, page: 1 })).toBeCloseTo(0.2)
  })

  it('formats a percentage without rounding up to 100 early', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.999)).toBe('99%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(2)).toBe('100%')
    expect(formatPercent(-1)).toBe('0%')
  })
})

describe('table of contents hrefs', () => {
  it('resolves hrefs relative to the contents file', () => {
    expect(resolveHref('', 'ch1.xhtml')).toBe('ch1.xhtml')
    expect(resolveHref('text', 'ch1.xhtml#s2')).toBe('text/ch1.xhtml#s2')
    expect(resolveHref('text', '../ch1.xhtml')).toBe('ch1.xhtml')
    expect(resolveHref('a/b', './c/../d.xhtml')).toBe('a/b/d.xhtml')
  })

  it('never climbs above the book root and leaves absolute links alone', () => {
    expect(resolveHref('text', '../../x.xhtml')).toBe('x.xhtml')
    expect(resolveHref('text', 'https://example.com/x')).toBe('https://example.com/x')
  })

  it('finds the folder of a path', () => {
    expect(dirName('nav.xhtml')).toBe('')
    expect(dirName('text/nav.xhtml')).toBe('text')
    expect(dirName('a/b/toc.ncx')).toBe('a/b')
  })
})

describe('chapterForHref', () => {
  const toc: TocItem[] = [
    { id: 'a', label: 'One', href: 'ch1.xhtml', depth: 0 },
    { id: 'b', label: 'One, part two', href: 'ch1.xhtml#part2', depth: 1 },
    { id: 'c', label: 'Two', href: 'OEBPS/ch2.xhtml', depth: 0 },
  ]

  it('finds the first entry for a file, ignoring fragments', () => {
    expect(chapterForHref(toc, 'ch1.xhtml')?.id).toBe('a')
    expect(chapterForHref(toc, 'ch1.xhtml#part2')?.id).toBe('a')
  })

  it('matches paths written relative to different folders', () => {
    expect(chapterForHref(toc, 'ch2.xhtml')?.id).toBe('c')
  })

  it('does not match a different file with a similar name', () => {
    expect(chapterForHref(toc, 'xch1.xhtml')).toBeNull()
  })

  it('returns null when there is nothing to match', () => {
    expect(chapterForHref(toc, null)).toBeNull()
    expect(chapterForHref([], 'ch1.xhtml')).toBeNull()
  })
})
