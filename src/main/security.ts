import { fileURLToPath } from 'node:url'
import { LIBRARY_SCHEME } from './libraryUrl'

export interface CspOptions {
  dev: boolean
  /** Origin of the Vite dev server, e.g. http://localhost:5173. Only used when dev is true. */
  devServerOrigin?: string
}

/**
 * Content-Security-Policy for the renderer.
 *
 * Production allows only the app's own bundled scripts. Development additionally allows what
 * Vite's hot reloading needs (inline preamble script, websocket).
 *
 * Phase 3 will need `'wasm-unsafe-eval'` for PDF.js image decoders; Phase 2 may need to widen
 * `frame-src` for EPUB chapter frames. Widen deliberately, with a test, when that happens.
 */
export function buildContentSecurityPolicy({ dev, devServerOrigin }: CspOptions): string {
  const origin = dev && devServerOrigin ? devServerOrigin : ''
  const ws = origin ? origin.replace(/^http/, 'ws') : ''

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    // Inline styles are needed by React style props and by EPUB/PDF rendering.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', `${LIBRARY_SCHEME}:`],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", `${LIBRARY_SCHEME}:`, ...(dev ? [origin, ws] : [])],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  }

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.filter(Boolean).join(' ')}`)
    .join('; ')
}

export interface UrlGuardOptions {
  /** URL of the Vite dev server when running in development. */
  devServerUrl?: string | undefined
  /** Absolute path of the built renderer entry (index.html) for production. */
  rendererFile: string
}

/**
 * Returns a predicate that is true only for the app's own renderer page (any hash/query).
 * Used to block navigation away from the app and to reject IPC from foreign frames.
 */
export function createAppUrlGuard({ devServerUrl, rendererFile }: UrlGuardOptions) {
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined

  return (rawUrl: string): boolean => {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return false
    }

    if (devOrigin && url.origin === devOrigin) return true

    if (url.protocol === 'file:') {
      try {
        return fileURLToPath(url) === rendererFile
      } catch {
        return false
      }
    }

    return false
  }
}
