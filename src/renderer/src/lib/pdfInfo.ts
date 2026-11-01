import type { PDFDocumentProxy } from 'pdfjs-dist'
import { cleanPdfAuthor, cleanPdfLanguage, cleanPdfTitle } from './pdfText'

export interface PdfInfo {
  title: string | null
  author: string | null
  language: string | null
  /** Encoded JPEG of page 1, or null if it could not be rendered. */
  cover: Uint8Array<ArrayBuffer> | null
}

const COVER_WIDTH = 420
const MAX_SCALE = 3
const TIMEOUT_MS = 45_000

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

async function renderCover(doc: PDFDocumentProxy): Promise<Uint8Array<ArrayBuffer> | null> {
  const page = await doc.getPage(1)
  try {
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(MAX_SCALE, COVER_WIDTH / base.width)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) return null

    // PDF pages are transparent; JPEG has no alpha, so paint paper first.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, canvas, viewport }).promise

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    )
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } finally {
    page.cleanup()
  }
}

async function readInfo(url: string): Promise<PdfInfo> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    url,
    // Non-embedded fonts fall back to the ones installed on the system.
    useSystemFonts: true,
    // WebAssembly image decoders (JPEG 2000, JBIG2) need extra CSP and bundled files; PDFs that
    // use them still get a title and author, only the cover may be blank. Revisited in Phase 3.
    useWasm: false,
  })

  const timer = setTimeout(() => void task.destroy(), TIMEOUT_MS)
  try {
    const doc = await task.promise
    try {
      const { info, metadata } = await doc.getMetadata()
      const fields = info as Record<string, unknown>

      // The XMP packet, when present, is usually better maintained than the legacy Info dict.
      const xmp = (key: string): unknown => metadata?.get(key) ?? undefined
      const creator = xmp('dc:creator')

      let cover: Uint8Array<ArrayBuffer> | null = null
      try {
        cover = await renderCover(doc)
      } catch (error) {
        // A page that will not render must not cost us the title and author.
        console.warn('[pdf] cover rendering failed:', error)
      }

      return {
        title: cleanPdfTitle(fields['Title']) ?? cleanPdfTitle(xmp('dc:title')),
        author:
          cleanPdfAuthor(fields['Author']) ??
          cleanPdfAuthor(Array.isArray(creator) ? creator.join(', ') : creator),
        language: cleanPdfLanguage(fields['Language']) ?? cleanPdfLanguage(xmp('dc:language')),
        cover,
      }
    } finally {
      clearTimeout(timer)
    }
  } finally {
    // Also covers a document that failed to open. Safe to call more than once.
    await task.destroy().catch(() => undefined)
  }
}

/** Reads title, author and a page-1 cover from a PDF the app serves at `url`. Throws on failure. */
export function extractPdfInfo(url: string): Promise<PdfInfo> {
  return readInfo(url)
}
