import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PositionSaver } from '@renderer/features/reader/positionSaver'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PositionSaver', () => {
  it('waits for the reader to stop before saving, and saves only the latest position', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver<number>(save, { delayMs: 300 })

    saver.update(1)
    await vi.advanceTimersByTimeAsync(200)
    saver.update(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(save).not.toHaveBeenCalled()

    saver.update(3)
    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(3)
  })

  it('flush saves immediately and cancels the scheduled save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver<number>(save, { delayMs: 300 })

    saver.update(7)
    await saver.flush()
    expect(save).toHaveBeenCalledWith(7)

    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush with nothing pending does nothing', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await new PositionSaver<number>(save).flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('never runs two saves at once, and the newest position is written last', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const save = vi.fn(async (value: number) => {
      order.push(`start ${value}`)
      if (value === 1) await new Promise<void>((resolve) => (releaseFirst = resolve))
      order.push(`end ${value}`)
    })
    const saver = new PositionSaver<number>(save)

    saver.update(1)
    const first = saver.flush()
    await vi.advanceTimersByTimeAsync(0)
    saver.update(2)
    const second = saver.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['start 1'])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
  })

  it('keeps a failed position and retries it on the next flush', async () => {
    const onError = vi.fn()
    const save = vi.fn().mockRejectedValueOnce(new Error('disk busy')).mockResolvedValue(undefined)
    const saver = new PositionSaver<number>(save, { onError })

    saver.update(5)
    await saver.flush()
    expect(onError).toHaveBeenCalledTimes(1)

    await saver.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(5)
  })

  it('does not overwrite a newer position with a failed older one', async () => {
    let fail = true
    const save = vi.fn(async (value: number) => {
      if (fail && value === 1) {
        saver.update(2)
        throw new Error('nope')
      }
    })
    const saver = new PositionSaver<number>(save, { onError: () => {} })

    saver.update(1)
    await saver.flush()
    fail = false
    await saver.flush()
    expect(save).toHaveBeenLastCalledWith(2)
  })

  it('cancel drops what has not been saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver<number>(save, { delayMs: 100 })
    saver.update(1)
    saver.cancel()
    await vi.advanceTimersByTimeAsync(500)
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
  })
})
