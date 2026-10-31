import { extname } from 'node:path'

export interface ByteRange {
  /** Inclusive start offset. */
  start: number
  /** Inclusive end offset. */
  end: number
}

/**
 * Interprets an HTTP `Range` header against a file of `size` bytes.
 *
 * - `null`          → no usable range; serve the whole file (200).
 * - `'unsatisfiable'` → the range is outside the file; answer 416.
 * - `{ start, end }` → serve that slice (206).
 *
 * Only a single `bytes=` range is supported, which is all PDF.js and EPUB.js ever send.
 * Anything else is ignored, which HTTP allows (the server may simply return the full body).
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null

  // Suffix form, "bytes=-N": the last N bytes.
  if (rawStart === '') {
    const suffixLength = Number(rawEnd)
    if (suffixLength === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'

  // "bytes=N-" runs to the end; an end beyond the file is clamped.
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return null

  return { start, end }
}

const MIME_TYPES: Record<string, string> = {
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
