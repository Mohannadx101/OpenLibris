# OpenLibris — Implementation Roadmap

Each phase ends with a working, runnable app and is reviewed before the next begins. Acceptance criteria are what we check off.

## Folder structure

Items marked _(planned)_ do not exist yet; everything else is in the repository today.

```
openlibris/
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ ROADMAP.md
│  └─ adr/                       # Architecture Decision Records
├─ resources/                    # app icons, build assets (empty until Phase 10)
├─ src/
│  ├─ shared/                    # imported by main, preload and renderer
│  │  ├─ ipc.ts                  # channel contract: zod schemas → request/response types
│  │  ├─ library.ts              # Book, ImportOutcome, PDF metadata schemas
│  │  ├─ api.ts                  # the window.api interface
│  │  ├─ types.ts                # Locator, AnnotationRange, AppInfo, …
│  │  └─ result.ts               # Result<T>, AppFailure
│  ├─ main/
│  │  ├─ index.ts                # composition root + app lifecycle
│  │  ├─ window.ts               # BrowserWindow, CSP installation, navigation guards
│  │  ├─ security.ts             # CSP builder, app-URL guard (pure)
│  │  ├─ protocol.ts             # book:// handler (Electron)
│  │  ├─ libraryUrl.ts           # book:// URL → file path, with traversal protection (pure)
│  │  ├─ rangeRequest.ts         # HTTP Range parsing, MIME types (pure)
│  │  ├─ paths.ts                # data folder layout
│  │  ├─ db/
│  │  │  ├─ connection.ts        # better-sqlite3 setup and pragmas
│  │  │  ├─ migrate.ts           # migration runner
│  │  │  └─ migrations/          # 001_init.sql, 002_book_enrichment.sql
│  │  ├─ dialogs.ts              # native file picker
│  │  ├─ repositories/           # settings, books; readingState, … (planned)
│  │  ├─ services/
│  │  │  ├─ library/             # libraryService (import, remove), fileUtils (hash, format sniffing)
│  │  │  └─ metadata/            # epubMetadata (title, author, cover from the zip)
│  │  └─ ipc/
│  │     ├─ dispatch.ts          # validate → handle → Result (pure)
│  │     ├─ register.ts          # binds channels to ipcMain, checks sender
│  │     ├─ handlers.ts          # combines every domain's handlers (compiler-checked complete)
│     ├─ appHandlers.ts       # app:*
│     └─ libraryHandlers.ts   # library:*
│  ├─ preload/index.ts           # contextBridge → window.api
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx
│        ├─ app/App.tsx          # hash router
│        ├─ lib/                 # api.ts (typed window.api), pdfInfo.ts (PDF.js title/author/cover), pdfText.ts
│        ├─ features/
│        │  └─ library/          # LibraryPage, store, shelf.ts (search/sort), components/
│        │     (reader/, annotations/, tts/, settings/ are planned)
│        └─ styles/              # tokens.css, global.css
├─ tests/
│  ├─ unit/                      # Vitest
│  └─ e2e/                       # Playwright (planned, Phase 10)
├─ electron.vite.config.ts
├─ vitest.config.mts
├─ electron-builder.yml          # (planned, Phase 10)
├─ tsconfig.{json,base,node,web}.json
└─ package.json
```

## Dependencies

**Runtime**

| Package                                           | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `electron`                                        | Desktop shell                                      |
| `react`, `react-dom`                              | UI                                                 |
| `react-router-dom`                                | Library ↔ Reader navigation                        |
| `zustand`                                         | Renderer state                                     |
| `better-sqlite3`                                  | SQLite (native module, main process)               |
| `zod`                                             | IPC payload validation                             |
| `epubjs`                                          | EPUB rendering                                     |
| `pdfjs-dist` _(installed, Phase 1)_               | PDF rendering, text layer, metadata                |
| `jszip`, `fast-xml-parser` _(installed, Phase 1)_ | Read EPUB metadata/cover in main without rendering |

**Development**

| Package                                         | Purpose                                                |
| ----------------------------------------------- | ------------------------------------------------------ |
| `electron-vite`, `vite`, `@vitejs/plugin-react` | Build/dev server for main, preload, renderer           |
| `typescript` (strict)                           | Types                                                  |
| `electron-builder`                              | Packaging (added in Phase 10)                          |
| `vitest`                                        | Unit tests (repositories run against in-memory SQLite) |
| `@playwright/test`                              | End-to-end tests of the packaged app (Phase 10)        |
| `eslint`, `typescript-eslint`, `prettier`       | Linting/formatting                                     |

Versions were set to the latest stable releases when the project was scaffolded (Electron 45, React 19, Vite 8, Vitest 5, better-sqlite3 13, zod 4). Two deliberate exceptions:

- **TypeScript is held at 6.0.x**, not 7.x, because `typescript-eslint` does not yet support TypeScript 7. Revisit when it does.
- **`@types/node` follows Electron's bundled Node (24.x)**, not the Node used for development.

