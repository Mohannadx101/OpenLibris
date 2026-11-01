import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import type { BookFormat } from '@shared/types'

/** SHA-256 of a file, streamed so large books never sit fully in memory. */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Last path segment, for both Windows and POSIX separators regardless of the host OS. */
export function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

export function extensionOf(filePath: string): string {
  const name = baseName(filePath)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** A readable fallback title from a file name: "My_Book.epub" → "My Book". */
export function titleFromFileName(filePath: string): string {
  const name = baseName(filePath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const cleaned = stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || 'Untitled'
}

/**
 * Decides whether a file really is the format its extension claims, by looking at its first
 * bytes. Never trusts the extension alone, so a renamed file cannot be imported as a book.
 */
export function detectFormatFromHeader(extension: string, header: Uint8Array): BookFormat | null {
  if (extension === 'pdf') {
    // The spec allows junk before "%PDF-" within the first 1024 bytes.
    const text = Buffer.from(header.subarray(0, 1024)).toString('latin1')
    return text.includes('%PDF-') ? 'pdf' : null
  }
  if (extension === 'epub') {
    // An EPUB is a ZIP archive: "PK\x03\x04".
    const isZip =
      header.length >= 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04
    return isZip ? 'epub' : null
  }
  return null
}

export async function detectFormat(filePath: string): Promise<BookFormat | null> {
  const extension = extensionOf(filePath)
  if (extension !== 'pdf' && extension !== 'epub') return null

  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return detectFormatFromHeader(extension, buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

export type CoverExtension = 'jpg' | 'png' | 'webp'

/** Identifies an image by its bytes. Returns null for anything the library does not serve. */
export function sniffImageExtension(bytes: Uint8Array): CoverExtension | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}
