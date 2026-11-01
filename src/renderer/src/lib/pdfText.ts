/** Placeholder authors that tools write when the real one is unknown. */
const JUNK_AUTHORS = new Set(['unknown', 'anonymous', 'author', 'admin', 'administrator', 'user'])

function asText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

/**
 * PDF "Title" fields are often leftovers from the authoring tool ("Microsoft Word - report.docx",
 * "Untitled"). Strip the noise and reject values that say nothing.
 */
export function cleanPdfTitle(raw: unknown): string | null {
  let title = asText(raw)
  if (!title) return null

  title = title.replace(/^microsoft (word|powerpoint|excel)\s*-\s*/i, '')
  title = title.replace(/\.(docx?|pptx?|xlsx?|indd|rtf|tex|pdf)$/i, '').trim()

  if (title === '' || /^untitled(\s*\d*)?$/i.test(title)) return null
  return title
}

export function cleanPdfAuthor(raw: unknown): string | null {
  const author = asText(raw)
  if (!author || JUNK_AUTHORS.has(author.toLowerCase())) return null
  return author
}

export function cleanPdfLanguage(raw: unknown): string | null {
  return asText(raw)
}
