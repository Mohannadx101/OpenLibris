import { useEffect, useRef } from 'react'
import type { Book } from '@shared/library'
import styles from './ConfirmRemoveDialog.module.css'

/** Asks before removing a book. Uses the native <dialog>, which handles focus and Escape. */
export function ConfirmRemoveDialog({
  book,
  onConfirm,
  onCancel,
}: {
  book: Book | null
  onConfirm: (book: Book) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (book && !dialog.open) dialog.showModal()
    if (!book && dialog.open) dialog.close()
  }, [book])

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={onCancel} onClose={onCancel}>
      {book && (
        <form method="dialog" onSubmit={(event) => event.preventDefault()}>
          <h2>Remove this book?</h2>
          <p>
            <strong>{book.title}</strong> will be removed from your library, along with its reading
            position, bookmarks and notes. Your original file is not touched.
          </p>
          <div className={styles.actions}>
            <button type="button" onClick={onCancel} autoFocus>
              Cancel
            </button>
            <button type="button" className={styles.danger} onClick={() => onConfirm(book)}>
              Remove
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
