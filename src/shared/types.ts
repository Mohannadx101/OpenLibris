/**
 * Domain types shared by main, preload and renderer.
 *
 * Phase 0 only needs the pieces that the database schema and IPC skeleton refer to.
 * Locator and annotation types are defined now (see docs/adr/0002) because they shape
 * the schema, but nothing produces or consumes them until the reader phases.
 */

export type BookFormat = 'epub' | 'pdf'

/** A saved reading position. Format-specific so it survives layout changes. */
export type Locator =
  | { format: 'epub'; cfi: string }
  /** `offsetY` is the fractional position within the page, 0..1. */
  | { format: 'pdf'; page: number; offsetY: number }

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
