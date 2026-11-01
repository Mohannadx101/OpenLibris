# Architecture — OpenLibris

Status: **Approved. Phases 0 (foundation) and 1 (library import and bookshelf) are implemented and verified**; see §13 and §14. The decisions in §11 are settled.

## 1. Goals and constraints

| Requirement                                  | Architectural consequence                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-first, data stays on the machine       | No network services. Books, covers and the DB live under Electron's `userData` directory. No telemetry.                                       |
| EPUB + PDF                                   | One **Reader Adapter** interface with two implementations (EPUB.js, PDF.js). The rest of the app is format-agnostic.                          |
| Exact position restore                       | A format-specific **Locator** type (EPUB CFI / PDF page+offset), saved on every relocation (debounced) and flushed on close.                  |
| Bookmarks, highlights, notes                 | Annotations store Locators/ranges, never raw DOM or pixel positions.                                                                          |
| TTS with sentence highlighting, pause/resume | Speak **one sentence per utterance**. The app owns the sentence queue, so highlighting and pause/resume do not depend on flaky engine events. |
| Reliability over complexity                  | Plain SQL with a thin repository layer, no ORM. Minimal dependencies. Strict TypeScript.                                                      |

## 2. Process model

Electron has two kinds of process. We give each a clear job.

```
┌───────────────────────────── Main process (Node) ─────────────────────────────┐
│  App lifecycle · windows · menus                                              │
│  Database (better-sqlite3, WAL) + migrations                                  │
│  Repositories: books, readingState, annotations, settings                     │
│  Services: LibraryService (import, hashing, copy, metadata), CoverService     │
│  IPC handlers (validated input)                                               │
│  Custom protocol  book://  → serves book files & covers from the library dir  │
└──────────────────────────────▲────────────────────────────────────────────────┘
                               │ typed IPC (invoke/handle) via preload bridge
┌──────────────────────────────┴────────────────────────────────────────────────┐
│ Preload (contextBridge) — exposes `window.api`, nothing else                  │
└──────────────────────────────▲────────────────────────────────────────────────┘
┌──────────────────────────────┴───────────── Renderer (React, sandboxed) ──────┐
│  Library (bookshelf)   Reader (adapters: EPUB / PDF)   Annotations            │
│  TTS controller (Web Speech API)   Themes / Bedtime mode   Settings           │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Why the database lives in main:** only main has Node access, a single DB owner avoids locking issues, and the renderer stays sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). The renderer never touches the filesystem directly.

**Why a custom `book://` protocol instead of `file://`:** it keeps renderer file access scoped to the library folder, works with the sandbox, and supports HTTP range requests, which PDF.js uses to load large PDFs incrementally. Range handling is implemented in our own handler (`src/main/protocol.ts`, `rangeRequest.ts`) rather than delegated, and was verified in the running app (206 + `Content-Range`).

## 3. IPC contract

- All channels and their request/response types are defined once in `src/shared/ipc.ts`.
- Preload exposes a typed `window.api` object generated from that contract (e.g. `api.library.import(paths)`, `api.reading.saveState(bookId, locator)`).
- Main validates every incoming payload with **zod** before it reaches a service. The renderer is treated as untrusted input.
- Errors cross the boundary as a `Result<T>` shape (`{ ok: true, data } | { ok: false, error: { code, message } }`) so the UI can show useful messages instead of opaque exceptions.

## 4. Data storage

### Files on disk

```
<userData>/
  library.db            SQLite database (WAL mode)
  library/
    <bookId>/
      book.epub | book.pdf   copy of the imported file
      cover.jpg              extracted or rendered cover
  backups/              rolling DB backups (later phase)
```

**Decision: copy books into the library** rather than referencing their original path. The library then survives the user moving or deleting their Downloads folder, and backup is a single folder. Duplicates are detected by SHA-256 of the file. _(Settled — see §11.)_

### Schema

```sql
books (
  id TEXT PRIMARY KEY,           -- UUID
  content_hash TEXT UNIQUE NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('epub','pdf')),
  title TEXT NOT NULL,
  author TEXT,
  language TEXT,
  file_path TEXT NOT NULL,       -- relative to library dir
  cover_path TEXT,
  file_size INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  needs_enrichment INTEGER NOT NULL DEFAULT 0  -- added in migration 002, see §14
);

reading_state (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,         -- JSON Locator
  progress REAL NOT NULL DEFAULT 0,  -- 0..1
  updated_at INTEGER NOT NULL
);

bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);

highlights (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  range TEXT NOT NULL,           -- JSON AnnotationRange
  text TEXT NOT NULL,            -- selected text, for lists/search
  color TEXT NOT NULL,
  note TEXT,                     -- a note is a highlight with a comment
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

epub_locations_cache (          -- EPUB.js location index is slow to compute
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- JSON values
```

