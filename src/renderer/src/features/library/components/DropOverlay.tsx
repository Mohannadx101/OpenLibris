import styles from './DropOverlay.module.css'

export function DropOverlay() {
  return (
    <div className={styles.overlay} aria-hidden="true">
      <div className={styles.message}>
        <strong>Drop to add to your library</strong>
        <span>EPUB and PDF files</span>
      </div>
    </div>
  )
}
