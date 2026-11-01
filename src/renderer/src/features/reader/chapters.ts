import type { TocItem } from './adapters/ReaderAdapter'

const withoutFragment = (href: string) => href.split('#')[0] ?? ''

/** Compares file paths that may be written relative to different folders. */
function samePath(a: string, b: string): boolean {
  if (a === b) return true
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/**
 * Finds the chapter a file belongs to. When several entries point into the same file
 * (sections of one long chapter), the first one in reading order wins.
 */
export function chapterForHref(toc: TocItem[], href: string | null): TocItem | null {
  if (!href) return null
  const file = withoutFragment(href)
  if (!file) return null
  return toc.find((item) => samePath(withoutFragment(item.href), file)) ?? null
}

/**
 * Estimates how far through the book a position is, from 0 to 1.
 *
 * EPUBs have no fixed pages, so this counts each file in the book as an equal share and
 * measures how far through the current file the reader is. It is a progress indicator, not a
 * page number: exact positions are always stored as a CFI, never derived from this.
 */
export function estimateProgress(input: {
  spineIndex: number
  spineLength: number
  page: number
  pageCount: number
  atEnd: boolean
}): number {
  const { spineIndex, spineLength, page, pageCount, atEnd } = input
  if (atEnd) return 1
  if (spineLength <= 0 || spineIndex < 0) return 0

  const within = pageCount > 0 ? Math.min(Math.max(page - 1, 0) / pageCount, 1) : 0
  const value = (spineIndex + within) / spineLength
  return Math.min(Math.max(value, 0), 1)
}

export function formatPercent(progress: number): string {
  return `${Math.floor(Math.min(Math.max(progress, 0), 1) * 100)}%`
}

/**
 * Turns an href written relative to `baseDir` (the folder of the contents file) into one
 * relative to the book's package file, which is how the rest of the book names its files.
 * Query-free and fragment-preserving. Never climbs above the package root.
 */
export function resolveHref(baseDir: string, href: string): string {
  const hash = href.indexOf('#')
  const path = hash === -1 ? href : href.slice(0, hash)
  const fragment = hash === -1 ? '' : href.slice(hash)

  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/')) return href

  const parts: string[] = []
  for (const part of `${baseDir}/${path}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/') + fragment
}

/** The folder part of a package-relative path: "text/nav.xhtml" -> "text". */
export function dirName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}