**Migrations:** numbered `.sql` files in `src/main/db/migrations/`, applied in a transaction at startup, tracked with `PRAGMA user_version`. Simple, inspectable, no ORM.

**Why no ORM:** the schema is small and stable. Typed repository functions over `better-sqlite3` are easier to read and debug. If queries grow, **Kysely** (a typed query builder) can be added without changing the schema.

## 5. Locators — the key abstraction

```ts
type Locator = { format: 'epub'; cfi: string } | { format: 'pdf'; page: number; offsetY: number } // offsetY: 0..1 within page

type AnnotationRange =
  | { format: 'epub'; cfiRange: string }
  | { format: 'pdf'; page: number; startOffset: number; endOffset: number } // char offsets in page text
```

- EPUB CFIs survive font-size and layout changes, which is why they are used for "exact position".
- PDF positions use page plus relative offset so they survive zoom changes. PDF highlights use character offsets in the page's text content, so they can be redrawn at any zoom.
- **Progress:** EPUB uses the cached EPUB.js location index (percentage); PDF uses `page / pageCount`.

## 6. Reader Adapter

Every format implements one interface; React components only talk to this.

```ts
interface ReaderAdapter {
  open(container: HTMLElement, source: string, initial?: Locator): Promise<void>
  destroy(): void
  goTo(target: Locator): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  currentLocator(): Locator
  onRelocated(cb: (loc: Locator, progress: number) => void): Unsubscribe
  onSelection(cb: (sel: { range: AnnotationRange; text: string }) => void): Unsubscribe
  getToc(): Promise<TocItem[]>
  applyAppearance(a: Appearance): void // font, size, spacing, theme
  renderHighlights(h: Highlight[]): void
  // TTS support
  getReadableText(from: Locator): AsyncIterable<TextChunk> // text + its range
  markActive(range: AnnotationRange | null): void // narration highlight
}
```

Phase 2 implements the subset the reader needs now: `open`, `next`, `prev`, `goTo(href)`, `toc`, `onPosition` (in place of `onRelocated`), `onKey`, `resize` and `destroy`. Selection, highlights, appearance and narration members arrive in the phases that need them. See §15 and ADR 0007.

This isolates library quirks. If EPUB.js proves limiting (it has had slow maintenance), it can be replaced (e.g. by foliate-js) by writing one new adapter.

## 7. Position saving (reliability)

1. The adapter emits a position (CFI + approximate progress) → the renderer's `PositionSaver` debounces 400 ms → `api.reading.save` (`reading:save`).
2. The pending position is also flushed when the reader screen is left and when the window is hidden. On window close, main sends `app:before-close`, the page flushes and replies `app:flush-done`, and the window closes (after at most 2 s, so a stuck page cannot keep it open).
3. SQLite runs in WAL mode with `synchronous = NORMAL`; a write that returns is durable across an app crash.
4. On open, `reading:open` returns the book and its stored locator, and the locator is passed to `adapter.open()` so the first render is already at the right place (no jump).

## 8. Text-to-speech

- **Engine:** Web Speech API (`speechSynthesis`) in the renderer. It uses the operating system's installed voices, so it is offline and local-first. Wrapped behind a `TtsEngine` interface so an offline neural engine (e.g. Piper) could be added later.
- **Sentence model:** text from `adapter.getReadableText()` is split with `Intl.Segmenter` (`granularity: 'sentence'`). Each sentence becomes one utterance with a known range.
- **Highlighting:** on each utterance's `start` event, call `adapter.markActive(range)`. We do not rely on `boundary` events, which are inconsistent across platforms.
- **Pause/resume:** Chromium's `speechSynthesis.pause()` is unreliable. Pause = cancel and remember the sentence index; resume = re-speak that sentence. Speed changes apply from the next sentence.
- **Page turning:** when the queue reaches the end of the visible text, the controller calls `adapter.next()` and continues.
- **Known risk:** voice quality varies by OS and by which voices the user has installed. A spike in Phase 8 checks Windows and macOS (Linux is out of scope for now) and decides whether the built-in voices are natural enough or an offline neural engine is worth adding.

