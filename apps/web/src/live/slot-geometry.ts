import { CSS_PX_PER_PT } from '../pdf/zoom.js';
import type { PdfZoom, Size } from '../pdf/zoom.js';

/** The scroller's content box, in device pixels where positions matter. */
export interface PaneMeasure {
  readonly dpr: number;
  /** Left edge of the content box, in (fractional) device pixels. */
  readonly left: number;
  /** First whole device pixel in the content box. */
  readonly start: number;
  /** Whole device pixels from `start` to the content box's right edge. */
  readonly width: number;
  /** Content height in CSS pixels. */
  readonly height: number;
}

/**
 * Where page slots go in the scroller, on whole device pixels: a canvas
 * shown at a fractional size or position is resampled, which blurs it.
 */
export interface SlotGeometry {
  readonly dpr: number;
  /** Slot width in device pixels; pages are drawn this wide. */
  readonly width: number;
  /** Left margin in CSS pixels that moves slots onto a device pixel (and centres narrow ones). */
  readonly offset: number;
}

/** Narrowest slot, in device pixels. */
export const MIN_SLOT_WIDTH = 100;

/** Slot geometry for `zoom`, given the pane and a page's size in PDF points. */
export function slotGeometry(pane: PaneMeasure, zoom: PdfZoom, page: Size): SlotGeometry {
  const { dpr } = pane;
  let width = pane.width;
  if (zoom === 'fit-page' && pane.height > 0) {
    width = Math.min(width, Math.floor((pane.height * dpr * page.width) / page.height));
  } else if (typeof zoom === 'number') {
    width = Math.round(page.width * zoom * CSS_PX_PER_PT * dpr);
  }
  width = Math.max(MIN_SLOT_WIDTH, width);
  // Narrower than the pane: centred, still on a whole device pixel.
  const start = pane.start + Math.max(0, Math.floor((pane.width - width) / 2));
  return { dpr, width, offset: Math.max(0, start - pane.left) / dpr };
}

/** Zoom factor (1 = 100 %) of slots `geometry` wide for pages `page` wide. */
export function geometryZoom(geometry: SlotGeometry, page: Size): number {
  return geometry.width / geometry.dpr / (page.width * CSS_PX_PER_PT);
}
