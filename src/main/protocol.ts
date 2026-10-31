import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { LIBRARY_SCHEME, resolveLibraryUrl } from './libraryUrl'
import { mimeTypeFor, parseRangeHeader } from './rangeRequest'

/**
 * Must run before the app is ready. `standard` + `secure` make book:// behave like a normal
 * web origin (so PDF.js and EPUB.js can fetch from it); `corsEnabled` lets the renderer's
 * page fetch it cross-origin; `stream` enables streaming bodies.
 */
export function registerLibrarySchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LIBRARY_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

// The renderer's origin differs from book://, so responses need CORS headers, and the
// range-related ones must be exposed explicitly or PDF.js cannot read them. Only the app's own
// window can ever load this scheme, so allowing any origin does not widen access.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: CORS_HEADERS })
}

/**
 * Serves book files and covers from the library folder. This is the only way the renderer can
 * read them; it never gets general file access. Range requests are handled here (rather than
 * delegated) so PDF.js can load large files incrementally with correct 206 responses.
 */
export function registerLibraryProtocol(libraryDir: string): void {
  protocol.handle(LIBRARY_SCHEME, async (request) => {
    const filePath = resolveLibraryUrl(libraryDir, request.url)
    if (!filePath) return notFound()

    let size: number
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return notFound()
      size = info.size
    } catch {
      // The URL is valid but the file is not there (deleted, or not imported yet).
      return notFound()
    }

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      'Content-Type': mimeTypeFor(filePath),
      'Accept-Ranges': 'bytes',
    }

    const range = parseRangeHeader(request.headers.get('range'), size)

    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${size}` },
      })
    }

    const status = range ? 206 : 200
    const start = range?.start ?? 0
    const end = range?.end ?? size - 1
    headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

    if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })

    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new Response(body, { status, headers })
  })
}
