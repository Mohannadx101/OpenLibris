# 0002 — Format-specific Locators for reading positions and annotations

Status: accepted

## Context

The app must restore the exact reading position and keep bookmarks and highlights correct when the user changes font size, window size or zoom. Page numbers and pixel offsets do not survive that.

## Decision

Positions and annotation ranges are stored as structured, format-specific values (see `src/shared/types.ts`), serialised as JSON:

- **EPUB:** a CFI (Canonical Fragment Identifier), which points into the document structure rather than at a screen position. Highlights store a CFI range.
- **PDF:** page number plus a fractional vertical offset (0..1) within the page. Highlights store character offsets into that page's extracted text.

Progress is derived separately: EPUB from the cached EPUB.js location index, PDF from `page / pageCount`.

## Consequences

- Positions survive re-layout; highlights can be redrawn at any size.
- Nothing outside the reader adapters needs to understand CFIs. The rest of the app treats a Locator as an opaque value to save and hand back.
- CFI is an EPUB standard rather than an EPUB.js invention, so stored positions should remain usable if EPUB.js is ever replaced (to be confirmed against the replacement's CFI implementation).
- PDF text offsets depend on PDF.js text extraction being stable between versions. If it changes, highlights could drift. We store the highlighted text with each highlight so a mismatch can be detected and re-anchored.
