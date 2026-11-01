import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Book } from '@shared/library'
import { formatFileSize, progressLabel } from '../shelf'
import { CoverPlaceholder } from './CoverPlaceholder'
import styles from './BookCard.module.css'

export function BookCard({ book, onRemove }: { book: Book; onRemove: (book: Book) => void }) {
  // A cover file that fails to load (deleted, corrupt) falls back to the placeholder.
  const [coverFailed, setCoverFailed] = useState(false)
  const showImage = book.coverUrl !== null && !coverFailed
  const progress = progressLabel(book.progress)

  return (
    <li className={styles.card}>
      <div className={styles.cover}>
        <Link
          to={`/read/${book.id}`}
          className={styles.open}
          aria-label={`Read ${book.title}`}
          title={book.title}
        >
          {showImage ? (
            <img
              src={book.coverUrl ?? undefined}
              alt={`Cover of ${book.title}`}
              loading="lazy"
              decoding="async"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <CoverPlaceholder title={book.title} author={book.author} />
          )}
        </Link>
        <span className={styles.format}>{book.format.toUpperCase()}</span>
        {progress !== null && (
          <div
            className={styles.progress}
            role="progressbar"
            aria-label={`Progress in ${book.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor((book.progress ?? 0) * 100)}
          >
            <div
              className={styles.progressFill}
              style={{ width: `${(book.progress ?? 0) * 100}%` }}
            />
          </div>
        )}
        <button
          type="button"
          className={styles.remove}
          onClick={() => onRemove(book)}
          aria-label={`Remove ${book.title} from library`}
          title="Remove from library"
        >
          ×
        </button>
      </div>
      <div className={styles.details}>
        <h2 className={styles.title} title={book.title}>
          {book.title}
        </h2>
        <p className={styles.author}>{book.author ?? 'Unknown author'}</p>
        <p className={styles.meta}>
          {book.needsEnrichment
            ? 'Reading book details…'
            : progress !== null
              ? `${progress} · ${formatFileSize(book.fileSize)}`
              : formatFileSize(book.fileSize)}
        </p>
      </div>
    </li>
  )
}
