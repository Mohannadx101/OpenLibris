# 0001 — Copy imported books into the app's library folder

Status: accepted

## Context

When a user imports a book we can either remember where the file lives, or copy it into storage the app owns.

## Decision

Copy it to `<userData>/library/<bookId>/book.(epub|pdf)`. Detect duplicates by SHA-256 of the file contents.

## Consequences

- The library keeps working if the user moves, renames or deletes the original (a Downloads folder, a USB stick).
- Backing up or moving the whole library is one folder plus one database file.
- Books are only ever read through the `book://` protocol from a known location, which keeps the renderer's file access narrow.
- Disk usage roughly doubles for imported books until the user deletes the originals. Accepted: the files are small relative to modern disks, and a bookshelf that silently breaks is worse.
- Removing a book from the library deletes our copy, never the user's original.
