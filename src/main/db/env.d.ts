// Gives `import.meta.glob` its types. Migrations are bundled as raw strings at build time,
// so the packaged app never needs to find .sql files on disk.
/// <reference types="vite/client" />
