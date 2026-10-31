import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureAppDirs, resolveAppPaths } from '@main/paths'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openlibris-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('app paths', () => {
  it('lays out the data folder as documented', () => {
    const paths = resolveAppPaths(join(root, 'data'))
    expect(paths.dbFile).toBe(join(root, 'data', 'library.db'))
    expect(paths.libraryDir).toBe(join(root, 'data', 'library'))
    expect(paths.backupsDir).toBe(join(root, 'data', 'backups'))
  })

  it('creates the folders, and can be run repeatedly', () => {
    const paths = resolveAppPaths(join(root, 'data'))
    ensureAppDirs(paths)
    ensureAppDirs(paths)
    expect(existsSync(paths.libraryDir)).toBe(true)
    expect(existsSync(paths.backupsDir)).toBe(true)
  })
})
