import type { ImportOutcome } from '@shared/library'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** One line describing an import: "2 books added · 1 already in your library". */
export function summarize(outcomes: ImportOutcome[]): string {
  const imported = outcomes.filter((o) => o.status === 'imported').length
  const duplicates = outcomes.filter((o) => o.status === 'duplicate').length
  const failed = outcomes.filter((o) => o.status === 'failed').length

  const parts: string[] = []
  if (imported > 0) parts.push(`${plural(imported, 'book', 'books')} added`)
  if (duplicates > 0) parts.push(`${duplicates} already in your library`)
  if (failed > 0) parts.push(`${failed} could not be imported`)
  return parts.join(' · ')
}
