import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { libraryUrlFor, resolveLibraryUrl } from '@main/libraryUrl'

const LIB = join('/data', 'library')
const ID = '123e4567-e89b-12d3-a456-426614174000'

describe('resolveLibraryUrl', () => {
  it('maps valid book and cover URLs into the library folder', () => {
    expect(resolveLibraryUrl(LIB, `book://library/${ID}/book.epub`)).toBe(
      join(LIB, ID, 'book.epub'),
    )
    expect(resolveLibraryUrl(LIB, `book://library/${ID}/book.pdf`)).toBe(join(LIB, ID, 'book.pdf'))
    expect(resolveLibraryUrl(LIB, `book://library/${ID}/cover.jpg`)).toBe(
      join(LIB, ID, 'cover.jpg'),
    )
  })

  it.each([
    ['path traversal', `book://library/${ID}/../../etc/passwd`],
    ['encoded traversal', `book://library/${ID}/%2e%2e/%2e%2e/etc/passwd`],
    ['encoded slash traversal', `book://library/%2e%2e%2f%2e%2e%2fetc/passwd`],
    ['backslash traversal', `book://library/${ID}/..%5C..%5Csecret`],
    ['non-uuid folder', 'book://library/not-a-uuid/book.epub'],
    ['unknown file name', `book://library/${ID}/library.db`],
    ['extra path segment', `book://library/${ID}/sub/book.epub`],
    ['wrong host', `book://elsewhere/${ID}/book.epub`],
    ['wrong scheme', `https://library/${ID}/book.epub`],
    ['file scheme', `file:///etc/passwd`],
    ['empty path', 'book://library/'],
    ['malformed encoding', `book://library/${ID}/%E0%A4%A`],
    ['not a URL', 'nonsense'],
  ])('rejects %s', (_label, url) => {
    expect(resolveLibraryUrl(LIB, url)).toBeNull()
  })
})

describe('libraryUrlFor', () => {
  it('builds URLs that resolveLibraryUrl accepts', () => {
    for (const file of ['book.epub', 'book.pdf', 'cover.jpg', 'cover.png', 'cover.webp']) {
      const url = libraryUrlFor(`${ID}/${file}`)
      expect(resolveLibraryUrl(LIB, url)).toBe(join(LIB, ID, file))
    }
  })
})
