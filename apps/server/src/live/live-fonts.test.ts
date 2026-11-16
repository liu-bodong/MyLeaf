import { describe, expect, it } from 'vitest';
import { LiveFonts } from './live-fonts.js';

const font = (id: string, size: number) => ({ id, data: new Uint8Array(size) });

describe('LiveFonts', () => {
  it('sends each font once', () => {
    const fonts = new LiveFonts();
    const a = font('a', 10);
    const b = font('b', 20);
    expect(fonts.send([a, b])).toEqual([
      { type: 'font', id: 'a', data: a.data },
      { type: 'font', id: 'b', data: b.data },
    ]);
    expect(fonts.send([b, a])).toEqual([]);
    const c = font('c', 5);
    expect(fonts.send([a, c])).toEqual([{ type: 'font', id: 'c', data: c.data }]);
  });

  it('starts over with a fonts-reset when the budget is spent', () => {
    const fonts = new LiveFonts(100);
    const a = font('a', 60);
    const b = font('b', 30);
    expect(fonts.send([a, b])).toHaveLength(2);
    // 90 + 20 > 100: the browser forgets a and b; the page's fonts are sent again.
    const c = font('c', 20);
    expect(fonts.send([b, c])).toEqual([
      { type: 'fonts-reset' },
      { type: 'font', id: 'b', data: b.data },
      { type: 'font', id: 'c', data: c.data },
    ]);
    expect(fonts.send([c])).toEqual([]);
    const d = font('d', 40);
    expect(fonts.send([d])).toEqual([{ type: 'font', id: 'd', data: d.data }]);
    expect(fonts.send([a])).toEqual([
      { type: 'fonts-reset' },
      { type: 'font', id: 'a', data: a.data },
    ]);
  });

  it('sends a font larger than the budget anyway', () => {
    const fonts = new LiveFonts(10);
    expect(fonts.send([font('big', 50)])).toHaveLength(1);
  });
});
