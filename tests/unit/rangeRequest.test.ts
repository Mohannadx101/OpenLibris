import { describe, expect, it } from 'vitest'
import { mimeTypeFor, parseRangeHeader } from '@main/rangeRequest'

describe('parseRangeHeader', () => {
  const SIZE = 1000

  it('serves the whole file when there is no usable Range header', () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull()
    expect(parseRangeHeader(undefined, SIZE)).toBeNull()
    expect(parseRangeHeader('', SIZE)).toBeNull()
    expect(parseRangeHeader('bytes=', SIZE)).toBeNull()
    expect(parseRangeHeader('bytes=-', SIZE)).toBeNull()
    expect(parseRangeHeader('items=0-5', SIZE)).toBeNull()
    expect(parseRangeHeader('garbage', SIZE)).toBeNull()
  })

  it('ignores multi-range requests (allowed by HTTP) rather than half-supporting them', () => {
    expect(parseRangeHeader('bytes=0-5,10-15', SIZE)).toBeNull()
  })

  it('parses an explicit range', () => {
    expect(parseRangeHeader('bytes=10-19', SIZE)).toEqual({ start: 10, end: 19 })
    expect(parseRangeHeader('bytes=0-0', SIZE)).toEqual({ start: 0, end: 0 })
  })

  it('parses an open-ended range', () => {
    expect(parseRangeHeader('bytes=990-', SIZE)).toEqual({ start: 990, end: 999 })
    expect(parseRangeHeader('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end beyond the file', () => {
    expect(parseRangeHeader('bytes=900-5000', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('parses a suffix range (the last N bytes)', () => {
    expect(parseRangeHeader('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 })
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('reports ranges outside the file as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=1000-1010', SIZE)).toBe('unsatisfiable')
    expect(parseRangeHeader('bytes=5000-', SIZE)).toBe('unsatisfiable')
    expect(parseRangeHeader('bytes=-0', SIZE)).toBe('unsatisfiable')
    expect(parseRangeHeader('bytes=0-5', 0)).toBe('unsatisfiable')
  })

  it('ignores a reversed range', () => {
    expect(parseRangeHeader('bytes=20-10', SIZE)).toBeNull()
  })
})

describe('mimeTypeFor', () => {
  it('knows the types the library serves', () => {
    expect(mimeTypeFor('/x/book.epub')).toBe('application/epub+zip')
    expect(mimeTypeFor('/x/book.pdf')).toBe('application/pdf')
    expect(mimeTypeFor('/x/cover.jpg')).toBe('image/jpeg')
    expect(mimeTypeFor('/x/cover.PNG')).toBe('image/png')
    expect(mimeTypeFor('/x/cover.webp')).toBe('image/webp')
  })

  it('falls back to a generic binary type', () => {
    expect(mimeTypeFor('/x/mystery.bin')).toBe('application/octet-stream')
  })
})
