import type { Book } from '@shared/library'
import { BookCard } from './BookCard'
import styles from './Bookshelf.module.css'

export function Bookshelf({ books, onRemove }: { books: Book[]; onRemove: (book: Book) => void }) {
  return (
    <ul className={styles.grid}>
      {books.map((book) => (
        <BookCard key={book.id} book={book} onRemove={onRemove} />
      ))}
    </ul>
  )
}
