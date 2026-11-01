import styles from './ErrorBanner.module.css'

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className={styles.banner} role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