## 9. Appearance and bedtime mode

- Themes are sets of CSS variables (`light`, `sepia`, `dark`, `bedtime`) applied to the app shell and injected into EPUB content via the adapter.
- **Bedtime mode:** warm, low-contrast palette with reduced blue light, dimmed brightness, larger default font, and a **sleep timer** that stops narration and saves position. PDF pages get a CSS filter on the canvas layer, since the page itself cannot be restyled.
- Optional: turn bedtime mode on automatically during a user-set time window.

## 10. Renderer structure and state

- **Feature folders** (library, reader, annotations, tts, settings), each owning its components, hooks and store.
- **Zustand** for state: small, explicit, no boilerplate. Data that lives in the DB is loaded through `window.api` and cached in feature stores.
- **Routing:** two screens (Library, Reader) with a hash router.
- **Styling:** CSS Modules + CSS variables. No component library; the UI is small and should feel calm and custom.

## 11. Decisions

| #   | Decision                                                                                                                                                         | Recorded in    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | **Books are copied into the app's library folder**, not referenced in place.                                                                                     | `adr/0001`     |
| 2   | **Target platforms: Windows and macOS.** Linux is out of scope for now; revisit after Phase 10. This removes the speech-dispatcher dependency from the TTS plan. | this document  |
| 3   | **PDFs use continuous vertical scrolling.**                                                                                                                      | Phase 3        |
| 4   | **EPUBs are paginated** (book-like). A scroll mode may be added later behind a setting; the adapter interface does not preclude it.                              | Phase 2        |
| 5   | **The project is named OpenLibris.**                                                                                                                             | `package.json` |

## 12. Security baseline

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict Content-Security-Policy (set by the main process on every response, with a looser variant only in development).
- Navigation away from the app is blocked, and `window.open` is denied; `https` links open in the system browser.
- IPC requests are rejected unless they originate from the app's own page.
- The `book://` handler serves only `<uuid>/book.(epub|pdf)` and `<uuid>/cover.(jpg|png|webp)` inside the library folder.
- EPUB content renders in sandboxed iframes (EPUB.js `srcdoc` frames, `allow-same-origin` only); scripts inside EPUBs are disabled. The page policy allows `blob:` styles and fonts and `base-uri 'self'` solely for EPUB.js (ADR 0007, tested).
- All IPC payloads validated with zod.

Everything above marked as enforced by the main process is covered by unit tests and was also checked against the running app (see §13).

## 13. Phase 0 implementation notes

What exists today, and the non-obvious choices behind it.

- **Single composition root.** `src/main/index.ts` is the only place that wires things together (paths → database → migrations → protocol → CSP → IPC → window). Everything else receives its dependencies as arguments, which is what makes the modules unit-testable without Electron.
- **Electron-free logic is kept in separate files** from Electron-touching code: `dispatch.ts` vs `register.ts`, `libraryUrl.ts`/`rangeRequest.ts` vs `protocol.ts`, `security.ts` (pure) vs `window.ts`. Unit tests only import the pure side.
- **The IPC contract is checked by the compiler.** `Handlers` is a mapped type over every channel in `src/shared/ipc.ts`, so adding a channel without implementing it fails to compile. Requests are validated at runtime; unexpected errors are logged in main and surface to the renderer as a generic `INTERNAL` error.
- **Migrations are bundled into the app** (`import.meta.glob(..., { query: '?raw' })`), so the packaged app never looks for `.sql` files on disk. Each migration runs in a transaction with its version bump; a database newer than the app is refused rather than modified.
- **`better-sqlite3` v13 ships N-API prebuilt binaries**, so the same binary runs under Node (Vitest) and Electron. No `electron-rebuild` step, and no switching binaries between running tests and running the app.
- **Development uses a separate data folder** (`<userData>-dev`), so a bug while developing cannot damage the real library. `OPENLIBRIS_DATA_DIR` overrides the location (used for testing and for starting with an empty library).
- **A second app instance is refused** (`requestSingleInstanceLock`), because two processes writing one database is a reliability risk.
- **Startup failures are loud.** A failed migration or unreadable database shows an error dialog and exits, rather than opening a blank window.
- **Verification performed:** typecheck, lint, 58 unit tests, production build, and a headless run of the built app that checked rendering, IPC round trips, renderer isolation (`require`/`process` undefined), CSP enforcement (eval, inline scripts and network requests blocked), `book://` (200, 206, suffix range, 416, 404, traversal refused), navigation blocking, and that the database is created with the schema. `npm run dev` was verified the same way.

