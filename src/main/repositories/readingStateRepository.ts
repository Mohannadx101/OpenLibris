import type { Db } from '../db/connection'
import { locatorSchema } from '@shared/reading'
import type { Locator, ReadingState } from '@shared/reading'

interface ReadingStateRow {
  locator: string
  progress: number
  updated_at: number
}

/** The saved position of each book. One row per book; saving replaces it. */
export class ReadingStateRepository {
  private readonly selectOne
  private readonly upsert

  constructor(db: Db) {
    this.selectOne = db.prepare(
      'SELECT locator, progress, updated_at FROM reading_state WHERE book_id = ?',
    )
    this.upsert = db.prepare(
      `INSERT INTO reading_state (book_id, locator, progress, updated_at)
       VALUES (@bookId, @locator, @progress, @updatedAt)
       ON CONFLICT (book_id) DO UPDATE SET
         locator = excluded.locator,
         progress = excluded.progress,
         updated_at = excluded.updated_at`,
    )
  }

  /**
   * Returns the saved state, or undefined if none exists or the stored locator is unreadable.
   * A damaged row is treated as "no saved position" so one bad value can never stop a book
   * from opening.
   */
  get(bookId: string): ReadingState | undefined {
    const row = this.selectOne.get(bookId) as ReadingStateRow | undefined
    if (!row) return undefined

    let parsed: unknown
    try {
      parsed = JSON.parse(row.locator)
    } catch {
      console.warn(`[reading] ignoring unreadable saved position for ${bookId}`)
      return undefined
    }
    const locator = locatorSchema.safeParse(parsed)
    if (!locator.success) {
      console.warn(`[reading] ignoring invalid saved position for ${bookId}`)
      return undefined
    }
    return { locator: locator.data, progress: row.progress, updatedAt: row.updated_at }
  }

  save(bookId: string, locator: Locator, progress: number, updatedAt: number): void {
    this.upsert.run({ bookId, locator: JSON.stringify(locator), progress, updatedAt })
  }
}
