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
})
export type OpenedBook = z.infer<typeof openedBookSchema>

export const savePositionSchema = z.object({
  bookId: z.string().uuid(),
  locator: locatorSchema,
  progress: progressSchema,
})
export type SavePositionInput = z.infer<typeof savePositionSchema>
