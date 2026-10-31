import { contextBridge, ipcRenderer } from 'electron'
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

const api: OpenLibrisApi = {
  app: {
    ping: (request) => invoke('app:ping', request),
    getInfo: () => invoke('app:getInfo', undefined),
  },
}

contextBridge.exposeInMainWorld('api', api)
