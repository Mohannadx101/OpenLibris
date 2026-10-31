import type { IpcRequest, IpcResponse } from './ipc'
import type { Result } from './result'

/**
 * The only surface the renderer can use to reach the main process.
 * Implemented by the preload script and exposed as `window.api`.
 */
export interface OpenLibrisApi {
  app: {
    ping(request: IpcRequest<'app:ping'>): Promise<Result<IpcResponse<'app:ping'>>>
    getInfo(): Promise<Result<IpcResponse<'app:getInfo'>>>
  }
}
