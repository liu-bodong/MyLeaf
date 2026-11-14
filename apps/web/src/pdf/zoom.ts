/** PDF zoom: fit the pane, or a factor where 1 is 100 % (actual size). */
export type PdfZoom = 'fit-width' | 'fit-page' | number;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** CSS pixels per PDF point at 100 % (96 dpi screen, 72 points per inch). */
export const CSS_PX_PER_PT = 96 / 72;

/** Zoom factors offered by zoom in / zoom out. */
export const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
] as const;

/**
 * CSS pixels per PDF point for a zoom, given the page sizes (PDF points) and
 * the pane's inner size; `gap` is the padding around the pages.
 */
export function displayScale(
  zoom: PdfZoom,
  pages: readonly Size[],
  pane: Size,
  gap: number,
): number {
  if (typeof zoom === 'number') return zoom * CSS_PX_PER_PT;
  return Math.max(MIN_FIT_SCALE, fitScale(zoom, pages, pane, gap));
}

/** Keeps pages visible in a pane narrower than its padding. */
const MIN_FIT_SCALE = 0.05;

function fitScale(
  zoom: 'fit-width' | 'fit-page',
  pages: readonly Size[],
  pane: Size,
  gap: number,
): number {
  const widest = Math.max(...pages.map((page) => page.width));
  const tallest = Math.max(...pages.map((page) => page.height));
  const fitWidth = (pane.width - 2 * gap) / widest;
  if (zoom === 'fit-width') return fitWidth;
  return Math.min(fitWidth, (pane.height - 2 * gap) / tallest);
}

/** Zoom factor (1 = 100 %) of a display scale. */
export function zoomFactor(scale: number): number {
  return scale / CSS_PX_PER_PT;
}

/** The next zoom step above (`1`) or below (`-1`) a zoom factor. */
export function stepZoom(factor: number, direction: 1 | -1): number {
  const tolerance = 0.005;
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > factor + tolerance) ?? ZOOM_STEPS.at(-1)!;
  }
  return ZOOM_STEPS.findLast((step) => step < factor - tolerance) ?? ZOOM_STEPS[0];
}

/** Top offsets of stacked pages: `gap` above the first page and between pages. */
export function pageTops(heights: readonly number[], gap: number): number[] {
  const tops: number[] = [];
  let top = gap;
  for (const height of heights) {
    tops.push(top);
    top += height + gap;
  }
  return tops;
}

/** Index of the last page starting at or above `y` (0 when `y` is above all pages). */
export function pageIndexAt(tops: readonly number[], y: number): number {
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (tops[middle]! <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Index of the page with the largest visible part of the range `[top, bottom)`. */
export function mostVisiblePage(
  tops: readonly number[],
  heights: readonly number[],
  top: number,
  bottom: number,
): number {
  let best = pageIndexAt(tops, top);
  let bestVisible = -1;
  for (let index = best; index < tops.length && tops[index]! < bottom; index++) {
    const pageTop = tops[index]!;
    const visible = Math.min(bottom, pageTop + heights[index]!) - Math.max(top, pageTop);
    if (visible > bestVisible) {
      best = index;
      bestVisible = visible;
    }
  }
  return best;
}
