import { afterEach, describe, expect, it } from 'vitest'
import {
  baseName,
  detectFormat,
  detectFormatFromHeader,
  extensionOf,
  hashFile,
  sniffImageExtension,
  titleFromFileName,
} from '@main/services/library/fileUtils'
import { buildEpub, buildPdf, GIF, JPEG, makeTempDir, PNG, WEBP } from './helpers/fixtures'

const dirs: ReturnType<typeof makeTempDir>[] = []
function temp() {
  const t = makeTempDir()
  dirs.push(t)
  return t
}
afterEach(() => dirs.splice(0).forEach((d) => d.cleanup()))

describe('file names', () => {
  it('extracts the base name from Windows and POSIX paths alike', () => {
    expect(baseName('C:\\Users\\me\\Books\\Dune.epub')).toBe('Dune.epub')
    expect(baseName('/home/me/books/Dune.epub')).toBe('Dune.epub')
    expect(baseName('Dune.epub')).toBe('Dune.epub')
  })

  it('reads the extension in lower case', () => {
    expect(extensionOf('C:\\x\\Book.EPUB')).toBe('epub')
    expect(extensionOf('/x/archive.tar.pdf')).toBe('pdf')
    expect(extensionOf('/x/noextension')).toBe('')
    expect(extensionOf('/x/.hidden')).toBe('')
  })

  it('makes a readable title from a file name', () => {
    expect(titleFromFileName('C:\\x\\The_Great_Gatsby.epub')).toBe('The Great Gatsby')
    expect(titleFromFileName('/x/  spaced   out .pdf')).toBe('spaced out')
    expect(titleFromFileName('/x/Dune.v2.final.epub')).toBe('Dune.v2.final')
    expect(titleFromFileName('/x/.epub')).toBe('.epub')
    expect(titleFromFileName('/x/___.pdf')).toBe('Untitled')
  })
})

describe('format detection', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values)

  it('accepts a PDF header, even with junk in front of it', () => {
    expect(detectFormatFromHeader('pdf', Buffer.from('%PDF-1.7\n'))).toBe('pdf')
    expect(detectFormatFromHeader('pdf', Buffer.from('\u0000junk\n%PDF-1.4'))).toBe('pdf')
  })

  it('accepts a zip header for EPUB', () => {
    expect(detectFormatFromHeader('epub', bytes(0x50, 0x4b, 0x03, 0x04, 1))).toBe('epub')
  })

  it('rejects content that does not match the extension', () => {
    expect(detectFormatFromHeader('pdf', bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull()
    expect(detectFormatFromHeader('epub', Buffer.from('%PDF-1.4'))).toBeNull()
    expect(detectFormatFromHeader('epub', Buffer.from('hello world'))).toBeNull()
    expect(detectFormatFromHeader('txt', Buffer.from('%PDF-1.4'))).toBeNull()
  })

  it('reads the header from a real file', async () => {
    const t = temp()
    expect(await detectFormat(t.file('a.pdf', buildPdf()))).toBe('pdf')
    expect(await detectFormat(t.file('b.epub', await buildEpub()))).toBe('epub')
    expect(await detectFormat(t.file('c.epub', buildPdf()))).toBeNull()
    expect(await detectFormat(t.file('d.txt', 'text'))).toBeNull()
    expect(await detectFormat(t.file('e.pdf', ''))).toBeNull()
  })
})

describe('sniffImageExtension', () => {
  it('identifies images by content', () => {
    expect(sniffImageExtension(JPEG)).toBe('jpg')
    expect(sniffImageExtension(PNG)).toBe('png')
    expect(sniffImageExtension(WEBP)).toBe('webp')
  })

  it('rejects formats the library does not serve, and non-images', () => {
    expect(sniffImageExtension(GIF)).toBeNull()
    expect(sniffImageExtension(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImageExtension(new Uint8Array(0))).toBeNull()
    expect(sniffImageExtension(Uint8Array.from([0xff, 0xd8]))).toBeNull()
  })
})

describe('hashFile', () => {
  it('computes SHA-256', async () => {
    const t = temp()
    expect(await hashFile(t.file('abc.bin', 'abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('gives the same hash for identical content under different names', async () => {
    const t = temp()
    expect(await hashFile(t.file('one.pdf', buildPdf('x')))).toBe(
      await hashFile(t.file('two.pdf', buildPdf('x'))),
    )
  })

  it('rejects when the file is missing', async () => {
    await expect(hashFile('/definitely/not/here.pdf')).rejects.toThrow()
  })
})
