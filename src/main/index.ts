import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { openDatabase } from './db/connection'
import type { Db } from './db/connection'
import { loadBundledMigrations, runMigrations } from './db/migrate'
import { createHandlers } from './ipc/appHandlers'
import { registerIpcHandlers } from './ipc/register'
import { ensureAppDirs, resolveAppPaths } from './paths'
import { registerLibraryProtocol, registerLibrarySchemePrivileges } from './protocol'
import { createAppUrlGuard } from './security'
import { createMainWindow, installContentSecurityPolicy } from './window'

// --- Before the app is ready -------------------------------------------------------------

// Development uses its own data folder so a bug can never touch the real library.
// OPENLIBRIS_DATA_DIR overrides both (useful for tests and for trying a fresh library).
if (process.env.OPENLIBRIS_DATA_DIR) {
  app.setPath('userData', process.env.OPENLIBRIS_DATA_DIR)
} else if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

registerLibrarySchemePrivileges()

// --- Composition root ----------------------------------------------------------------------

let db: Db | undefined
let mainWindow: BrowserWindow | undefined
let openWindow: (() => BrowserWindow) | undefined

/** One-time setup: storage, database, security, IPC. Returns a function that opens the window. */
function bootstrap(): () => BrowserWindow {
  const paths = resolveAppPaths(app.getPath('userData'))
  ensureAppDirs(paths)

  db = openDatabase(paths.dbFile)
  runMigrations(db, loadBundledMigrations())

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const rendererFile = join(__dirname, '../renderer/index.html')
  const isAppUrl = createAppUrlGuard({ devServerUrl, rendererFile })

  registerLibraryProtocol(paths.libraryDir)
  installContentSecurityPolicy(devServerUrl)
  registerIpcHandlers(
    createHandlers({
      db,
      appName: app.getName(),
      appVersion: app.getVersion(),
      dataDir: paths.dataDir,
    }),
    isAppUrl,
  )

  return () => createMainWindow({ devServerUrl, rendererFile, isAppUrl })
}

// Two instances writing to one database would be a reliability risk; keep a single one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('activate', () => {
    // macOS: clicking the dock icon with no windows open opens a new one.
    if (openWindow && BrowserWindow.getAllWindows().length === 0) mainWindow = openWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    db?.close()
  })

  void app.whenReady().then(() => {
    try {
      openWindow = bootstrap()
      mainWindow = openWindow()
    } catch (error) {
      // A broken database or failed migration must be visible, not a silent blank window.
      console.error('[startup] failed:', error)
      dialog.showErrorBox(
        'OpenLibris could not start',
        error instanceof Error ? error.message : String(error),
      )
      app.exit(1)
    }
  })
}