## 14. Phase 1 implementation notes

**Import pipeline** (`src/main/services/library/libraryService.ts`). For each file, one at a time:

1. Validate: absolute path, regular file, not empty, `.epub` or `.pdf`, and the first bytes really are a PDF header or a zip. The extension alone is never trusted.
2. Hash (SHA-256, streamed). If the hash is already in the library the file is reported as a duplicate, naming the existing book.
3. Create `library/<uuid>/`, copy the file in, and check the copy's size.
4. EPUB: read title, author, language and cover (below). PDF: see "PDF metadata" below.
5. Insert the row.

Any failure after step 3 deletes the new folder, so a failed import leaves nothing behind. Files are processed sequentially, so two identical files in one batch resolve to one book and one duplicate, and one bad file never affects the others. Outcomes are returned per file as `imported`, `duplicate` or `failed` with a plain-language reason; internal error details stay in the main-process log.

**EPUB metadata** (`services/metadata/epubMetadata.ts`) is read in the main process from the zip alone, with no rendering: `container.xml` → package document → `dc:title`, `dc:creator` (authors only, skipping illustrators and translators), `dc:language`. The cover is found by the EPUB 3 `cover-image` property, then the EPUB 2 `<meta name="cover">` convention, then a manifest image whose id looks like a cover. Cover bytes are identified by content, not by the manifest's declared media type, because declared types are sometimes wrong. Entry paths that escape the archive are refused, and oversized XML or image entries are skipped.

**PDF metadata** needs PDF.js, which runs in the renderer (see ADR 0006). A PDF is imported immediately with a title taken from its file name and `needs_enrichment = 1`. The renderer then opens it over `book://`, reads the Info/XMP title, author and language, renders page 1 to a JPEG, and sends the result to `library:completePdfMetadata`. Main only accepts this for a book still flagged, so a compromised renderer cannot later rewrite book details, and it checks that the "cover" really is a JPEG, PNG or WebP before storing it. If extraction fails, the flag is cleared and the book keeps its file-name title and a generated placeholder. Because the flag lives in the database, a PDF whose extraction was interrupted (app closed, crash) is finished automatically on the next start.

**Drag and drop.** The renderer never sees file paths. The preload script listens for `drop` events, ignores any that are not real user input (`isTrusted`), reads the paths with Electron's `webUtils.getPathForFile`, and hands the renderer only a list of paths to import. The paths still pass through the same validation as the file dialog.

**Renderer.** `features/library/` holds the page, a zustand store, and small components. Search, sorting and size formatting are pure functions in `shelf.ts` with unit tests. The store owns the PDF extraction queue and guarantees it runs one book at a time and never twice for the same book.

**Known limitations** (deliberate, to be revisited where noted):

- Covers in GIF or SVG (rare in EPUBs) are not served; those books get the generated placeholder. The library only serves JPEG, PNG and WebP.
- PDFs whose page 1 relies on JPEG 2000 or JBIG2 images may get a blank cover, because PDF.js's WebAssembly decoders are disabled (they need CSP and asset changes). Title and author are unaffected. Still off after Phase 3 (see §16).
- Import has no per-file progress: the shelf shows "Importing…" until the whole batch finishes. Fine for normal use; worth improving if bulk-importing hundreds of books is common.
- An EPUB is read fully into memory for parsing. Typical books are a few MB; a very large illustrated EPUB will use that much memory briefly.
- Orphan folders (for example after a crash between copying and inserting) are cleaned up by the rollback in normal failures, but there is no startup sweep. A deliberate choice: deleting "unknown" folders automatically would be dangerous if the database were ever replaced by an older copy. A library integrity check is planned for Phase 10.

**Verification performed:** typecheck (main, preload, renderer), lint, formatting, 165 unit tests, production build, and a headless run of the built app (36 checks) against real generated fixtures: EPUBs with and without covers, a duplicate, a real PDF with an Info dictionary, a fake PDF and a text file. It checked every import outcome and message, that PDF.js extracts title, author and cover under the production CSP with no console errors, that the PDF cover really contains the page's content (pixel check), search, sorting, confirmation before removal and file deletion, a real file drop (via the DevTools protocol), that a drop fabricated by page script is ignored, persistence across restarts, and recovery of a PDF left half-processed. **Not covered:** the native file-open dialog (headless runs cannot drive it; its handler is unit-tested with a stand-in) and Windows or macOS (the headless run was on Linux, though file-name handling is tested for Windows-style paths).

