import { useEffect, useRef } from 'react'
import type { TocItem } from '../adapters/ReaderAdapter'
import styles from './TocPanel.module.css'

interface TocPanelProps {
  items: TocItem[]
  currentId: string | null
  onSelect: (item: TocItem) => void
  onClose: () => void
}

/** The table of contents, as a drawer over the page so opening it never reflows the text. */
export function TocPanel({ items, currentId, onSelect, onClose }: TocPanelProps) {
  const currentRef = useRef<HTMLButtonElement>(null)

  // Bring the current chapter into view when the drawer opens.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <nav className={styles.panel} aria-label="Table of contents">
        <div className={styles.header}>
          <h2>Contents</h2>
          <button type="button" onClick={onClose} aria-label="Close contents">
            ×
          </button>
        </div>
        {items.length === 0 ? (
          <p className={styles.empty}>This book has no table of contents.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={`${item.id}-${item.href}`}>
                <button
                  type="button"
                  ref={item.id === currentId ? currentRef : undefined}
                  className={item.id === currentId ? styles.current : undefined}
                  style={{ paddingLeft: `${16 + item.depth * 16}px` }}
                  aria-current={item.id === currentId ? 'location' : undefined}
                  onClick={() => onSelect(item)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </>
  )
}
