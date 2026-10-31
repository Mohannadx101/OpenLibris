import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/connection'
import type { Db } from '@main/db/connection'
import {
  getSchemaVersion,
  loadBundledMigrations,
  parseMigrations,
  runMigrations,
} from '@main/db/migrate'

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

afterEach(() => {
  db.close()
})

function tableNames(): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return rows.map((r) => r.name).sort()
}

describe('bundled migrations', () => {
  it('are discovered and numbered from 1', () => {
    const migrations = loadBundledMigrations()
    expect(migrations.length).toBeGreaterThan(0)
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1))
  })

  it('create the full schema on a fresh database', () => {
    const version = runMigrations(db, loadBundledMigrations())
    expect(version).toBe(loadBundledMigrations().length)
    expect(tableNames()).toEqual([
      'bookmarks',
      'books',
      'epub_locations_cache',
      'highlights',
      'reading_state',
      'settings',
    ])
  })

  it('are idempotent when run again', () => {
    const first = runMigrations(db, loadBundledMigrations())
    const second = runMigrations(db, loadBundledMigrations())
    expect(second).toBe(first)
  })
})

describe('schema behaviour', () => {
  beforeEach(() => {
    runMigrations(db, loadBundledMigrations())
    db.prepare(
      `INSERT INTO books (id, content_hash, format, title, file_path, file_size, added_at)
       VALUES ('b1', 'hash-1', 'epub', 'A Book', 'b1/book.epub', 100, 1)`,
    ).run()
  })

  it('deletes dependent rows when a book is deleted', () => {
    db.prepare(
      "INSERT INTO reading_state (book_id, locator, progress, updated_at) VALUES ('b1', '{}', 0.5, 1)",
    ).run()
    db.prepare(
      "INSERT INTO bookmarks (id, book_id, locator, created_at) VALUES ('m1', 'b1', '{}', 1)",
    ).run()
    db.prepare(
      `INSERT INTO highlights (id, book_id, range, text, color, created_at, updated_at)
       VALUES ('h1', 'b1', '{}', 'text', 'yellow', 1, 1)`,
    ).run()

    db.prepare("DELETE FROM books WHERE id = 'b1'").run()

    for (const table of ['reading_state', 'bookmarks', 'highlights']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n, table).toBe(0)
    }
  })

  it('rejects rows that point at a missing book', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO bookmarks (id, book_id, locator, created_at) VALUES ('m1', 'nope', '{}', 1)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/)
  })

  it('rejects duplicate content hashes and unknown formats', () => {
    const insert = (id: string, hash: string, format: string) =>
      db
        .prepare(
          `INSERT INTO books (id, content_hash, format, title, file_path, file_size, added_at)
           VALUES (?, ?, ?, 't', 'p', 1, 1)`,
        )
        .run(id, hash, format)

    expect(() => insert('b2', 'hash-1', 'epub')).toThrow(/UNIQUE/)
    expect(() => insert('b3', 'hash-3', 'mobi')).toThrow(/CHECK/)
  })

  it('keeps reading progress within 0..1', () => {
    const insert = (progress: number) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO reading_state (book_id, locator, progress, updated_at) VALUES ('b1', '{}', ?, 1)",
        )
        .run(progress)
    expect(() => insert(1.5)).toThrow(/CHECK/)
    expect(() => insert(-0.1)).toThrow(/CHECK/)
    expect(() => insert(1)).not.toThrow()
  })
})

describe('runMigrations', () => {
  const migrations = [
    { version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER);' },
    { version: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER);' },
  ]

  it('applies only the migrations newer than the current version', () => {
    runMigrations(db, migrations.slice(0, 1))
    expect(getSchemaVersion(db)).toBe(1)
    expect(runMigrations(db, migrations)).toBe(2)
    expect(tableNames()).toEqual(['one', 'two'])
  })

  it('rolls back a failing migration completely and reports which one failed', () => {
    const broken = [
      migrations[0]!,
      { version: 2, name: 'broken', sql: 'CREATE TABLE half (id INTEGER); NOT VALID SQL;' },
    ]
    expect(() => runMigrations(db, broken)).toThrow(/Migration 2_broken failed/)
    expect(getSchemaVersion(db)).toBe(1)
    expect(tableNames()).toEqual(['one'])
  })

  it('refuses a database created by a newer version of the app', () => {
    runMigrations(db, migrations)
    expect(() => runMigrations(db, migrations.slice(0, 1))).toThrow(/newer version/)
  })

  it('rejects gaps in numbering', () => {
    expect(() => runMigrations(db, [migrations[1]!])).toThrow(/without gaps/)
  })
})

describe('parseMigrations', () => {
  it('orders by version number, not by path string', () => {
    const parsed = parseMigrations({
      './migrations/010_later.sql': 'b',
      './migrations/002_second.sql': 'a',
    })
    expect(parsed.map((m) => [m.version, m.name])).toEqual([
      [2, 'second'],
      [10, 'later'],
    ])
  })

  it('rejects badly named files', () => {
    expect(() => parseMigrations({ './migrations/init.sql': '' })).toThrow(/001_name\.sql/)
  })
})
