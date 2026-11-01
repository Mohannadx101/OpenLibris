# 0007 — Reader adapter, position saving, and keeping the reader still while the layout moves

Status: accepted

## Context

Phase 2 is the first time the app shows a book. Three things had to be decided, and one was learned the hard way:

1. How the reader screen talks to EPUB.js (and, in Phase 3, PDF.js) without depending on either.
2. How the reading position is saved so that it survives a crash, a force-quit and a normal close.
3. How to restore that position _exactly_, when the text of an EPUB re-flows whenever the reading area changes size.

## Decision

**A small `ReaderAdapter` interface.** The reader screen (`ReaderPage`) imports only the interface (`open`, `next`, `prev`, `goTo`, `toc`, `onPosition`, `onKey`, `resize`, `destroy`). `EpubAdapter` is the only file that imports EPUB.js. The interface grows only when a phase needs a new member (selection, highlights, appearance and narration come later). Everything format-independent — keyboard mapping, the contents drawer, progress display, saving — lives outside the adapter and is shared by every format.

**Saving is debounced, serialised, and flushed at every exit.**

- `PositionSaver` waits 400 ms after the last position change, writes only the latest position, never runs two writes at once, and keeps a failed write to retry on the next update or flush.
- It is flushed when the reader screen is left, when the window is hidden, and when the window is about to close.
- Closing is a handshake: main intercepts the window's `close`, sends `app:before-close`, the page flushes and replies `app:flush-done`, and only then does the window close. Main gives up waiting after 2 s, so a stuck or crashed page can never keep the window open. The reply is accepted only from that window's own page.
- The locator stored is the EPUB CFI of the first word on the page, with an approximate overall progress. Main rejects a locator whose format does not match the book, and a stored locator that no longer parses is treated as "no saved position" so one bad row can never stop a book opening.

**The reader is not allowed to change size after the first page is shown, and resizing is handled by re-anchoring.**

- The reading area has a fixed size from the first frame. (The footer line that shows progress reserves its height up front.)
- When the reading area does change (the user resizes the window), `EpubAdapter` remembers where the reader was when resizing began, ignores the positions EPUB.js reports while it is busy, and once resizing has paused for 250 ms shows the remembered place again.

**The page policy is widened only as far as EPUB.js needs.** `style-src` and `font-src` gain `blob:` (EPUB.js turns a book's stylesheets and fonts into blob URLs) and `base-uri` becomes `'self'` (EPUB.js puts a `<base>` tag in each chapter). `frame-src` stays `'none'`: chapter frames are `srcdoc` frames, which that directive does not govern, and the end-to-end test confirms a book cannot embed anything. Scripts inside books stay off.

## What we learned about EPUB.js (so it does not have to be learned twice)

- Showing a saved position for the first time landed **one page early**, for every page but the first. A second display of the same position, once the chapter had settled, landed exactly. The cause was not EPUB.js itself but our own layout: the progress text appeared after the book loaded, the footer grew by a line, the reading area shrank, the text re-flowed from 7 pages to 8, and the scroll position computed for the old layout was now one page behind. Fixing the layout shift fixed the restore. **Any change to the reading area's size after the first display will do this**, so later phases (a settings panel, toolbars that auto-hide, themes that change line height) must either keep the area's size fixed or go through the same re-anchoring path.
- On a real resize, EPUB.js shows its own guess immediately, while the new layout is still being built, and the guess is often a page or two off. Re-showing the remembered position after the layout has settled is exact. A brief flicker to the guess while the window is actively being dragged is the cost.
- `rendition.currentLocation()` can return a stale value right after a display; do not use it to decide where the reader is. Positions come from the `relocated` event, and are withheld until the first display has finished.
- Typings are incomplete: `spine.length` and `packaging.navPath` exist at runtime but not in the types, and `rendition.resize` takes a third argument (a CFI) the types omit. The adapter isolates these in one small interface.
- Table-of-contents links are written relative to the contents file, which is not always in the same folder as the package file. They are resolved against the contents file's own folder (tested with a book whose contents live in a sub-folder).

## Consequences

- Adding PDF reading (Phase 3) means writing one adapter and registering it; the reader screen, saving and closing do not change.
- A hard kill (power loss, `kill -9`, a crash) can lose the last few page turns, at most the final 400 ms, because the save is debounced. The position saved by then is always a real earlier position, never a corrupt one. Closing the window or quitting the app loses nothing.
- Progress is an estimate in Phase 2 (each file in the book counts as an equal share). It is shown, and stored, but never used to find the reader's place; the CFI does that. Phase 4 replaces it with a proper location index.
- After resizing the window to a different width, the page the reader returns to is the page that _contains_ the old place, so a little earlier text may be visible at the top. The text the reader was looking at is always still on screen.
- Opening a book writes `last_opened_at`; opening a PDF in Phase 2 shows a notice instead of the book and creates no saved position.
