import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize-svg.js';

describe('sanitizeSvg', () => {
  it('strips double-quoted data-text attributes', () => {
    expect(sanitizeSvg('<g data-text="\u0001"><text>a</text></g>')).toBe('<g><text>a</text></g>');
  });

  it('strips single-quoted data-text attributes', () => {
    expect(sanitizeSvg("<g data-text='\u0001'><text>a</text></g>")).toBe('<g><text>a</text></g>');
  });

  it('leaves other attributes intact', () => {
    expect(sanitizeSvg('<g id="x" class="y" data-text="\u0001"/>')).toBe('<g id="x" class="y"/>');
  });
});
