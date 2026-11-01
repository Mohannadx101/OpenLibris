import styles from './EmptyState.module.css'

export function EmptyState({
  filtered,
  importing,
  onAddBooks,
}: {
  /** True when books exist but the search matched none of them. */
  filtered: boolean
  importing: boolean
  onAddBooks: () => void
}) {
  if (filtered) {
    return (
      <section className={styles.empty}>
        <h2>No matching books</h2>
        <p>Try a different title or author.</p>
      </section>
    )
  }

  return (
    <section className={styles.empty}>
      <h2>Your bookshelf is empty</h2>
      <p>Add EPUB or PDF books, or drop the files anywhere in this window.</p>
      <button type="button" onClick={onAddBooks} disabled={importing}>
        {importing ? 'Importing…' : 'Add books'}
      </button>
    </section>
  )
}
