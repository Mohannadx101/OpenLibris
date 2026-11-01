import { ipcSchemas } from '@shared/ipc'
import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/ipc'
import { AppFailure, err, ok } from '@shared/result'
import type { Result } from '@shared/result'

/**
 * One handler per channel. Because this is a mapped type over every channel in the contract,
 * adding a channel to `src/shared/ipc.ts` without implementing it is a compile error.
 */
export type HandlersFor<C extends IpcChannel> = {
  [K in C]: (request: IpcRequest<K>) => IpcResponse<K> | Promise<IpcResponse<K>>
}

export type Handlers = HandlersFor<IpcChannel>

/** The channels of one domain, e.g. ChannelsOf<'library'> is every `library:*` channel. */
export type ChannelsOf<Domain extends string> = Extract<IpcChannel, `${Domain}:${string}`>

/**
 * Validates a raw request, runs the matching handler, and converts the outcome (including any
 * thrown error) into a Result. Contains no Electron imports, so it is unit tested directly.
 */
export async function dispatch<C extends IpcChannel>(
  channel: C,
  raw: unknown,
  handlers: Handlers,
): Promise<Result<IpcResponse<C>>> {
  const schema = ipcSchemas[channel]
  if (!schema) return err('VALIDATION', `Unknown channel: ${String(channel)}`)

  const parsed = schema.request.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ` : '') + issue.message)
      .join('; ')
    return err('VALIDATION', `Invalid request for ${channel}: ${detail}`)
  }

  const handler = handlers[channel] as (
    request: IpcRequest<C>,
  ) => IpcResponse<C> | Promise<IpcResponse<C>>

  try {
    return ok(await handler(parsed.data as IpcRequest<C>))
  } catch (error) {
    if (error instanceof AppFailure) return err(error.code, error.message)
    // Details stay in the main process log; the renderer gets a generic message.
    console.error(`[ipc] ${channel} failed:`, error)
    return err('INTERNAL', 'Something went wrong. Please try again.')
  }
}
