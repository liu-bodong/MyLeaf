import { describe, expect, it } from 'vitest';
import { resolveGraphicsPath } from './image-paths.js';

describe('resolveGraphicsPath', () => {
  const files = new Set(['figs/plot.pdf', 'figs/plot.png', 'figs/photo.jpg', 'logo.png']);

  it('uses the path as given when it names a file', () => {
    expect(resolveGraphicsPath('figs/plot.png', files)).toBe('figs/plot.png');
    expect(resolveGraphicsPath('./logo.png', files)).toBe('logo.png');
  });

  it("tries pdfLaTeX's extensions in graphicx's order", () => {
    // pdfLaTeX would include the PDF, not the PNG.
    expect(resolveGraphicsPath('figs/plot', files)).toBe('figs/plot.pdf');
    expect(resolveGraphicsPath('figs/photo', files)).toBe('figs/photo.jpg');
  });

  it('returns null for missing files', () => {
    expect(resolveGraphicsPath('figs/missing', files)).toBeNull();
  });
});
