import type { ReaderKey } from './adapters/ReaderAdapter'

export type KeyAction = 'next' | 'prev' | 'toc' | null

/** Maps a key press to a reader action. Anything with a modifier is left to the system. */
export function keyAction(event: ReaderKey): KeyAction {
  if (event.ctrlKey || event.metaKey || event.altKey) return null

  switch (event.key) {
    case 'ArrowRight':
    case 'PageDown':
      return 'next'
    case 'ArrowLeft':
    case 'PageUp':
      return 'prev'
    case ' ':
      return event.shiftKey ? 'prev' : 'next'
    case 't':
    case 'T':
      return 'toc'
    default:
      return null
  }
}
