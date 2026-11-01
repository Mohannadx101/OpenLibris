import { join } from 'node:path'
import { BrowserWindow, session, shell } from 'electron'
import { waitForRendererFlush } from './flush'
import { buildContentSecurityPolicy } from './security'

/** Longest the window waits for the page to finish saving before closing anyway. */
const CLOSE_FLUSH_TIMEOUT_MS = 2000

export interface WindowOptions {
  /** Vite dev server URL (set by electron-vite in development), if any. */
  devServerUrl?: string | undefined
  /** Absolute path of the built renderer entry for production. */
  rendererFile: string
  isAppUrl: (url: string) => boolean
}

/** Applies the Content-Security-Policy to every response the renderer receives. */
export function installContentSecurityPolicy(devServerUrl: string | undefined): void {
  const policy = buildContentSecurityPolicy({
    dev: Boolean(devServerUrl),
    ...(devServerUrl ? { devServerOrigin: new URL(devServerUrl).origin } : {}),
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

export function createMainWindow({
  devServerUrl,
  rendererFile,
  isAppUrl,
}: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    title: 'OpenLibris',
    // Matches the app background so there is no white flash while loading.
    backgroundColor: '#f6f1e7',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  // Before the window closes, give the page a moment to save what it has not saved yet (the
  // reading position). The second `close` goes straight through.
  let readyToClose = false
  window.on('close', (event) => {
    if (readyToClose) return
    event.preventDefault()
    readyToClose = true
    void waitForRendererFlush(window.webContents, CLOSE_FLUSH_TIMEOUT_MS, isAppUrl).finally(() => {
      if (!window.isDestroyed()) window.close()
    })
  })

  // The app is a single page. Never let it navigate to, or spawn, anything else.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Links clicked inside a book open in the system browser, never in the app.
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(rendererFile)
  }

  return window
}
