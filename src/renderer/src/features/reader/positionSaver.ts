/**
 * Saves the reading position without hammering the database.
 *
 * Page turns can be fast, so `update` only schedules a save shortly after the reader stops.
 * `flush` saves right now; it is called when leaving the book or closing the window. Saves
 * never overlap, the newest position always wins, and a failed save is kept to be retried
 * with the next update or flush rather than being lost.
 */
export class PositionSaver<T> {
  private pending: { value: T } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly save: (value: T) => Promise<void>,
    private readonly options: { delayMs?: number; onError?: (error: unknown) => void } = {},
  ) {}

  update(value: T): void {
    this.pending = { value }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.options.delayMs ?? 400)
  }

  /** Resolves once everything handed to `update` so far has been attempted. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    this.queue = this.queue.then(() => this.writePending())
    return this.queue
  }

  /** Drops any scheduled save without writing it. Call `flush` first to keep the position. */
  cancel(): void {
    clearTimeout(this.timer)
    this.pending = null
  }

  private async writePending(): Promise<void> {
    const taken = this.pending
    if (!taken) return
    this.pending = null
    try {
      await this.save(taken.value)
    } catch (error) {
      // Keep it for the next attempt unless a newer position has already replaced it.
      this.pending ??= taken
      this.options.onError?.(error)
    }
  }
}
