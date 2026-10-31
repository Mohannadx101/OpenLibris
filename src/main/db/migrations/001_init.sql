-- OpenLibris initial schema.
-- Timestamps are Unix epoch milliseconds. Structured values (locators, ranges) are JSON text.

CREATE TABLE books (
  id              TEXT PRIMARY KEY,                       -- UUID, also the library folder name
  content_hash    TEXT NOT NULL UNIQUE,                   -- SHA-256 of the file, used to reject duplicates
  format          TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
  title           TEXT NOT NULL,
  author          TEXT,
  language        TEXT,
  file_path       TEXT NOT NULL,                          -- relative to the library directory
  cover_path      TEXT,                                   -- relative to the library directory
  file_size       INTEGER NOT NULL,
  added_at        INTEGER NOT NULL,
  last_opened_at  INTEGER
);

CREATE INDEX idx_books_added_at ON books (added_at);
CREATE INDEX idx_books_last_opened_at ON books (last_opened_at);

CREATE TABLE reading_state (
  book_id     TEXT PRIMARY KEY REFERENCES books (id) ON DELETE CASCADE,
  locator     TEXT NOT NULL,                              -- JSON Locator
  progress    REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  updated_at  INTEGER NOT NULL
);

CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  locator     TEXT NOT NULL,                              -- JSON Locator
  label       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_bookmarks_book_id ON bookmarks (book_id);

CREATE TABLE highlights (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  range       TEXT NOT NULL,                              -- JSON AnnotationRange
  text        TEXT NOT NULL,                              -- the selected text, for lists and search
  color       TEXT NOT NULL,
  note        TEXT,                                       -- a note is a highlight with a comment
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_highlights_book_id ON highlights (book_id);

-- EPUB.js needs to generate a location index to report percentages; it is slow, so cache it.
CREATE TABLE epub_locations_cache (
  book_id  TEXT PRIMARY KEY REFERENCES books (id) ON DELETE CASCADE,
  data     TEXT NOT NULL
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                                    -- JSON
);
