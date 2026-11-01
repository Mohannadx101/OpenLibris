import { useEffect } from 'react'
import type { ImportOutcome } from '@shared/library'
import { summarize } from '../importSummary'
import styles from './ImportReport.module.css'

/** Tells the user what an import did, and why any file was skipped. */
export function ImportReport({
  outcomes,
  onDismiss,
}: {
  outcomes: ImportOutcome[]
  onDismiss: () => void
}) {
  const problems = outcomes.filter((o) => o.status !== 'imported')
  const allImported = problems.length === 0

  // A fully successful import needs no attention for long; problems stay until dismissed.
  useEffect(() => {
    if (!allImported) return
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [allImported, onDismiss])

  return (
    <div
      className={`${styles.report} ${allImported ? styles.success : styles.attention}`}
      role="status"
    >
      <div className={styles.body}>
        <p className={styles.summary}>{summarize(outcomes)}</p>
        {problems.length > 0 && (
          <ul className={styles.problems}>
            {problems.map((outcome, index) => (
              <li key={`${outcome.fileName}-${index}`}>
                <strong>{outcome.fileName}</strong>{' '}
                {outcome.status === 'duplicate'
                  ? `is already in your library as “${outcome.existingTitle}”.`
                  : outcome.status === 'failed'
                    ? outcome.reason
                    : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
