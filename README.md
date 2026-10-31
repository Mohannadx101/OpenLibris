# OpenLibris

A local-first desktop book reader for EPUB and PDF. Your books, reading positions, bookmarks, highlights and notes stay on your computer.

> **Status:** early development. Phase 0 (foundation) is complete: the app opens, the database and IPC layer work, and security boundaries are in place. There is no importing or reading yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Planned features

- Import and manage EPUB and PDF books, shown on a bookshelf with covers, titles and authors
- A clean, comfortable reading interface with exact position restore and per-book progress
- Bookmarks, highlights and personal notes
- Text-to-speech with adjustable speed and voice, a highlighted current sentence, and pause/resume
- A bedtime reading mode

## Tech stack

Electron · React · TypeScript · SQLite (`better-sqlite3`) · EPUB.js · PDF.js · Vitest

Target platforms: Windows and macOS. Linux is not supported yet.

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # start the app with hot reload
```

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Run the app in development                     |
| `npm run build`     | Production build into `out/`                   |
| `npm run preview`   | Run the production build                       |
| `npm test`          | Unit tests (Vitest)                            |
| `npm run typecheck` | TypeScript check for main/preload and renderer |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Prettier                                       |

## Where your data lives

Everything is stored in the app's data folder (Electron's `userData`):

```
library.db          the SQLite database
library/<bookId>/   your imported book files and covers
backups/            database backups (later phase)
```

On a default install this is `%APPDATA%\OpenLibris` on Windows and `~/Library/Application Support/OpenLibris` on macOS. Nothing is sent over the network.

Development builds use a separate folder (the same path with `-dev` appended) so experiments never touch your real library. Set `OPENLIBRIS_DATA_DIR` to use any folder you like, for example to start with an empty library.

## Project documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the app is structured and why
- [`docs/ROADMAP.md`](docs/ROADMAP.md): folder structure, dependencies and the phased plan
- [`docs/adr/`](docs/adr): one short record per significant decision
- [`CHANGELOG.md`](CHANGELOG.md)

## Contributing

Work proceeds in reviewed phases; see the roadmap.

## License

[MIT](LICENSE)
