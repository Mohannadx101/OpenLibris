import { describe, expect, it, vi } from 'vitest'
import { dispatch } from '@main/ipc/dispatch'
import { createLibraryHandlers } from '@main/ipc/libraryHandlers'
import type { LibraryService } from '@main/services/library/libraryService'
import type { Handlers } from '@main/ipc/dispatch'
import { createAppHandlers } from '@main/ipc/appHandlers'
import type { Db } from '@main/db/connection'

const ID = '123e4567-e89b-12d3-a456-426614174000'

function setup(picked: string[] = []) {
  const library = {
    list: vi.fn(() => []),
    importFiles: vi.fn(async (paths: string[]) =>
      paths.map((p) => ({ status: 'failed' as const, fileName: p, reason: 'x' })),
    ),
    remove: vi.fn(async () => undefined),
    completePdfMetadata: vi.fn(),
  }
  const pickBookFiles = vi.fn(async () => picked)
  const handlers = {
    ...createAppHandlers({ db: {} as Db, appName: 'a', appVersion: '1', dataDir: '/d' }),
    ...createLibraryHandlers({ library: library as unknown as LibraryService, pickBookFiles }),
  } as Handlers
  return { library, pickBookFiles, handlers }
}

describe('library channels', () => {
  it('reports a canceled dialog without importing anything', async () => {
    const { handlers, library } = setup([])
    const result = await dispatch('library:importFromDialog', undefined, handlers)
    expect(result).toEqual({ ok: true, data: { canceled: true, outcomes: [] } })
    expect(library.importFiles).not.toHaveBeenCalled()
  })

  it('imports whatever the dialog returns', async () => {
    const { handlers, library } = setup(['/a.pdf', '/b.epub'])
    const result = await dispatch('library:importFromDialog', undefined, handlers)
    expect(library.importFiles).toHaveBeenCalledWith(['/a.pdf', '/b.epub'])
    expect(result.ok && result.data.canceled).toBe(false)
    expect(result.ok && result.data.outcomes).toHaveLength(2)
  })

  it('imports dropped paths', async () => {
    const { handlers, library } = setup()
    await dispatch('library:importPaths', { paths: ['/x.pdf'] }, handlers)
    expect(library.importFiles).toHaveBeenCalledWith(['/x.pdf'])
  })

  it.each([
    ['no paths', { paths: [] }],
    ['a non-string path', { paths: [42] }],
    ['an empty path', { paths: [''] }],
    ['too many paths', { paths: Array.from({ length: 501 }, (_, i) => `/f${i}.pdf`) }],
    ['a missing field', {}],
  ])('rejects importPaths with %s', async (_label, payload) => {
    const { handlers, library } = setup()
    const result = await dispatch('library:importPaths', payload, handlers)
    expect(result.ok).toBe(false)
    expect(library.importFiles).not.toHaveBeenCalled()
  })

  it('removes a book by id', async () => {
    const { handlers, library } = setup()
    const result = await dispatch('library:remove', { id: ID }, handlers)
    expect(result).toEqual({ ok: true, data: null })
    expect(library.remove).toHaveBeenCalledWith(ID)
  })

  it.each([['not-a-uuid'], ['../../etc'], [''], [42]])('rejects remove with id %j', async (id) => {
    const { handlers, library } = setup()
    const result = await dispatch('library:remove', { id }, handlers)
    expect(result.ok).toBe(false)
    expect(library.remove).not.toHaveBeenCalled()
  })

  it('validates PDF metadata input', async () => {
    const { handlers, library } = setup()
    const bad = [
      { id: 'nope', failed: false },
      { id: ID },
      { id: ID, failed: false, cover: 'not bytes' },
      { id: ID, failed: false, title: 'x'.repeat(1001) },
      { id: ID, failed: false, cover: new Uint8Array(10 * 1024 * 1024 + 1) },
    ]
    for (const payload of bad) {
      const result = await dispatch('library:completePdfMetadata', payload, handlers)
      expect(result.ok, JSON.stringify(payload).slice(0, 80)).toBe(false)
    }
    expect(library.completePdfMetadata).not.toHaveBeenCalled()
  })

  it('accepts valid PDF metadata, including a binary cover', async () => {
    const { handlers, library } = setup()
    library.completePdfMetadata.mockResolvedValue({ id: ID })
    const result = await dispatch(
      'library:completePdfMetadata',
      { id: ID, failed: false, title: 'T', cover: new Uint8Array([1, 2, 3]) },
      handlers,
    )
    expect(result.ok).toBe(true)
    expect(library.completePdfMetadata).toHaveBeenCalledOnce()
  })
})
