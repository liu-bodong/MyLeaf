import { describe, expect, it } from 'vitest';
import { macrosKey, renderMath } from './render-math.js';

describe('renderMath', () => {
  it('typesets inline and display math', () => {
    const inline = renderMath('x^2', false, {});
    expect(inline).toMatchObject({ ok: true });
    expect(inline.ok && inline.html).toContain('katex');
    const display = renderMath('\\begin{align}a &= b\\\\ c &= d\\end{align}', true, {});
    expect(display.ok && display.html).toContain('katex-display');
  });

  it('expands project macros, including ones with arguments', () => {
    // Names KaTeX does not define itself (it has \\R and \\vec).
    const macros = { '\\reals': '\\mathbb{R}', '\\myvec': '\\mathbf{#1}' };
    expect(renderMath('\\myvec{v} \\in \\reals', false, macros)).toMatchObject({ ok: true });
    expect(renderMath('\\myvec{v} \\in \\reals', false, {})).toMatchObject({ ok: false });
  });

  it('reports errors instead of throwing', () => {
    const result = renderMath('\\frac{1}{', false, {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/KaTeX parse error/);
  });

  it('does not let \\gdef in one formula leak into another', () => {
    expect(renderMath('\\gdef\\leak{1}\\leak', false, {})).toMatchObject({ ok: true });
    expect(renderMath('\\leak', false, {})).toMatchObject({ ok: false });
  });

  it('keys macros independently of their order', () => {
    expect(macrosKey({ '\\a': '1', '\\b': '2' })).toBe(macrosKey({ '\\b': '2', '\\a': '1' }));
  });
});
