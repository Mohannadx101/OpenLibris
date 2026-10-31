# 0005 — Sandboxed renderer, typed and validated IPC, `book://` for files

Status: accepted

## Context

The renderer displays third-party content (book files, which can contain HTML and scripts). It must not be able to reach the filesystem, the database or Node.

## Decision

- Renderer runs with `contextIsolation`, `sandbox`, no Node integration, and a strict Content-Security-Policy applied by the main process.
- The only bridge is a preload script exposing `window.api`, whose shape is the `OpenLibrisApi` interface.
- Every IPC channel is declared once, with zod schemas, in `src/shared/ipc.ts`. Main validates each request, rejects requests from any page other than the app's own, and returns a `Result<T>` instead of throwing.
- Book files and covers are read through a custom `book://` scheme that serves only `<uuid>/book.(epub|pdf)` and `<uuid>/cover.*` from the library folder, with Range support.

## Consequences

- A compromised or malicious book cannot read other files, call Node, or reach the network (CSP).
- Adding a channel is a small, mechanical, compiler-checked change in four places.
- The CSP must be widened deliberately when EPUB.js (frames) and PDF.js (WebAssembly decoders) are integrated; `security.ts` documents where, and has tests that should be updated alongside.
