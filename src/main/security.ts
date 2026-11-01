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
 * EPUB chapters are shown by EPUB.js in sandboxed `srcdoc` frames (scripts off), which inherit
 * this policy. Three directives are widened for that, each as narrowly as it can be:
 *  - `style-src blob:` and `font-src blob:`: EPUB.js turns a book's own stylesheets and fonts
 *    into blob URLs. They come from the book file the user imported, never from the network.
 *  - `base-uri 'self'`: EPUB.js puts a <base> tag in each chapter. Without this every chapter
 *    logs a CSP error. It does not let a book load anything: scripts are off and every
 *    fetch directive above still applies.
 * `frame-src` stays 'none': `srcdoc` frames are not governed by it, so a book still cannot
 * embed any page.
 *
 * The PDF reader (Phase 3) runs without PDF.js's WebAssembly decoders. Enabling them needs `wasm-unsafe-eval`; widen deliberately, with
 * a test, when that happens.
 */
export function buildContentSecurityPolicy({ dev, devServerOrigin }: CspOptions): string {
  const origin = dev && devServerOrigin ? devServerOrigin : ''
  const ws = origin ? origin.replace(/^http/, 'ws') : ''

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    // Inline styles are needed by React style props and by EPUB/PDF rendering.
    'style-src': ["'self'", "'unsafe-inline'", 'blob:'],
    'img-src': ["'self'", 'data:', 'blob:', `${LIBRARY_SCHEME}:`],
    'font-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", `${LIBRARY_SCHEME}:`, ...(dev ? [origin, ws] : [])],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
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
