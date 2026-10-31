import Database from 'better-sqlite3'

export type Db = Database.Database

/**
 * Opens (creating if needed) a SQLite database with the pragmas this app relies on.
 * Pass ':memory:' for tests.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file)

  // WAL + synchronous=NORMAL: a committed write survives an app crash, and reads never
  // block the single writer. (A power loss may lose the last transaction, not corrupt data.)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  // Foreign keys are off by default in SQLite; ON DELETE CASCADE depends on this.
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  return db
}
