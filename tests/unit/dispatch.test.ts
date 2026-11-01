import { describe, expect, it, vi } from 'vitest'
import { dispatch } from '@main/ipc/dispatch'
import type { Handlers } from '@main/ipc/dispatch'
import { AppFailure } from '@shared/result'

function makeHandlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    'app:ping': ({ message }) => ({ reply: `pong: ${message}`, receivedAt: 1 }),
    'app:getInfo': () => ({
      name: 'OpenLibris',
      version: '0.0.0',
      platform: 'test',
      schemaVersion: 1,
      dataDir: '/tmp',
    }),
    // Library channels are not exercised here; see libraryHandlers.test.ts.
    'library:list': () => [],
    'library:importFromDialog': () => ({ canceled: true, outcomes: [] }),
    'library:importPaths': () => ({ canceled: false, outcomes: [] }),
    'library:remove': () => null,
    'library:completePdfMetadata': () => {
      throw new Error('not used')
    },
    // Reading channels are not exercised here; see readingHandlers.test.ts.
    'reading:open': () => {
      throw new Error('not used')
    },
    'reading:save': () => null,
    ...overrides,
  }
}

describe('dispatch', () => {
  it('runs the handler and wraps the response', async () => {
    const result = await dispatch('app:ping', { message: 'hi' }, makeHandlers())
    expect(result).toEqual({ ok: true, data: { reply: 'pong: hi', receivedAt: 1 } })
  })

  it('supports channels without a request payload', async () => {
    const result = await dispatch('app:getInfo', undefined, makeHandlers())
    expect(result.ok).toBe(true)
  })

  it('rejects invalid payloads without calling the handler', async () => {
    const handler = vi.fn()
    const handlers = makeHandlers({ 'app:ping': handler })

    for (const bad of [undefined, null, {}, { message: '' }, { message: 42 }, 'hi']) {
      const result = await dispatch('app:ping', bad, handlers)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION')
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects an unexpected payload on a channel that takes none', async () => {
    const result = await dispatch('app:getInfo', { sneaky: true }, makeHandlers())
    expect(result.ok).toBe(false)
  })

  it('passes through the code of an AppFailure', async () => {
    const handlers = makeHandlers({
      'app:ping': () => {
        throw new AppFailure('NOT_FOUND', 'No such thing')
      },
    })
    const result = await dispatch('app:ping', { message: 'x' }, handlers)
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'No such thing' } })
  })

  it('hides the details of unexpected errors from the renderer', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers = makeHandlers({
      'app:ping': () => {
        throw new Error('database password is hunter2')
      },
    })
    const result = await dispatch('app:ping', { message: 'x' }, handlers)
    spy.mockRestore()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL')
      expect(result.error.message).not.toContain('hunter2')
    }
  })

  it('handles async handlers that reject', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers = makeHandlers({ 'app:ping': () => Promise.reject(new Error('boom')) })
    const result = await dispatch('app:ping', { message: 'x' }, handlers)
    spy.mockRestore()
    expect(result.ok).toBe(false)
  })
})
