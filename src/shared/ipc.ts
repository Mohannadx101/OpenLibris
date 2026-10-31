import { z } from 'zod'

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
} as const

export type IpcSchemas = typeof ipcSchemas
export type IpcChannel = keyof IpcSchemas
export type IpcRequest<C extends IpcChannel> = z.infer<IpcSchemas[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.infer<IpcSchemas[C]['response']>
