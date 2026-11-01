# 0006 — Extract PDF metadata and covers in the renderer, finish later via a flag

Status: accepted

## Context

Importing a book should show its real title, author and cover. For EPUB this needs only a zip and an XML parser, so the main process does it. For PDF, the title and author are easy to read, but a cover means rendering page 1, and the only renderer we are using is PDF.js. In the main process that needs a native canvas package, which is a heavy, platform-specific install (a particular nuisance on Windows) for a job done once per book.

## Decision

- Main imports a PDF immediately: validates, hashes, copies, and inserts a row with a title taken from the file name and `needs_enrichment = 1` (migration 002).
- The renderer finds books with that flag, opens each over `book://` with PDF.js, reads the title, author and language, renders page 1 to a JPEG, and sends the result to `library:completePdfMetadata`. It runs one book at a time.
- Main accepts the result only for a book still flagged, verifies the cover's bytes are a JPEG, PNG or WebP, stores it, and clears the flag. If extraction fails, the flag is cleared and the placeholder stays.
- The flag lives in the database, so extraction interrupted by closing the app is resumed on the next start.

## Consequences

- No native canvas dependency; the same PDF.js that will render pages in Phase 3 produces the cover.
- A newly imported PDF briefly shows its file name and a placeholder ("Reading book details…") before the real details appear. Usually under a second.
- Importing is not fully self-contained in main: a PDF only becomes "complete" while the app window is open. Acceptable for a desktop app whose import always starts from its window.
- The main process must not trust the renderer's data: it limits sizes, checks image bytes, and only applies the update once per book.
- PDF.js's WebAssembly image decoders (JPEG 2000, JBIG2) are left off for now. PDFs whose first page depends on them may get a blank cover; title and author are unaffected. Revisit in Phase 3.
