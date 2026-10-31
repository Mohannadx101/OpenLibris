# 0004 — Plain SQL with `better-sqlite3`, numbered migrations, no ORM

Status: accepted

## Context

The schema is small and stable (books, reading state, bookmarks, highlights, settings). The database is single-user and local, and is only ever opened by the main process.

## Decision

- Use `better-sqlite3` directly, in the main process only.
- Access data through small repository classes over prepared statements, constructed with a database handle.
- Schema changes are numbered `.sql` files applied in order at startup, each in a transaction with its version bump (`PRAGMA user_version`). A database newer than the app is refused.
- WAL mode, `synchronous = NORMAL`, `foreign_keys = ON`.
- No ORM.

## Consequences

- Queries and schema are plain, inspectable SQL; nothing generated, nothing to learn beyond SQL.
- Tests run against an in-memory SQLite with the real migrations, so they exercise the real schema, constraints and cascades.
- Row-to-object mapping is written by hand in each repository. Acceptable at this size; if queries grow complex, Kysely (a typed query builder) can be introduced without changing the schema or the migrations.
- Never edit an applied migration; add a new one.
