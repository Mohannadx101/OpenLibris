import type { Db } from './connection'

export interface Migration {
  /** Sequential, starting at 1. Stored in PRAGMA user_version once applied. */
  version: number
  name: string
  sql: string
}

const FILE_PATTERN = /(\d+)_([^/\\]+)\.sql$/

/**
 * Turns `{ './migrations/001_init.sql': '<sql>' }` into ordered Migration objects.
 * Kept separate from the `import.meta.glob` call so it can be unit tested.
 */
export function parseMigrations(files: Record<string, string>): Migration[] {
  return Object.entries(files)
    .map(([path, sql]) => {
      const match = FILE_PATTERN.exec(path)
      if (!match) throw new Error(`Migration file name must look like 001_name.sql: ${path}`)
      return { version: Number(match[1]), name: match[2] as string, sql }
    })
    .sort((a, b) => a.version - b.version)
}

/** All migrations shipped with the app, embedded at build time. */
export function loadBundledMigrations(): Migration[] {
  const files = import.meta.glob('./migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  return parseMigrations(files)
}

export function getSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * Applies every migration newer than the database's current version.
 *
 * Each migration runs in its own transaction together with the version bump, so a failure
 * leaves the database exactly at the previous version. Returns the resulting version.
 */
export function runMigrations(db: Db, migrations: Migration[]): number {
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered 1..N without gaps; found ${m.version} at position ${index + 1}`,
      )
    }
  })

  const current = getSchemaVersion(db)
  const latest = migrations.length

  if (current > latest) {
    throw new Error(
      `The database is at schema version ${current}, but this version of OpenLibris only knows ` +
        `up to ${latest}. It was probably created by a newer version of the app.`,
    )
  }

  for (const migration of migrations.slice(current)) {
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })
    try {
      apply()
    } catch (cause) {
      throw new Error(`Migration ${migration.version}_${migration.name} failed`, { cause })
    }
  }

  return getSchemaVersion(db)
}
