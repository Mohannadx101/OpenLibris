import { useEffect, useState } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import type { AppInfo } from '@shared/types'
import styles from './LibraryPage.module.css'

type Status =
  { state: 'loading' } | { state: 'ready'; info: AppInfo } | { state: 'error'; message: string }

/**
 * Phase 0 placeholder. The status line proves the whole chain works end to end:
 * React -> preload bridge -> validated IPC -> main process -> SQLite.
 * Phase 1 replaces the empty state with the bookshelf.
 */
export function LibraryPage() {
  const [status, setStatus] = useState<Status>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const pong = unwrap(await api.app.ping({ message: 'hello' }))
        const info = unwrap(await api.app.getInfo())
        if (!cancelled && pong.reply === 'pong: hello') setStatus({ state: 'ready', info })
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Library</h1>
      </header>

      <section className={styles.empty}>
        <h2>Your bookshelf is empty</h2>
        <p>Importing EPUB and PDF books arrives in the next phase.</p>
      </section>

      <p className={styles.status} role="status">
        {status.state === 'loading' && 'Connecting to the app core…'}
        {status.state === 'ready' &&
          `${status.info.name} ${status.info.version} · database schema v${status.info.schemaVersion} · ${status.info.dataDir}`}
        {status.state === 'error' && (
          <span className={styles.error}>Could not reach the app core: {status.message}</span>
        )}
      </p>
    </main>
  )
}
