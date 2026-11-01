import type { Book } from '@shared/library'

export type SortKey = 'recent' | 'title' | 'author'

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recently added',
  title: 'Title',
  author: 'Author',
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** True when every whitespace-separated term in the query appears in the title or author. */
export function matchesQuery(book: Book, query: string): boolean {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${book.title} ${book.author ?? ''}`.toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function compare(a: Book, b: Book, sort: SortKey): number {
  switch (sort) {
    case 'recent':
      return b.addedAt - a.addedAt || collator.compare(a.title, b.title)
    case 'title':
      return collator.compare(a.title, b.title)
    case 'author': {
      // Books without an author go last, so they do not crowd the top of the list.
      if (a.author === null && b.author !== null) return 1
      if (a.author !== null && b.author === null) return -1
      return collator.compare(a.author ?? '', b.author ?? '') || collator.compare(a.title, b.title)
    }
  }
}

/** The books to show: filtered by the search query and ordered. Does not modify the input. */
export function visibleBooks(books: readonly Book[], query: string, sort: SortKey): Book[] {
  return books.filter((book) => matchesQuery(book, query)).sort((a, b) => compare(a, b, sort))
}

/** A stable hue (0–359) for a title, used to colour its placeholder cover. */
export function hueForTitle(title: string): number {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

/** "1.2 MB" style size for the card details. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
