import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, SIDEBAR_MAX, SIDEBAR_MIN, SPLIT_MAX, parseLayout } from './layout.js';

describe('parseLayout', () => {
  it('reads a saved layout', () => {
    expect(
      parseLayout(
        '{"view":"pdf","split":0.4,"sidebar":300,"zoom":1.25,"logs":true,"fileTree":false,"editorMode":"visual","cleanVisual":true}',
      ),
    ).toEqual({
      view: 'pdf',
      split: 0.4,
      sidebar: 300,
      zoom: 1.25,
      logs: true,
      fileTree: false,
      editorMode: 'visual',
      cleanVisual: true,
    });
    expect(parseLayout('{"view":"editor","split":0.5,"zoom":"fit-page"}').zoom).toBe('fit-page');
  });

  it('falls back to defaults for missing or malformed data', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('[]')).toEqual({ ...DEFAULT_LAYOUT });
    expect(
      parseLayout(
        '{"view":"sideways","split":"wide","zoom":99,"logs":"yes","editorMode":"wysiwyg"}',
      ),
    ).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps the split and the sidebar width', () => {
    expect(parseLayout('{"split":0.99}').split).toBe(SPLIT_MAX);
    expect(parseLayout('{"sidebar":9999}').sidebar).toBe(SIDEBAR_MAX);
    expect(parseLayout('{"sidebar":1}').sidebar).toBe(SIDEBAR_MIN);
  });
});
