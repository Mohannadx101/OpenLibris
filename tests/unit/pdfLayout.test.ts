import { describe, expect, it } from 'vitest'
import {
  PAGE_GAP,
  PAGE_PADDING,
  clampZoom,
  computeLayout,
  positionAt,
  progressAt,
  scrollTopFor,
  stepZoom,
  visiblePages,
} from '@renderer/features/reader/pdfLayout'

const sizes = [
  { width: 600, height: 800 },
  { width: 600, height: 800 },
  { width: 600, height: 400 },
]

describe('computeLayout', () => {
  it('stacks pages with padding and gaps', () => {
    const layout = computeLayout(sizes, 1)
    expect(layout.tops).toEqual([
      PAGE_PADDING,
      PAGE_PADDING + 800 + PAGE_GAP,
      PAGE_PADDING + 1600 + 2 * PAGE_GAP,
    ])
    expect(layout.totalHeight).toBe(PAGE_PADDING * 2 + 2000 + 2 * PAGE_GAP)
  })

  it('scales heights', () => {
    expect(computeLayout(sizes, 0.5).heights).toEqual([400, 400, 200])
  })

  it('handles no pages', () => {
    expect(computeLayout([], 1).totalHeight).toBe(0)
  })
})

describe('positionAt / scrollTopFor', () => {
  const layout = computeLayout(sizes, 1)

  it('finds the page and fraction at a scroll position', () => {
    const at = positionAt(layout, scrollTopFor(layout, 2, 0.25))
    expect(at.page).toBe(2)
    expect(at.offsetY).toBeCloseTo(0.25)
  })

  it('treats the space above the first page as its start', () => {
    expect(positionAt(layout, 0)).toEqual({ page: 1, offsetY: 0 })
  })

  it('treats the gap below a page as its end', () => {
    const inGap = (layout.tops[0] ?? 0) + 800 + 4
    expect(positionAt(layout, inGap)).toEqual({ page: 1, offsetY: 1 })
  })

  it('treats a scroll one pixel short of a page as the start of that page', () => {
    const start = layout.tops[1] ?? 0
    expect(positionAt(layout, start - 0.6)).toEqual({ page: 2, offsetY: 0 })
  })

  it('keeps the same place when the scale changes', () => {
    const { page, offsetY } = positionAt(layout, scrollTopFor(layout, 3, 0.6))
    const zoomed = computeLayout(sizes, 2.3)
    const again = positionAt(zoomed, scrollTopFor(zoomed, page, offsetY))
    expect(again.page).toBe(3)
    expect(again.offsetY).toBeCloseTo(0.6)
  })

  it('clamps an out-of-range page', () => {
    expect(scrollTopFor(layout, 99, 0)).toBe(layout.tops[2])
    expect(scrollTopFor(layout, 0, 0)).toBe(layout.tops[0])
  })
})

describe('visiblePages', () => {
  const layout = computeLayout(sizes, 1)

  it('returns the pages a span touches', () => {
    expect(visiblePages(layout, 0, 100)).toEqual([1, 1])
    expect(visiblePages(layout, 700, 1000)).toEqual([1, 2])
    expect(visiblePages(layout, -500, 5000)).toEqual([1, 3])
  })

  it('is empty without pages', () => {
    expect(visiblePages(computeLayout([], 1), 0, 10)).toEqual([1, 0])
  })
})

describe('progressAt', () => {
  it('is the fraction of pages passed', () => {
    expect(progressAt(1, 0, 10, false)).toBe(0)
    expect(progressAt(6, 0.5, 10, false)).toBeCloseTo(0.55)
  })

  it('reaches 1 at the bottom', () => {
    expect(progressAt(10, 0.3, 10, true)).toBe(1)
  })

  it('is 0 for an empty document', () => {
    expect(progressAt(1, 0, 0, false)).toBe(0)
  })
})

describe('zoom', () => {
  it('steps through presets and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(0.5, -1)).toBe(0.5)
  })

  it('moves off a value between presets', () => {
    expect(stepZoom(1.2, 1)).toBe(1.25)
    expect(stepZoom(1.2, -1)).toBe(1.1)
  })

  it('clamps', () => {
    expect(clampZoom(10)).toBe(4)
    expect(clampZoom(0.1)).toBe(0.5)
  })
})
