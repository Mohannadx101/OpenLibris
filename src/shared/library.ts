import { z } from 'zod'

/** Largest cover image main will accept from the renderer or an EPUB. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024

/** A book as the renderer sees it. File locations stay private to the main process. */
export const bookSchema = z.object({
  id: z.string(),
  format: z.enum(['epub', 'pdf']),
  title: z.string(),
  author: z.string().nullable(),
  language: z.string().nullable(),
  /** `book://` URL of the cover image, or null when the book has none (show a placeholder). */
  coverUrl: z.string().nullable(),
  fileSize: z.number(),
  addedAt: z.number(),
  lastOpenedAt: z.number().nullable(),
  /** True for a PDF whose title/author/cover the renderer has yet to extract. */
  needsEnrichment: z.boolean(),
})
export type Book = z.infer<typeof bookSchema>

/** What happened to one file in an import. */
export const importOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('imported'), fileName: z.string(), book: bookSchema }),
  z.object({ status: z.literal('duplicate'), fileName: z.string(), existingTitle: z.string() }),
  z.object({ status: z.literal('failed'), fileName: z.string(), reason: z.string() }),
])
export type ImportOutcome = z.infer<typeof importOutcomeSchema>

export const importResultSchema = z.object({
  /** True when the user dismissed the file dialog without choosing anything. */
  canceled: z.boolean(),
  outcomes: z.array(importOutcomeSchema),
})
export type ImportResult = z.infer<typeof importResultSchema>

/**
 * What the renderer extracted from a PDF with PDF.js. `failed` means extraction did not work
 * (encrypted, corrupt, unsupported); the book then keeps its file-name title and a placeholder.
 */
export const pdfMetadataSchema = z.object({
  id: z.string().uuid(),
  failed: z.boolean(),
  title: z.string().max(1000).nullable().optional(),
  author: z.string().max(1000).nullable().optional(),
  language: z.string().max(100).nullable().optional(),
  /** Encoded image bytes (JPEG/PNG/WebP). */
  cover: z
    .instanceof(Uint8Array)
    .refine((b) => b.length <= MAX_COVER_BYTES)
    .nullable()
    .optional(),
})
export type PdfMetadataInput = z.infer<typeof pdfMetadataSchema>
