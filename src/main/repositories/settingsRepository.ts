import type { Db } from '../db/connection'

/**
 * Key/value store for app preferences. Values are stored as JSON so they can be any
 * serialisable shape. This is the first repository and sets the pattern for the rest:
 * a small class over prepared statements, constructed with a Db, no hidden global state.
 */
export class SettingsRepository {
  private readonly selectOne
  private readonly selectAll
  private readonly upsert
  private readonly remove

  constructor(db: Db) {
    this.selectOne = db.prepare('SELECT value FROM settings WHERE key = ?')
    this.selectAll = db.prepare('SELECT key, value FROM settings')
    this.upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    this.remove = db.prepare('DELETE FROM settings WHERE key = ?')
  }

  get<T>(key: string): T | undefined {
    const row = this.selectOne.get(key) as { value: string } | undefined
    return row === undefined ? undefined : (JSON.parse(row.value) as T)
  }

  set(key: string, value: unknown): void {
    const json = JSON.stringify(value)
    if (json === undefined) throw new TypeError(`Setting "${key}" is not JSON-serialisable`)
    this.upsert.run(key, json)
  }

  delete(key: string): void {
    this.remove.run(key)
  }

  getAll(): Record<string, unknown> {
    const rows = this.selectAll.all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]))
  }
}