## 15. Phase 2 implementation notes

**Opening a book.** The shelf's covers are links to `#/read/<id>`. `ReaderPage` calls `reading:open`, which returns the book and its saved position (or null). `ReadingService.open` marks the book as opened, says plainly if the book or its file is gone, and ignores an unreadable stored position. The page then creates an `EpubAdapter`, which fetches the file over `book://`, hands the bytes to EPUB.js (so EPUB.js makes no requests of its own), builds the contents, and shows the saved position or the start. PDFs show a "coming in the next phase" notice for now.

**Saving.** See §7 and ADR 0007. `ReadingStateRepository` keeps one row per book and replaces it on each save. `ReadingService.save` refuses a position of the wrong format for the book. `flush.ts` is the main side of the close handshake; it takes its IPC bus as a parameter so the timeout, the sender check and listener clean-up are unit-tested without Electron.

**Reader screen.** `features/reader/`: `ReaderPage` (toolbar, reading column of about 780 px for a comfortable line length, progress footer, page-turn edges, loading/error/PDF notices), `TocPanel` (a drawer over the page, so opening it never re-flows the text), `keys.ts` (arrows, Page Up/Down, Space and Shift+Space turn pages; T toggles contents; Escape closes it), `chapters.ts` (progress estimate, contents-link resolution, current-chapter lookup) and `positionSaver.ts`. Keys pressed inside the book never reach the page, so the adapter forwards them.

**Layout must stay still.** The reading area's size must not change after the first page is shown, or the position drifts (ADR 0007). The progress line reserves its height from the start. Resizing is handled in `EpubAdapter` by re-anchoring to the remembered place once resizing pauses.

**Known limitations** (deliberate, to be revisited where noted):

- Progress is an estimate (every file in the book counts the same) until the location index is ready; from Phase 4 it is exact (see §17).
- A hard kill can lose the last ~0.4 s of page turns (the debounce). Closing normally loses nothing.
- Links inside a book to a website open in the system browser; other link types (for example `mailto:`) do nothing. Links between chapters are handled by EPUB.js and were not covered by the end-to-end test.
- Reading text uses one fixed light style. Fonts, sizes and themes arrive in Phase 5; bedtime mode in Phase 9.
- While the window is being dragged to a new size the text can briefly show a provisional place before settling on the right one.
- The whole reader code (including EPUB.js) is in the main bundle, which makes the first load heavier than needed. It can be split off later if start-up time matters.
- Fixed-layout EPUBs (comics, some textbooks) are shown with the same paginated flow and were not tested.

**Verification performed:** typecheck (main, preload, renderer), lint, formatting, 206 unit tests, production build, and a headless run of the built app (46 checks, plus the Phase 1 run as a regression check) against generated multi-chapter EPUBs, one with its contents in a sub-folder. It covered: opening from the shelf, every navigation key and button, the contents drawer, a book's own stylesheet and image, a script inside a book being refused, progress and the saved position in the database, **`kill -9` followed by reopening on exactly the same page**, closing the window within milliseconds of a page turn and reopening on that page, staying on the same text after making the window narrower and wider, leaving to the shelf and coming back, a PDF notice, a missing book file, an unknown book address, database integrity, and no console or policy errors. The window was closed with the DevTools `Browser.close` command, which goes through the same `close` path as the window's close button. **Not covered:** Windows and macOS (everything ran on Linux), clicking the real close button or using Cmd+Q, EPUBs from real publishers (only generated fixtures, so unusual markup, DRM-free but heavily styled books and very large books are untested), and links between chapters.

## 16. Phase 3 implementation notes

**Design.** `PdfAdapter` implements `ReaderAdapter` (the reader screen only gained a branch choosing the adapter and a zoom control). All geometry lives in `pdfLayout.ts` as pure functions, unit-tested.

