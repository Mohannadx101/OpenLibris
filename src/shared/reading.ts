import { z } from 'zod'
import { bookSchema } from './library'

/**
 * A saved reading position. Format-specific so it survives layout changes (ADR 0002).
 * EPUB: a CFI. PDF: page number plus the fractional vertical offset within the page.
 */
export const locatorSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('epub'), cfi: z.string().min(1).max(4096) }),
  z.object({
    format: z.literal('pdf'),
    page: z.number().int().min(1),
    offsetY: z.number().min(0).max(1),
  }),
])
export type Locator = z.infer<typeof locatorSchema>

/** Fraction of the book read, 0 to 1. */
export const progressSchema = z.number().min(0).max(1)

export const readingStateSchema = z.object({
  locator: locatorSchema,
  progress: progressSchema,
  updatedAt: z.number(),
})
export type ReadingState = z.infer<typeof readingStateSchema>

/** What the reader needs to open a book: the book itself and where the user left off. */
export const openedBookSchema = z.object({
  book: bookSchema,
  /** Null for a book that has never been opened. */
  state: readingStateSchema.nullable(),
  /** The saved EPUB location index (a JSON array of CFIs), or null if not built yet. */
  locations: z.string().nullable(),
})
export type OpenedBook = z.infer<typeof openedBookSchema>

export const savePositionSchema = z.object({
  bookId: z.string().uuid(),
  locator: locatorSchema,
  progress: progressSchema,
})
export type SavePositionInput = z.infer<typeof savePositionSchema>

/** Largest location index main will store. A very long book is a few hundred kilobytes. */
export const MAX_LOCATIONS_BYTES = 8 * 1024 * 1024

export const saveLocationsSchema = z.object({
  bookId: z.string().uuid(),
  data: z.string().min(2).max(MAX_LOCATIONS_BYTES),
})
export type SaveLocationsInput = z.infer<typeof saveLocationsSchema>
