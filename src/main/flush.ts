import { ipcMain } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron'

export const BEFORE_CLOSE_CHANNEL = 'app:before-close'
export const FLUSH_DONE_CHANNEL = 'app:flush-done'

/** The part of Electron's `ipcMain` this needs, so tests can supply their own. */
export interface FlushBus {
  on(channel: string, listener: (event: IpcMainEvent) => void): unknown
  removeListener(channel: string, listener: (event: IpcMainEvent) => void): unknown
}

/**
 * Asks the page to finish pending work (like saving a reading position) and waits for it to
 * say it is done. Resolves after `timeoutMs` at the latest, so a stuck or crashed page can
 * never stop the window from closing.
 */
export function waitForRendererFlush(
  contents: Pick<WebContents, 'isDestroyed' | 'isCrashed' | 'send'>,
  timeoutMs: number,
  isTrusted: (url: string) => boolean,
  ipc: FlushBus = ipcMain,
): Promise<void> {
  return new Promise((resolve) => {
    if (contents.isDestroyed() || contents.isCrashed()) return resolve()

    const finish = () => {
      clearTimeout(timer)
      ipc.removeListener(FLUSH_DONE_CHANNEL, onDone)
      resolve()
    }
    const onDone = (event: IpcMainEvent) => {
      if (event.sender === contents && isTrusted(event.senderFrame?.url ?? '')) finish()
    }
    const timer = setTimeout(finish, timeoutMs)

    ipc.on(FLUSH_DONE_CHANNEL, onDone)
    contents.send(BEFORE_CLOSE_CHANNEL)
  })
}
