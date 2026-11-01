import { describe, expect, it } from 'vitest'
import {
  EpubError,
  findCoverHref,
  readEpubMetadata,
  resolveHref,
} from '@main/services/metadata/epubMetadata'
import { buildEpub, buildOpf, JPEG, PNG, GIF } from './helpers/fixtures'

describe('readEpubMetadata', () => {
  it('reads title, author and language', async () => {
    const epub = await buildEpub({
      opf: buildOpf({
        titles: ['Dune'],
        creators: [{ name: 'Frank Herbert' }],
        languages: ['en'],
      }),
    })
    expect(await readEpubMetadata(epub)).toEqual({
      title: 'Dune',
      author: 'Frank Herbert',
      language: 'en',
      cover: null,
    })
  })

  it('keeps numeric titles as text', async () => {
    const epub = await buildEpub({ opf: buildOpf({ titles: ['1984'] }) })
    expect((await readEpubMetadata(epub)).title).toBe('1984')
  })

  it('joins several authors and ignores non-author roles and duplicates', async () => {
    const epub = await buildEpub({
      opf: buildOpf({
        titles: ['Good Omens'],
        creators: [
          { name: 'Terry Pratchett', role: 'aut' },
          { name: 'Neil Gaiman' },
          { name: 'Neil Gaiman' },
          { name: 'Some Illustrator', role: 'ill' },
        ],
      }),
    })
    expect((await readEpubMetadata(epub)).author).toBe('Terry Pratchett, Neil Gaiman')
  })

  it('uses the first title when there are several', async () => {
    const epub = await buildEpub({ opf: buildOpf({ titles: ['Main Title', 'Subtitle'] }) })
    expect((await readEpubMetadata(epub)).title).toBe('Main Title')
  })

  it('reports missing fields as null', async () => {
    const epub = await buildEpub({ opf: buildOpf() })
    expect(await readEpubMetadata(epub)).toEqual({
      title: null,
      author: null,
      language: null,
      cover: null,
    })
  })

  it('collapses stray whitespace in titles', async () => {
    const epub = await buildEpub({ opf: buildOpf({ titles: ['  A\n   Tale   of\tTwo Cities '] }) })
    expect((await readEpubMetadata(epub)).title).toBe('A Tale of Two Cities')
  })

  it('handles an OPF in the archive root', async () => {
    const epub = await buildEpub({
      opfPath: 'content.opf',
      opf: buildOpf({ titles: ['Root OPF'] }),
    })
    expect((await readEpubMetadata(epub)).title).toBe('Root OPF')
  })

  describe('covers', () => {
    it('finds an EPUB 3 cover-image', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          titles: ['A'],
          manifest: [
            {
              id: 'c',
              href: 'images/cover.jpg',
              mediaType: 'image/jpeg',
              properties: 'cover-image',
            },
          ],
        }),
        files: { 'OEBPS/images/cover.jpg': JPEG },
      })
      const { cover } = await readEpubMetadata(epub)
      expect(cover?.extension).toBe('jpg')
      expect(Array.from(cover?.bytes ?? [])).toEqual(Array.from(JPEG))
    })

    it('finds an EPUB 2 cover via <meta name="cover">', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          metas: ['<meta name="cover" content="cover-img"/>'],
          manifest: [{ id: 'cover-img', href: 'cover.png', mediaType: 'image/png' }],
        }),
        files: { 'OEBPS/cover.png': PNG },
      })
      expect((await readEpubMetadata(epub)).cover?.extension).toBe('png')
    })

    it('falls back to a manifest image with a cover-like id', async () => {
      const epub = await buildEpub({
        opf: buildOpf({ manifest: [{ id: 'cover', href: 'c.jpg', mediaType: 'image/jpeg' }] }),
        files: { 'OEBPS/c.jpg': JPEG },
      })
      expect((await readEpubMetadata(epub)).cover?.extension).toBe('jpg')
    })

    it('resolves URL-encoded and nested hrefs', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          manifest: [
            {
              id: 'c',
              href: 'my%20images/c%C3%A9.jpg',
              mediaType: 'image/jpeg',
              properties: 'cover-image',
            },
          ],
        }),
        files: { 'OEBPS/my images/cé.jpg': JPEG },
      })
      expect((await readEpubMetadata(epub)).cover).not.toBeNull()
    })

    it('trusts the file content, not the declared media type', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          manifest: [
            { id: 'c', href: 'c.jpg', mediaType: 'image/jpeg', properties: 'cover-image' },
          ],
        }),
        files: { 'OEBPS/c.jpg': PNG },
      })
      expect((await readEpubMetadata(epub)).cover?.extension).toBe('png')
    })

    it('ignores covers in formats the library cannot serve', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          titles: ['Keeps metadata'],
          manifest: [{ id: 'c', href: 'c.gif', mediaType: 'image/gif', properties: 'cover-image' }],
        }),
        files: { 'OEBPS/c.gif': GIF },
      })
      const result = await readEpubMetadata(epub)
      expect(result.cover).toBeNull()
      expect(result.title).toBe('Keeps metadata')
    })

    it('ignores a cover that is listed but missing from the archive', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          manifest: [
            { id: 'c', href: 'gone.jpg', mediaType: 'image/jpeg', properties: 'cover-image' },
          ],
        }),
      })
      expect((await readEpubMetadata(epub)).cover).toBeNull()
    })

    it('refuses a cover href that escapes the archive', async () => {
      const epub = await buildEpub({
        opf: buildOpf({
          manifest: [
            {
              id: 'c',
              href: '../../../secret.jpg',
              mediaType: 'image/jpeg',
              properties: 'cover-image',
            },
          ],
        }),
        files: { 'secret.jpg': JPEG },
      })
      expect((await readEpubMetadata(epub)).cover).toBeNull()
    })
  })

  describe('invalid files', () => {
    it('rejects something that is not a zip', async () => {
      await expect(readEpubMetadata(Buffer.from('not a zip'))).rejects.toThrow(EpubError)
    })

    it('rejects a zip without container.xml', async () => {
      await expect(readEpubMetadata(await buildEpub({ container: null }))).rejects.toThrow(
        /container/,
      )
    })

    it('rejects a container that names no package document', async () => {
      const epub = await buildEpub({
        container: '<container><rootfiles></rootfiles></container>',
      })
      await expect(readEpubMetadata(epub)).rejects.toThrow(/package document/)
    })

    it('rejects a container pointing at a missing package document', async () => {
      const epub = await buildEpub({
        container:
          '<container><rootfiles><rootfile full-path="nowhere.opf"/></rootfiles></container>',
      })
      await expect(readEpubMetadata(epub)).rejects.toThrow(/package document/)
    })
  })
})

describe('resolveHref', () => {
  it('resolves relative to the package document', () => {
    expect(resolveHref('OEBPS/content.opf', 'img/a.jpg')).toBe('OEBPS/img/a.jpg')
    expect(resolveHref('content.opf', 'a.jpg')).toBe('a.jpg')
    expect(resolveHref('OEBPS/text/c.opf', '../img/a.jpg')).toBe('OEBPS/img/a.jpg')
  })

  it('drops query and fragment, and decodes escapes', () => {
    expect(resolveHref('OEBPS/c.opf', 'a%20b.jpg#x')).toBe('OEBPS/a b.jpg')
  })

  it('refuses paths that leave the archive', () => {
    expect(resolveHref('OEBPS/c.opf', '../../x.jpg')).toBeNull()
    expect(resolveHref('c.opf', '../x.jpg')).toBeNull()
  })

  it('survives malformed escapes', () => {
    expect(resolveHref('c.opf', '100%.jpg')).toBe('100%.jpg')
  })
})

describe('findCoverHref', () => {
  it('returns null when the package has no manifest', () => {
    expect(findCoverHref({})).toBeNull()
    expect(findCoverHref({ package: {} })).toBeNull()
  })
})
