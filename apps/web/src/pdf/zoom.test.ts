import { describe, expect, it } from 'vitest';
import {
  CSS_PX_PER_PT,
  displayScale,
  mostVisiblePage,
  pageIndexAt,
  pageTops,
  stepZoom,
} from './zoom.js';

const A4 = { width: 595, height: 842 };

describe('displayScale', () => {
  it('uses the factor for a fixed zoom', () => {
    expect(displayScale(1.5, [A4], { width: 100, height: 100 }, 12)).toBe(1.5 * CSS_PX_PER_PT);
  });

  it('fits the widest page to the pane width', () => {
    const pages = [A4, { width: 842, height: 595 }];
    expect(displayScale('fit-width', pages, { width: 866, height: 400 }, 12)).toBe(1);
  });

  it('fits a whole page, limited by height or width', () => {
    expect(displayScale('fit-page', [A4], { width: 2000, height: 866 }, 12)).toBe(1);
    expect(displayScale('fit-page', [A4], { width: 619, height: 5000 }, 12)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('moves to the neighbouring step', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
  });

  it('snaps an in-between factor to the next step', () => {
    expect(stepZoom(1.23, 1)).toBe(1.25);
    expect(stepZoom(1.23, -1)).toBe(1.1);
  });

  it('stays at the limits', () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });
});

describe('page positions', () => {
  const heights = [100, 100, 100];
  const tops = pageTops(heights, 10);

  it('stacks pages with gaps', () => {
    expect(tops).toEqual([10, 120, 230]);
  });

  it('finds the page at an offset', () => {
    expect(pageIndexAt(tops, 0)).toBe(0);
    expect(pageIndexAt(tops, 119)).toBe(0);
    expect(pageIndexAt(tops, 120)).toBe(1);
    expect(pageIndexAt(tops, 1000)).toBe(2);
  });

  it('picks the page with the largest visible part', () => {
    expect(mostVisiblePage(tops, heights, 90, 190)).toBe(1);
    expect(mostVisiblePage(tops, heights, 20, 120)).toBe(0);
    // Several whole pages visible: the first one.
    expect(mostVisiblePage(tops, heights, 0, 400)).toBe(0);
  });
});
