# Architecture — OpenLibris

Status: **Approved. Phase 0 (foundation) is implemented and verified**; see §13. The decisions in §11 are settled.

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

### Schema (initial)

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
  last_opened_at INTEGER
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

This isolates library quirks. If EPUB.js proves limiting (it has had slow maintenance), it can be replaced (e.g. by foliate-js) by writing one new adapter.

## 7. Position saving (reliability)

1. Adapter emits `relocated` → renderer debounces 750 ms → `api.reading.saveState`.
2. On window close / app quit, main sends `reader:flush` and waits (with a short timeout) for the final save before closing.
3. SQLite runs in WAL mode with `synchronous = NORMAL`; a write that returns is durable across an app crash.
4. On open, the stored locator is passed to `adapter.open()` so the first render is already at the right place (no jump).

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
- EPUB content renders in sandboxed iframes (EPUB.js default); scripts inside EPUBs are disabled.
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
