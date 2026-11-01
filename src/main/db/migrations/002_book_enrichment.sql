-- PDF metadata and covers can only be produced by PDF.js, which runs in the renderer.
-- A PDF is inserted immediately with a title taken from its file name and this flag set;
-- the renderer then extracts the real title, author and cover and clears the flag.
ALTER TABLE books ADD COLUMN needs_enrichment INTEGER NOT NULL DEFAULT 0 CHECK (needs_enrichment IN (0, 1));
