import { ipcMain } from 'electron'
import { ipcSchemas } from '@shared/ipc'
import type { IpcChannel } from '@shared/ipc'
import { err } from '@shared/result'
import { dispatch } from './dispatch'
import type { Handlers } from './dispatch'

/**
 * Registers every channel with Electron. Requests are rejected unless they come from the app's
 * own page, so a stray frame or injected content can never reach the handlers.
 */
export function registerIpcHandlers(
  handlers: Handlers,
  isTrustedUrl: (url: string) => boolean,
): void {
  for (const channel of Object.keys(ipcSchemas) as IpcChannel[]) {
    ipcMain.handle(channel, (event, raw: unknown) => {
      const senderUrl = event.senderFrame?.url ?? ''
      if (!isTrustedUrl(senderUrl)) {
        console.error(`[ipc] rejected ${channel} from untrusted sender: ${senderUrl}`)
        return err('FORBIDDEN', 'Request not allowed.')
      }
      return dispatch(channel, raw, handlers)
    })
  }
}
