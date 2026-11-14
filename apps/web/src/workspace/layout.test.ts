import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, SPLIT_MAX, parseLayout } from './layout.js';

describe('parseLayout', () => {
  it('reads a saved layout', () => {
    expect(parseLayout('{"view":"pdf","split":0.4,"zoom":1.25}')).toEqual({
      view: 'pdf',
      split: 0.4,
      zoom: 1.25,
    });
    expect(parseLayout('{"view":"editor","split":0.5,"zoom":"fit-page"}').zoom).toBe('fit-page');
  });

  it('falls back to defaults for missing or malformed data', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('[]')).toEqual({ ...DEFAULT_LAYOUT });
    expect(parseLayout('{"view":"sideways","split":"wide","zoom":99}')).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps the split', () => {
    expect(parseLayout('{"split":0.99}').split).toBe(SPLIT_MAX);
  });
});
