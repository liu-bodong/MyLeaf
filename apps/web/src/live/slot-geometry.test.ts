import { describe, expect, it } from 'vitest';
import { geometryZoom, slotGeometry } from './slot-geometry.js';

const LETTER = { width: 612, height: 792 };
/** A pane 600 CSS px wide and 700 high at 2 device pixels per CSS pixel, starting at 10.25 CSS px. */
const PANE = { dpr: 2, left: 20.5, start: 21, width: 1200, height: 700 };

describe('slotGeometry', () => {
  it('fills the pane width at fit-width', () => {
    const geometry = slotGeometry(PANE, 'fit-width', LETTER);
    expect(geometry).toEqual({ dpr: 2, width: 1200, offset: 0.25 });
  });

  it('fits the whole page at fit-page, centred on a whole device pixel', () => {
    const geometry = slotGeometry(PANE, 'fit-page', LETTER);
    // 700 CSS px high: 1400 device px, so 1400 * 612 / 792 wide.
    expect(geometry.width).toBe(1081);
    expect(geometry.offset).toBe((21 + Math.floor((1200 - 1081) / 2) - 20.5) / 2);
    expect(Number.isInteger(geometry.offset * 2 + 20.5)).toBe(true);
  });

  it('draws at the zoom factor, wider than the pane when zoomed in', () => {
    const geometry = slotGeometry(PANE, 2, LETTER);
    // 612 pt at 200 % is 1632 CSS px, 3264 device px.
    expect(geometry.width).toBe(3264);
    expect(geometry.offset).toBe(0.25);
    expect(geometryZoom(geometry, LETTER)).toBeCloseTo(2);
  });

  it('keeps a minimum width', () => {
    expect(slotGeometry(PANE, 0.01, LETTER).width).toBe(100);
  });
});
