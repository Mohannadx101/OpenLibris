import { hueForTitle } from '../shelf'
import styles from './CoverPlaceholder.module.css'

/** A generated cover for books that have none: a colour per title, with the title on it. */
export function CoverPlaceholder({ title, author }: { title: string; author: string | null }) {
  const hue = hueForTitle(title)
  return (
    <div
      className={styles.cover}
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 38% 38%), hsl(${(hue + 24) % 360} 42% 24%))`,
      }}
      aria-hidden="true"
    >
      <span className={styles.title}>{title}</span>
      {author && <span className={styles.author}>{author}</span>}
    </div>
  )
}
