/**
 * Geometry of a continuously scrolling PDF. Pure functions, so the maths that decides where
 * the reader is (and where to put them back) can be tested without a browser.
 *
 * Pages are stacked top to bottom with a gap between them. A position is stored as a page
 * number plus how far down that page the top of the view is (0..1). That fraction does not
 * depend on zoom or window width, which is what lets a position survive both.
 */

export interface PageSize {
  width: number
  height: number
}

export interface PdfLayout {
  /** Scrolling distance from the top of the document to the top of each page (index 0 = page 1). */
  tops: number[]
  /** Height of each page at the current scale. */
  heights: number[]
  /** Height of the whole document, padding included. */
  totalHeight: number
}

export const PAGE_GAP = 12
export const PAGE_PADDING = 16

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

export function computeLayout(sizes: PageSize[], scale: number): PdfLayout {
  const tops: number[] = []
  const heights: number[] = []
  let y = PAGE_PADDING
  for (const size of sizes) {
    const height = size.height * scale
    tops.push(y)
    heights.push(height)
    y += height + PAGE_GAP
  }
  const totalHeight = sizes.length === 0 ? 0 : y - PAGE_GAP + PAGE_PADDING
  return { tops, heights, totalHeight }
}

/**
 * The page at the top of the view and how far down it the view starts.
 * Space between pages counts as the end of the page above it.
 */
export function positionAt(
  layout: PdfLayout,
  scrollTop: number,
): { page: number; offsetY: number } {
  const count = layout.tops.length
  if (count === 0) return { page: 1, offsetY: 0 }

  let low = 0
  let high = count - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if ((layout.tops[mid] ?? 0) <= scrollTop) low = mid
    else high = mid - 1
  }
  // Browsers round scroll positions, so a scroll to the very top of a page can land a pixel
  // short of it. That is the start of the page, not the end of the one above.
  if (low + 1 < count && (layout.tops[low + 1] ?? Infinity) - scrollTop <= 1) low++
  const top = layout.tops[low] ?? 0
  const height = layout.heights[low] ?? 0
  const offsetY = height > 0 ? (scrollTop - top) / height : 0
  return { page: low + 1, offsetY: Math.min(Math.max(offsetY, 0), 1) }
}

/** The scroll distance that puts `offsetY` of `page` at the top of the view. */
export function scrollTopFor(layout: PdfLayout, page: number, offsetY: number): number {
  const index = Math.min(Math.max(page, 1), Math.max(layout.tops.length, 1)) - 1
  const top = layout.tops[index] ?? 0
  const height = layout.heights[index] ?? 0
  return top + Math.min(Math.max(offsetY, 0), 1) * height
}

/** First and last page (1-based, inclusive) that touch the span `from`..`to`. */
export function visiblePages(layout: PdfLayout, from: number, to: number): [number, number] {
  const count = layout.tops.length
  if (count === 0) return [1, 0]
  const first = positionAt(layout, from).page
  const last = positionAt(layout, to).page
  return [first, Math.max(first, last)]
}

/**
 * How far through the book the view is, 0..1. The bottom of the last page counts as finished,
 * so a short last page can still reach 100%.
 */
export function progressAt(
  page: number,
  offsetY: number,
  pageCount: number,
  atBottom: boolean,
): number {
  if (pageCount <= 0) return 0
  if (atBottom) return 1
  return Math.min(Math.max((page - 1 + offsetY) / pageCount, 0), 1)
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

/** The next preset zoom level above or below `zoom`; unchanged at the ends. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 0.001
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > zoom + epsilon) ?? MAX_ZOOM
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = ZOOM_STEPS[i] as number
    if (step < zoom - epsilon) return step
  }
  return MIN_ZOOM
}