- **Layout.** Every page's size at scale 1 is measured up front (in batches), so the scroll bar and positions are exact from the start. Every page has a sized placeholder `div`; zoom 1 means "page 1 fits the width", and every page is scaled by the same factor.
- **Lazy rendering.** Pages within one screen-height of the view are drawn (canvas, at device pixel ratio, capped at 16 M pixels, plus a PDF.js text layer); pages more than three screen-heights away are freed. At most two renders run at once, nearest page first. Render work for a page that was freed or re-laid out is cancelled.
- **Locator.** `{ page, offsetY }`: the page at the top of the view and the fraction down it (0..1). Independent of zoom and width, so it is the anchor used for zoom, window resizing and restore. A scroll landing within a pixel of a page's top counts as that page's start (browsers round scroll positions).
- **Zoom.** Preset steps 50%–400% (toolbar and Ctrl+wheel). On zoom the old pictures stay (stretched) until the new ones are drawn, so pages never flash blank.
- **Progress.** Exact: `(page − 1 + offsetY) / pageCount`, 100% at the bottom of the last page.
- **Contents.** From the PDF outline; entries whose destination cannot be resolved are dropped. The current chapter is the last entry starting on or before the current page.
- **Position saving** is unchanged from Phase 2 (`PositionSaver`, close handshake).

**Known limitations.**

- No annotation layer, so links inside a PDF (including contents pages) do nothing; the outline drawer works.
- PDF.js's WebAssembly decoders (JPEG 2000, JBIG2) remain off. That needs `'wasm-unsafe-eval'` plus serving PDF.js's `wasm/` files; deferred until a real book needs it. Standard-font and CMap data files are not bundled either, so non-embedded CJK fonts fall back to system fonts.
- Horizontal scroll position is reset to centred on zoom or resize.
- Scroll smoothness was checked on generated text PDFs only, not on a large scanned or image-heavy book.
- No in-document search (not planned for this phase).

**Verification performed:** typecheck, lint, 223 unit tests (17 new; 222 pass, and one older `security.test.ts` case fails on Windows because it builds a POSIX `file:///` path, which fails identically without this phase's changes), production build, and a headless run of the built app on Windows against generated 60- and 500-page PDFs with an outline, driven over the DevTools protocol: first page and text layer shown, pages drawn lazily and bounded, outline jump, fractional scroll kept across two zoom steps and a window-width change, next-screen button, no console errors, and `kill -9` followed by reopening on the same page and offset with the page's pixels and text present. **Not covered:** macOS, real-world PDFs (scanned, encrypted, very large), touch and trackpad pinch.

## 17. Phase 4 implementation notes

**Exact EPUB progress.** EPUB.js can divide a book into evenly sized "locations" (this app uses 1024 characters each, about a page) and turn any position into a fraction of the whole text. Building that index loads every chapter, so it runs once, in the background, after the first page is shown:

1. `reading:open` returns the stored index (`locations`, a JSON array of CFIs) or null.
2. `EpubAdapter` loads it; if there is none, or it cannot be read, it builds one, then hands it to the screen, which stores it with `reading:saveLocations`. Main checks that it is a non-empty JSON array of strings, that the book is an EPUB, and caps its size at 8 MB.
3. Until the index is ready, progress is the Phase 2 estimate. When it becomes ready the current position is reported again with the exact fraction, which also updates the saved progress. The last page of the book is always 100%.

The index is tied to the book id; a library copy of a book never changes, so there is no invalidation. If the index cannot be built, progress simply stays an estimate and reading is unaffected. PDF progress was already exact (§16).

**Shelf.** `BooksRepository` joins `reading_state`, so `Book.progress` is null until the book has been read. `shelf.ts` holds the pure logic (`continueReading`, `progressLabel`, the "Recently opened" order), covered by unit tests. A book in "Continue reading" also appears in the full list below; the percentage is floored and never shows 100% before "Finished".

**Known limitations.** Index build time on a very large EPUB is unmeasured (it does not block reading). Progress shown on the shelf is as of the last save, so a book still open in the reader shows its latest saved value when the shelf loads. Finished books are not separated from the rest.

**Verification performed:** typecheck, lint, formatting, 242 unit tests (19 new; the one `security.test.ts` failure on Windows predates Phase 3 and is unrelated), production build, and a headless run of the built app on Windows (20 checks) with an EPUB whose chapters differ greatly in length: no index before the first read, index built and stored after it, 2% at the start of the long chapter (estimate would say 25%), 97% at chapter three, 100% on the last page, shelf bar, percentage and Continue-reading row, the new sort option, search hiding the row, and the index and percentage surviving a force-kill and restart, with no console errors. **Not covered:** macOS, real-world EPUBs (large, image-heavy, fixed-layout), and the PDF path of the shelf bar beyond a book with no progress.
