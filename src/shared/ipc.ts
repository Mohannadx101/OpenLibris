import { z } from 'zod'
import { bookSchema, importResultSchema, pdfMetadataSchema } from './library'
import { openedBookSchema, savePositionSchema } from './reading'

/**
 * The single source of truth for every IPC channel.
 *
 * Each channel declares a request schema and a response schema. Main validates incoming
 * requests against the request schema; both sides derive their TypeScript types from the
 * schemas, so the contract cannot drift between processes.
 *
 * To add a channel: add an entry here, implement it in `src/main/ipc/`, and expose it in
 * `src/preload/index.ts` and `src/shared/api.ts`.
 */
export const ipcSchemas = {
  'app:ping': {
    request: z.object({ message: z.string().min(1).max(200) }),
    response: z.object({ reply: z.string(), receivedAt: z.number() }),
  },
  'app:getInfo': {
    request: z.undefined(),
    response: z.object({
      name: z.string(),
      version: z.string(),
      platform: z.string(),
      schemaVersion: z.number().int().nonnegative(),
      dataDir: z.string(),
    }),
  },
  'library:list': {
    request: z.undefined(),
    response: z.array(bookSchema),
  },
  /** Opens the system file dialog, then imports whatever the user chose. */
  'library:importFromDialog': {
    request: z.undefined(),
    response: importResultSchema,
  },
  /** Imports files the user dropped onto the window. */
  'library:importPaths': {
    request: z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(500) }),
    response: importResultSchema,
  },
  'library:remove': {
    request: z.object({ id: z.string().uuid() }),
    response: z.null(),
  },
  /** Delivers the title, author and cover that PDF.js extracted in the renderer. */
  'library:completePdfMetadata': {
    request: pdfMetadataSchema,
    response: bookSchema,
  },
  /** Opens a book for reading: marks it as opened and returns where the user left off. */
  'reading:open': {
    request: z.object({ bookId: z.string().uuid() }),
    response: openedBookSchema,
  },
  'reading:save': {
    request: savePositionSchema,
    response: z.null(),
  },
} as const

export type IpcSchemas = typeof ipcSchemas
export type IpcChannel = keyof IpcSchemas
export type IpcRequest<C extends IpcChannel> = z.infer<IpcSchemas[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.infer<IpcSchemas[C]['response']>
