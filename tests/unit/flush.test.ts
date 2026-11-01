import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BEFORE_CLOSE_CHANNEL, FLUSH_DONE_CHANNEL, waitForRendererFlush } from '@main/flush'

// `flush.ts` imports electron only for its default IPC bus; tests pass their own.
vi.mock('electron', () => ({ ipcMain: {} }))

const TRUSTED = 'file:///app/index.html'
const trusted = (url: string) => url === TRUSTED

function setup(overrides: { destroyed?: boolean; crashed?: boolean } = {}) {
  const ipc = new EventEmitter()
  const sent: string[] = []
  const contents = {
    isDestroyed: () => overrides.destroyed ?? false,
    isCrashed: () => overrides.crashed ?? false,
    send: (channel: string) => void sent.push(channel),
  }
  const ack = (sender: unknown, url = TRUSTED) =>
    ipc.emit(FLUSH_DONE_CHANNEL, { sender, senderFrame: { url } })
  return { ipc, sent, contents, ack }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('waitForRendererFlush', () => {
  it('asks the page to save, then resolves when the page says it is done', async () => {
    const { ipc, sent, contents, ack } = setup()
    let done = false
    const promise = waitForRendererFlush(contents, 2000, trusted, ipc).then(() => (done = true))

    expect(sent).toEqual([BEFORE_CLOSE_CHANNEL])
    await vi.advanceTimersByTimeAsync(500)
    expect(done).toBe(false)

    ack(contents)
    await promise
    expect(done).toBe(true)
  })

  it('stops waiting after the timeout so a stuck page cannot keep the window open', async () => {
    const { ipc, contents } = setup()
    let done = false
    void waitForRendererFlush(contents, 2000, trusted, ipc).then(() => (done = true))

    await vi.advanceTimersByTimeAsync(1999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
  })

  it('ignores a reply from another page or from an untrusted address', async () => {
    const { ipc, contents, ack } = setup()
    let done = false
    void waitForRendererFlush(contents, 2000, trusted, ipc).then(() => (done = true))

    ack({ some: 'other window' })
    ack(contents, 'https://evil.example/')
    await vi.advanceTimersByTimeAsync(100)
    expect(done).toBe(false)

    ack(contents)
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('does not ask a page that is already gone or crashed', async () => {
    for (const state of [{ destroyed: true }, { crashed: true }]) {
      const { ipc, sent, contents } = setup(state)
      await waitForRendererFlush(contents, 2000, trusted, ipc)
      expect(sent).toEqual([])
    }
  })

  it('stops listening once it has finished, whichever way it finished', async () => {
    const answered = setup()
    const first = waitForRendererFlush(answered.contents, 2000, trusted, answered.ipc)
    answered.ack(answered.contents)
    await first
    expect(answered.ipc.listenerCount(FLUSH_DONE_CHANNEL)).toBe(0)

    const timedOut = setup()
    const second = waitForRendererFlush(timedOut.contents, 2000, trusted, timedOut.ipc)
    await vi.advanceTimersByTimeAsync(2001)
    await second
    expect(timedOut.ipc.listenerCount(FLUSH_DONE_CHANNEL)).toBe(0)
  })
})
