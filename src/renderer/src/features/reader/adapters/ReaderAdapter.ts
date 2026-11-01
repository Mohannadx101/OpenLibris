import type { Locator } from '@shared/reading'

/** One entry in a book's table of contents. `depth` 0 is a top-level chapter. */
export interface TocItem {
  id: string
  label: string
  href: string
  depth: number
}

/** Where the reader currently is, in a form that can be saved. */
export interface ReaderPosition {
  locator: Locator
  /** 0..1 through the whole book. An estimate for EPUB, exact for PDF. */
  progress: number
  /** The file (EPUB) the reader is in, used to name the current chapter. */
  href: string | null
}

/** A key press forwarded out of the book's own document, where the page cannot see it. */
export interface ReaderKey {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/**
 * What the reader screen needs from a format-specific renderer.
 *
 * The screen never imports EPUB.js or PDF.js. Each format implements this interface, so
 * navigation, position saving and (later) text-to-speech and annotations are written once.
 */
export interface ReaderAdapter {
  /** Loads the book and shows `initial`, or the start if it is null or can no longer be shown. */
  open(url: string, initial: Locator | null): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  goTo(href: string): Promise<void>
  toc(): TocItem[]
  onPosition(listener: (position: ReaderPosition) => void): () => void
  onKey(listener: (key: ReaderKey) => void): () => void
  /** Tells the adapter its container changed size. */
  resize(): void
  destroy(): void
}
