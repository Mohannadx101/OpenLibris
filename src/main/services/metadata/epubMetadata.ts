import { posix } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import { sniffImageExtension } from '../library/fileUtils'
import type { CoverExtension } from '../library/fileUtils'

export interface EpubMetadata {
  title: string | null
  author: string | null
  language: string | null
  cover: { bytes: Uint8Array; extension: CoverExtension } | null
}

export class EpubError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EpubError'
  }
}

/** Refuse to inflate suspiciously large entries (a zip-bomb guard). */
const MAX_XML_BYTES = 5 * 1024 * 1024
const MAX_COVER_BYTES = 20 * 1024 * 1024

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // "dc:title" → "title", "opf:role" → "@_role": EPUBs use many namespace prefix styles.
  removeNSPrefix: true,
  // Keep "1984" a string rather than the number 1984.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['title', 'creator', 'language', 'item', 'meta', 'rootfile'].includes(name),
})

type XmlNode = Record<string, unknown>

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

/** An element's text, whether the parser produced a string or { '#text': …, '@_id': … }. */
function textOf(node: unknown): string | null {
  const raw =
    typeof node === 'string'
      ? node
      : typeof node === 'object' && node !== null
        ? (node as XmlNode)['#text']
        : undefined
  if (typeof raw !== 'string') return null
  const text = raw.replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

function attr(node: unknown, name: string): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const value = (node as XmlNode)[`@_${name}`]
  return typeof value === 'string' ? value : undefined
}

/** Finds a zip entry, tolerating differences in letter case that some EPUBs have. */
function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const exact = zip.file(path)
  if (exact) return exact
  const lower = path.toLowerCase()
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lower) return zip.files[name] ?? null
  }
  return null
}

function declaredSize(entry: JSZip.JSZipObject): number | undefined {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
  return typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : undefined
}

async function readEntry(zip: JSZip, path: string, maxBytes: number): Promise<Uint8Array | null> {
  const entry = findEntry(zip, path)
  if (!entry || entry.dir) return null
  const size = declaredSize(entry)
  if (size !== undefined && size > maxBytes) return null
  const bytes = await entry.async('uint8array')
  return bytes.length > maxBytes ? null : bytes
}

/** Resolves an href from the OPF into a zip entry path, or null if it escapes the archive. */
export function resolveHref(opfPath: string, href: string): string | null {
  const withoutQuery = href.split(/[?#]/)[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    decoded = withoutQuery
  }
  const base = posix.dirname(opfPath)
  const joined = posix.normalize(base === '.' ? decoded : `${base}/${decoded}`)
  return joined.startsWith('..') || joined.startsWith('/') ? null : joined
}

/** Picks the cover image's manifest href using the EPUB 3 and EPUB 2 conventions. */
export function findCoverHref(opf: XmlNode): string | null {
  const pkg = opf['package'] as XmlNode | undefined
  const manifestItems = asArray((pkg?.['manifest'] as XmlNode | undefined)?.['item'])
  const metaEntries = asArray((pkg?.['metadata'] as XmlNode | undefined)?.['meta'])

  const isImage = (item: unknown) => (attr(item, 'media-type') ?? '').startsWith('image/')

  // EPUB 3: <item properties="cover-image" …>
  const byProperty = manifestItems.find(
    (item) => attr(item, 'properties')?.split(/\s+/).includes('cover-image') && isImage(item),
  )
  if (byProperty) return attr(byProperty, 'href') ?? null

  // EPUB 2: <meta name="cover" content="<manifest id>"/>
  const coverId = metaEntries
    .filter((meta) => attr(meta, 'name') === 'cover')
    .map((meta) => attr(meta, 'content'))
    .find((id): id is string => typeof id === 'string')
  if (coverId) {
    const byId = manifestItems.find((item) => attr(item, 'id') === coverId && isImage(item))
    if (byId) return attr(byId, 'href') ?? null
  }

  // Last resort: a manifest image whose id looks like a cover.
  const byName = manifestItems.find(
    (item) => /^cover([-_]?image)?$/i.test(attr(item, 'id') ?? '') && isImage(item),
  )
  return byName ? (attr(byName, 'href') ?? null) : null
}

function joinAuthors(creators: unknown[]): string | null {
  const names: string[] = []
  for (const creator of creators) {
    // opf:role="aut" marks authors; skip illustrators, translators, editors, etc.
    const role = attr(creator, 'role')
    if (role && role.toLowerCase() !== 'aut') continue
    const name = textOf(creator)
    if (name && !names.includes(name)) names.push(name)
  }
  return names.length > 0 ? names.join(', ') : null
}

/** Reads title, author, language and cover from an EPUB file's bytes. */
export async function readEpubMetadata(data: Uint8Array): Promise<EpubMetadata> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch (cause) {
    throw new EpubError('The file is not a valid EPUB (it could not be opened as a zip).', {
      cause,
    })
  }

  const containerBytes = await readEntry(zip, 'META-INF/container.xml', MAX_XML_BYTES)
  if (!containerBytes) throw new EpubError('The file is not a valid EPUB (no container.xml).')

  const container = parser.parse(Buffer.from(containerBytes).toString('utf8')) as XmlNode
  const rootfiles = asArray(
    ((container['container'] as XmlNode | undefined)?.['rootfiles'] as XmlNode | undefined)?.[
      'rootfile'
    ],
  )
  const opfPath = rootfiles.map((r) => attr(r, 'full-path')).find((p) => typeof p === 'string')
  if (!opfPath) throw new EpubError('The file is not a valid EPUB (no package document).')

  const opfBytes = await readEntry(zip, opfPath, MAX_XML_BYTES)
  if (!opfBytes) throw new EpubError('The EPUB package document is missing or too large.')

  const opf = parser.parse(Buffer.from(opfBytes).toString('utf8')) as XmlNode
  const metadata = (opf['package'] as XmlNode | undefined)?.['metadata'] as XmlNode | undefined

  const title = asArray(metadata?.['title'])
    .map(textOf)
    .find((t): t is string => t !== null)
  const language = asArray(metadata?.['language'])
    .map(textOf)
    .find((l): l is string => l !== null)

  let cover: EpubMetadata['cover'] = null
  const coverHref = findCoverHref(opf)
  if (coverHref) {
    const coverPath = resolveHref(opfPath, coverHref)
    const bytes = coverPath ? await readEntry(zip, coverPath, MAX_COVER_BYTES) : null
    // Identify the image by its content, not by the manifest's (sometimes wrong) media-type.
    const extension = bytes ? sniffImageExtension(bytes) : null
    if (bytes && extension) cover = { bytes, extension }
  }

  return {
    title: title ?? null,
    author: joinAuthors(asArray(metadata?.['creator'])),
    language: language ?? null,
    cover,
  }
}
