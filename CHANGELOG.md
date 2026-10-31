# Changelog

All notable changes to OpenLibris are recorded here, newest first.

## [Unreleased]

### Phase 0 — Foundation

- Project scaffolded with electron-vite, React 19, strict TypeScript, ESLint and Prettier.
- Main process: single-instance lock, separate development data folder, loud startup failures.
- SQLite via `better-sqlite3` (WAL, foreign keys) with a transactional migration runner and the initial schema (`books`, `reading_state`, `bookmarks`, `highlights`, `epub_locations_cache`, `settings`).
- Typed, zod-validated IPC contract with `Result<T>` errors; sandboxed preload exposing only `window.api`.
- Security: Content-Security-Policy applied by the main process, navigation and window-open blocked, IPC sender check.
- `book://` protocol serving library files and covers with path-traversal protection and HTTP Range support.
- Placeholder library page that proves the React → IPC → SQLite chain.
- 58 unit tests (migrations, schema constraints, settings repository, URL safety, Range parsing, CSP, IPC dispatch).
- Architecture, roadmap and five decision records written.
