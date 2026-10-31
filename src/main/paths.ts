import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface AppPaths {
  /** Root of everything OpenLibris stores (Electron's userData folder). */
  dataDir: string
  dbFile: string
  /** One sub-folder per book: `<bookId>/book.epub|pdf` and `cover.*`. */
  libraryDir: string
  backupsDir: string
}

export function resolveAppPaths(dataDir: string): AppPaths {
  return {
    dataDir,
    dbFile: join(dataDir, 'library.db'),
    libraryDir: join(dataDir, 'library'),
    backupsDir: join(dataDir, 'backups'),
  }
}

export function ensureAppDirs(paths: AppPaths): void {
  for (const dir of [paths.dataDir, paths.libraryDir, paths.backupsDir]) {
    mkdirSync(dir, { recursive: true })
  }
}
