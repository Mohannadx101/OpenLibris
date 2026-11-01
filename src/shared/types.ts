/**
 * Domain types shared by main, preload and renderer.
 *
 * Phase 0 only needs the pieces that the database schema and IPC skeleton refer to.
 * Locator and annotation types are defined now (see docs/adr/0002) because they shape
 * the schema, but nothing produces or consumes them until the reader phases.
 */

export type BookFormat = 'epub' | 'pdf'

export type { Locator } from './reading'

/** A highlighted span of text. Redrawable at any font size or zoom level. */
export type AnnotationRange =
  | { format: 'epub'; cfiRange: string }
  /** Character offsets into the page's extracted text content. */
  | { format: 'pdf'; page: number; startOffset: number; endOffset: number }

export interface AppInfo {
  name: string
  version: string
  platform: string
  /** Version of the database schema currently applied (PRAGMA user_version). */
  schemaVersion: number
  /** Absolute path of the folder holding the database and the book library. */
  dataDir: string
}

/** File extensions the library accepts, lower-case, without the dot. */
export const BOOK_EXTENSIONS = ['epub', 'pdf'] as const
