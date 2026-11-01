import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'

// Smallest byte sequences that identify as each image type.
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
export const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
export const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])

export interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
}

export interface OpfOptions {
  titles?: string[]
  creators?: { name: string; role?: string }[]
  languages?: string[]
  manifest?: ManifestItem[]
  /** Extra raw <meta> lines, e.g. '<meta name="cover" content="img"/>'. */
  metas?: string[]
}

/** Builds an OPF package document. Uses the dc:/opf: prefixes most real EPUBs use. */
export function buildOpf(options: OpfOptions = {}): string {
  const { titles = [], creators = [], languages = [], manifest = [], metas = [] } = options
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    ${titles.map((t) => `<dc:title>${t}</dc:title>`).join('\n    ')}
    ${creators
      .map((c) => `<dc:creator${c.role ? ` opf:role="${c.role}"` : ''}>${c.name}</dc:creator>`)
      .join('\n    ')}
    ${languages.map((l) => `<dc:language>${l}</dc:language>`).join('\n    ')}
    ${metas.join('\n    ')}
  </metadata>
  <manifest>
    ${manifest
      .map(
        (m) =>
          `<item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"${
            m.properties ? ` properties="${m.properties}"` : ''
          }/>`,
      )
      .join('\n    ')}
  </manifest>
  <spine/>
</package>`
}

export interface EpubOptions {
  opf?: string
  opfPath?: string
  /** Extra entries, by path inside the archive. */
  files?: Record<string, Uint8Array | string>
  /** Pass null to leave container.xml out entirely. */
  container?: string | null
}

/** Builds a complete EPUB archive in memory. */
export async function buildEpub(options: EpubOptions = {}): Promise<Uint8Array> {
  const opfPath = options.opfPath ?? 'OEBPS/content.opf'
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  if (options.container !== null) {
    zip.file(
      'META-INF/container.xml',
      options.container ??
        `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    )
  }
  zip.file(opfPath, options.opf ?? buildOpf({ titles: ['Untitled Fixture'] }))
  for (const [path, content] of Object.entries(options.files ?? {})) zip.file(path, content)
  return zip.generateAsync({ type: 'uint8array' })
}

/** A tiny but header-valid PDF. PDF.js is not involved in main-process tests. */
export function buildPdf(label = 'fixture'): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${label}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  )
}

/** A scratch folder that is removed by `cleanup()`. */
export function makeTempDir(prefix = 'openlibris-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    file(name: string, content: Uint8Array | string): string {
      const path = join(dir, name)
      writeFileSync(path, content)
      return path
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Deterministic, valid UUIDs for tests: 00000000-0000-4000-8000-000000000001, … */
export function uuidSequence(): () => string {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}
