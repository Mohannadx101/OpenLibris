import type { IpcRequest, IpcResponse } from './ipc'
import type { Book, ImportResult } from './library'
import type { OpenedBook } from './reading'
import type { Result } from './result'

/**
 * The only surface the renderer can use to reach the main process.
 * Implemented by the preload script and exposed as `window.api`.
 */
export interface OpenLibrisApi {
  app: {
    ping(request: IpcRequest<'app:ping'>): Promise<Result<IpcResponse<'app:ping'>>>
    getInfo(): Promise<Result<IpcResponse<'app:getInfo'>>>
    /**
     * Registers work to finish before the window closes (e.g. saving a reading position).
     * The window waits for every registered handler, up to a short timeout, before closing.
     * Returns a function that unregisters the handler.
     */
    onBeforeClose(handler: () => void | Promise<void>): () => void
  }
  library: {
    list(): Promise<Result<Book[]>>
    importFromDialog(): Promise<Result<ImportResult>>
    importPaths(request: IpcRequest<'library:importPaths'>): Promise<Result<ImportResult>>
    remove(request: IpcRequest<'library:remove'>): Promise<Result<null>>
    completePdfMetadata(request: IpcRequest<'library:completePdfMetadata'>): Promise<Result<Book>>
    /**
     * Calls back with the absolute paths of files dropped onto the window. Paths are read in
     * the preload (the renderer cannot see them), and only from real user drops.
     * Returns a function that stops listening.
     */
    onFilesDropped(callback: (paths: string[]) => void): () => void
  }
  reading: {
    open(request: IpcRequest<'reading:open'>): Promise<Result<OpenedBook>>
    save(request: IpcRequest<'reading:save'>): Promise<Result<null>>
  }
}
