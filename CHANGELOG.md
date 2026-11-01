# Changelog

All notable changes to OpenLibris are recorded here, newest first.

## [Unreleased]

### Phase 4 — Progress tracking

- EPUB progress is now exact: a location index (about one page of text per location) is built in the background the first time a book is read, stored in `epub_locations_cache`, and reused ever after. Until it is ready the old per-file estimate is shown, then replaced.
- The shelf shows a progress bar on each cover and a percentage (or "Finished") on each card.
- A "Continue reading" row at the top of the shelf offers up to four started, unfinished books, most recently opened first. It is hidden while searching.
- New sort: Recently opened (books never opened go last).
- Books now carry `progress` (joined from `reading_state`); new IPC channel `reading:saveLocations`; `reading:open` also returns the stored index.
- 19 new unit tests; headless end-to-end run on an EPUB with uneven chapters (20 checks).
- Not yet: index build time on very large books is unmeasured; "Finished" is only shown once the very last page has been reached.

### Phase 3 — PDF reader and position restore

- PDFs now open from the shelf in a continuously scrolling reader: pages are drawn only when near the screen and freed when far away, so a 500-page book opens at once and uses bounded memory. Selectable text sits over each page.
- Zoom with the toolbar (− / % / +) or Ctrl+wheel; the percentage resets to fit-width. "Page X of N" and exact progress in the footer; contents drawer built from the PDF's outline.
- The position (page plus how far down it) is saved automatically and restored after a restart or force-quit, and is kept across zoom and window-width changes.
- Previous/next, Space and Page Up/Down scroll by about a screen; arrow keys up/down scroll natively.
- 17 new unit tests for the layout maths; headless end-to-end run on generated 60- and 500-page PDFs.
- Not yet: links inside a PDF, search inside a PDF, PDFs relying on JPEG 2000/JBIG2 images (PDF.js WebAssembly decoders stay off), non-embedded CJK fonts.

### Phase 2 — EPUB reader and position restore

- Open an EPUB from the shelf (click its cover) and read it as pages. Clean reading column, chapter-aware progress footer, "Contents" drawer, previous/next buttons.
- Keyboard: arrows, Page Up/Down, Space and Shift+Space to turn pages; T for contents; Escape to close it.
- The exact page is saved automatically (debounced, serialised, retried on failure) and restored when the book is opened again, including after a crash or force-quit. Closing the window waits (up to 2 s) for the last position to be saved.
- A book's own styles, images and fonts display; scripts inside books never run. The reader stays on the same text when the window is resized.
- Clear messages when a book's file is missing or the book is no longer in the library. PDFs show a notice until Phase 3.
- New IPC channels `reading:open`, `reading:save`; `app:before-close` / `app:flush-done` close handshake; `books.last_opened_at` is now recorded.
- Page policy widened narrowly for EPUB.js (`blob:` styles and fonts, `base-uri 'self'`), with a test.
- 206 unit tests and a 46-check headless end-to-end run (Phase 1's 36 checks still pass).
- ADR 0007, including a layout pitfall in EPUB.js that later phases must avoid.

### Phase 1 — Library import and bookshelf

- Import EPUB and PDF books from a file dialog or by dropping files on the window. Files are validated by content (not just extension), de-duplicated by SHA-256, and copied into the app's library folder. A failed import leaves nothing behind.
- Per-file import report: added, already in the library (naming the existing book), or not imported, with a plain-language reason.
- EPUB title, author, language and cover are read from the file in the main process (EPUB 3 and EPUB 2 cover conventions).
- PDF title, author and a page-1 cover are extracted by PDF.js in the renderer and saved back; interrupted extraction resumes on the next start (migration 002, `needs_enrichment`).
- Bookshelf grid with covers, titles and authors; generated placeholder covers; search by title or author; sort by recently added, title or author; remove with confirmation (deletes the library copy, never the original).
- New IPC channels `library:list`, `library:importFromDialog`, `library:importPaths`, `library:remove`, `library:completePdfMetadata`.
- Drag-and-drop paths are read in the preload from real user drops only; the renderer never sees file paths.
- 165 unit tests and a 36-check headless end-to-end run against real EPUB and PDF fixtures.
- ADR 0006; MIT license added.

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
