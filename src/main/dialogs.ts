import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { BOOK_EXTENSIONS } from '@shared/types'

/** Shows the system file picker for books. Returns the chosen paths, or [] if canceled. */
export async function pickBookFiles(window: BrowserWindow | undefined): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Add books to your library',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Books (EPUB, PDF)', extensions: [...BOOK_EXTENSIONS] }],
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}
