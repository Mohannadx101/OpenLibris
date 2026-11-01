import { SORT_LABELS } from '../shelf'
import type { SortKey } from '../shelf'
import styles from './LibraryToolbar.module.css'

interface Props {
  bookCount: number
  query: string
  sort: SortKey
  importing: boolean
  onQueryChange: (query: string) => void
  onSortChange: (sort: SortKey) => void
  onAddBooks: () => void
}

export function LibraryToolbar({
  bookCount,
  query,
  sort,
  importing,
  onQueryChange,
  onSortChange,
  onAddBooks,
}: Props) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.heading}>
        <h1>Library</h1>
        {bookCount > 0 && (
          <span className={styles.count}>
            {bookCount} {bookCount === 1 ? 'book' : 'books'}
          </span>
        )}
      </div>

      <div className={styles.controls}>
        {bookCount > 0 && (
          <>
            <input
              type="search"
              className={styles.search}
              placeholder="Search title or author"
              aria-label="Search your library"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <label className={styles.sort}>
              <span>Sort by</span>
              <select
                value={sort}
                onChange={(event) => onSortChange(event.target.value as SortKey)}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="button" className={styles.add} onClick={onAddBooks} disabled={importing}>
          {importing ? 'Importing…' : 'Add books'}
        </button>
      </div>
    </header>
  )
}
