import { isAbsolute, join, relative, sep } from 'node:path'

/** Custom scheme through which the renderer reads book files and covers. */
export const LIBRARY_SCHEME = 'book'
const LIBRARY_HOST = 'library'

/** The URL the renderer uses for a file stored at `relativePath` (e.g. `<id>/cover.jpg`). */
export function libraryUrlFor(relativePath: string): string {
  return `${LIBRARY_SCHEME}://${LIBRARY_HOST}/${relativePath}`
}

// book://library/<bookId>/<file>. Only these exact shapes are ever served: a UUID folder and
// one of the known file names. Anything else, including any `..` trick, simply does not match.
const LIBRARY_PATH =
  /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(book\.(?:epub|pdf)|cover\.(?:jpg|png|webp))$/

/**
 * Maps a `book://` URL to an absolute file path inside `libraryDir`, or null if the URL is
 * not a valid library URL. Pure and synchronous so the security rules are easy to test.
 */
export function resolveLibraryUrl(libraryDir: string, rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== `${LIBRARY_SCHEME}:` || url.hostname !== LIBRARY_HOST) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }

  const match = LIBRARY_PATH.exec(pathname)
  if (!match) return null

  const resolved = join(libraryDir, match[1] as string, match[2] as string)

  // Defence in depth: the regex already makes escape impossible; verify it anyway.
  const rel = relative(libraryDir, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    return null
  }

  return resolved
}
