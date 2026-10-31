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
│  │  │  └─ migrations/001_init.sql
│  │  ├─ repositories/           # settingsRepository now; books, readingState, … (planned)
│  │  ├─ services/               # library import, metadata, covers (planned, Phase 1)
│  │  └─ ipc/
│  │     ├─ dispatch.ts          # validate → handle → Result (pure)
│  │     ├─ register.ts          # binds channels to ipcMain, checks sender
│  │     └─ appHandlers.ts       # app:ping, app:getInfo
│  ├─ preload/index.ts           # contextBridge → window.api
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx
│        ├─ app/App.tsx          # hash router
│        ├─ lib/api.ts           # typed window.api + unwrap()
│        ├─ features/
│        │  └─ library/          # placeholder page now; bookshelf in Phase 1
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

| Package                    | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `electron`                 | Desktop shell                                      |
| `react`, `react-dom`       | UI                                                 |
| `react-router-dom`         | Library ↔ Reader navigation                        |
| `zustand`                  | Renderer state                                     |
| `better-sqlite3`           | SQLite (native module, main process)               |
| `zod`                      | IPC payload validation                             |
| `epubjs`                   | EPUB rendering                                     |
| `pdfjs-dist`               | PDF rendering, text layer, metadata                |
| `jszip`, `fast-xml-parser` | Read EPUB metadata/cover in main without rendering |

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

## Phase 1 — Library import & bookshelf

Import via file dialog and drag-and-drop; SHA-256 dedupe; copy into library folder; EPUB metadata + cover (main); PDF metadata + first-page cover thumbnail; bookshelf grid with cover/title/author; sort (recent, title, author) and search; remove book (with confirmation, deletes files + rows).
**Done when:** importing 20 mixed books works, duplicates are rejected with a message, missing covers fall back to a generated placeholder, and the shelf persists across restarts.

## Phase 2 — EPUB reader + position restore

ReaderAdapter interface; EpubAdapter (paginated); Reader screen with toolbar, TOC, next/prev, keyboard navigation; debounced position save + flush-on-close; reopen at exact CFI.
**Done when:** closing the app mid-chapter (including force-quit after a page turn) and reopening returns to the same page.

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
