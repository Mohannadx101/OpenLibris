import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { OpenLibrisApi } from '@shared/api'
import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/ipc'
import type { Result } from '@shared/result'

// Only types are imported from shared code, so nothing but this file ends up in the sandboxed
// preload bundle. The renderer gets exactly the methods below and no access to ipcRenderer.

function invoke<C extends IpcChannel>(
  channel: C,
  request: IpcRequest<C>,
): Promise<Result<IpcResponse<C>>> {
  return ipcRenderer.invoke(channel, request) as Promise<Result<IpcResponse<C>>>
}

// --- File drops ---------------------------------------------------------------------------
// The renderer never sees file paths. This script, which runs in the page but in its own
// isolated world, reads them from real drop events and hands over only a list of paths.

type DropCallback = (paths: string[]) => void
const dropListeners = new Set<DropCallback>()

window.addEventListener('dragover', (event) => {
  // Without this the browser would navigate to the dropped file instead of firing `drop`.
  event.preventDefault()
})

window.addEventListener('drop', (event) => {
  event.preventDefault()
  if (!event.isTrusted || !event.dataTransfer) return

  const paths = Array.from(event.dataTransfer.files)
    .map((file) => webUtils.getPathForFile(file))
    .filter((path) => path !== '')
  if (paths.length === 0) return

  for (const listener of dropListeners) listener(paths)
})

// --- Closing -------------------------------------------------------------------------------
// Before the window closes, main asks the page to finish pending work (saving the reading
// position) and waits for the reply. Only the channel name and a bare signal cross here.

type CloseHandler = () => void | Promise<void>
const closeHandlers = new Set<CloseHandler>()

ipcRenderer.on('app:before-close', () => {
  void Promise.allSettled([...closeHandlers].map((handler) => handler())).then(() => {
    ipcRenderer.send('app:flush-done')
  })
})

const api: OpenLibrisApi = {
  app: {
    ping: (request) => invoke('app:ping', request),
    getInfo: () => invoke('app:getInfo', undefined),
    onBeforeClose: (handler) => {
      closeHandlers.add(handler)
      return () => {
        closeHandlers.delete(handler)
      }
    },
  },
  library: {
    list: () => invoke('library:list', undefined),
    importFromDialog: () => invoke('library:importFromDialog', undefined),
    importPaths: (request) => invoke('library:importPaths', request),
    remove: (request) => invoke('library:remove', request),
    completePdfMetadata: (request) => invoke('library:completePdfMetadata', request),
    onFilesDropped: (callback) => {
      dropListeners.add(callback)
      return () => {
        dropListeners.delete(callback)
      }
    },
  },
  reading: {
    open: (request) => invoke('reading:open', request),
    save: (request) => invoke('reading:save', request),
  },
}

contextBridge.exposeInMainWorld('api', api)