Deliberately **not** included: an ORM, a UI component library, Redux, any cloud/sync SDK.

---

## Phase 0 — Foundation ✅ done

Scaffold with electron-vite (React + TS), strict tsconfig, ESLint/Prettier, security-hardened window, typed IPC skeleton with a `ping` round trip, SQLite connection + migration runner + `001_init.sql`, `book://` protocol stub, Vitest set up.
**Done when:** `npm run dev` opens a window; DB file is created in userData with the schema; a test verifies migrations; `npm run build` succeeds.
**Result:** all four met, plus the `book://` handler is fully implemented (not just stubbed) including Range support, because PDF.js depends on it. See `ARCHITECTURE.md` §13 for what was verified and how.

## Phase 1 — Library import & bookshelf ✅ done

Import via file dialog and drag-and-drop; SHA-256 dedupe; copy into library folder; EPUB metadata + cover (main); PDF metadata + first-page cover thumbnail; bookshelf grid with cover/title/author; sort (recent, title, author) and search; remove book (with confirmation, deletes files + rows).
**Done when:** importing 20 mixed books works, duplicates are rejected with a message, missing covers fall back to a generated placeholder, and the shelf persists across restarts.
**Result:** all met and verified against real generated EPUB and PDF fixtures (a batch of 6 files covering every outcome, rather than 20 books; the pipeline treats each file independently, so size of batch does not change behaviour). PDF metadata and covers are extracted by PDF.js in the renderer (ADR 0006), which required a small database migration. See `ARCHITECTURE.md` §14 for the design, the known limitations and exactly what was and was not verified.

## Phase 2 — EPUB reader + position restore ✅ done

ReaderAdapter interface; EpubAdapter (paginated); Reader screen with toolbar, TOC, next/prev, keyboard navigation; debounced position save + flush-on-close; reopen at exact CFI.
**Done when:** closing the app mid-chapter (including force-quit after a page turn) and reopening returns to the same page.
**Result:** met and verified in the running app: after `kill -9` the reader reopens on exactly the same page, and a page turn made a few milliseconds before closing the window is still saved. Also verified: keyboard and button navigation, the contents drawer (including a book whose contents live in a sub-folder), a book's own styles and images, scripts inside a book not running, staying on the same text when the window is resized, and clear messages for a missing book file. Getting the restore exact turned up a subtle EPUB.js layout issue that later phases must respect, recorded in ADR 0007. See `ARCHITECTURE.md` §15 for the design, limitations and exactly what was and was not verified.

## Phase 3 — PDF reader + position restore

PdfAdapter: continuous scroll, lazy page rendering, text layer, zoom, TOC from outline; locator = page + offset.
**Done when:** a 500-page PDF opens quickly, scrolls smoothly, and restores position across restarts and zoom changes.

## Phase 4 — Progress tracking

EPUB location index generated once and cached; progress bar in reader; progress indicator and "continue reading" on the shelf; last-opened sorting.
**Done when:** shelf shows accurate % for every book after reading.

## Phase 5 — Reading comfort

Appearance settings: font family, size, line height, margins, themes (light / sepia / dark), stored in settings.
**Done when:** changing font size keeps the reader at the same position.

## Phase 6 — Bookmarks

Add/remove bookmark at current location, bookmarks panel, jump to bookmark.

## Phase 7 — Highlights & notes

Selection → highlight with colour; add/edit note; annotations panel with jump-to; EPUB first, then PDF.
**Done when:** highlights redraw correctly after reopening and after font/zoom changes.

## Phase 8 — Text-to-speech

Spike: confirm voice availability and quality on Windows and macOS (Linux is out of scope for now). If the built-in voices are not natural enough, evaluate an offline neural engine (e.g. Piper) behind the same `TtsEngine` interface. Then TtsEngine + WebSpeechEngine; sentence segmentation; play/pause/resume/stop; speed and voice selection (persisted); active-sentence highlight; auto page turn; start from current position.
**Done when:** narration reads a full chapter across page turns, highlight tracks each sentence, and pause/resume continues from the same sentence.

## Phase 9 — Bedtime mode

Bedtime theme (warm, dim, larger text), PDF canvas filter, sleep timer (stops narration, saves position), optional automatic schedule.

## Phase 10 — Hardening & packaging

Rolling DB backups, export annotations (Markdown/JSON), library integrity check (missing files), error reporting UI, E2E tests for core flows, installers via electron-builder.

---

## Documentation practice

- `docs/adr/NNNN-title.md` for every significant decision (first ADRs: copy-into-library, Locator design, sentence-based TTS, no ORM).
- Each phase updates `ARCHITECTURE.md` if the design changes and adds a short entry to `CHANGELOG.md`.
- `README.md` covers setup, scripts and where user data lives.
