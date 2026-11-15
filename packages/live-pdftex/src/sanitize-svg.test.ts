import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize-svg.js';

describe('sanitizeSvg', () => {
  it('removes data-text attributes, including invalid control characters', () => {
    const svg = '<use data-text="&#x0019;" href="#g1"/><use data-text=\'p\' href="#g2"/>';
    expect(sanitizeSvg(svg)).toBe('<use href="#g1"/><use href="#g2"/>');
  });

  it('numbers glyph ids in order of use, so subset changes do not change the page', () => {
    const page = (a: string, b: string) =>
      `<defs><path id="${b}" d="B"/><path id="${a}" d="A"/></defs>` +
      `<use xlink:href="#${a}"/><use xlink:href="#${b}"/><use xlink:href="#${a}"/>`;
    expect(sanitizeSvg(page('font_1_7', 'font_1_3'))).toBe(
      sanitizeSvg(page('font_1_2', 'font_1_9')),
    );
    expect(sanitizeSvg(page('font_1_7', 'font_1_3'))).toBe(
      '<defs><path id="glyph1" d="B"/><path id="glyph0" d="A"/></defs>' +
        '<use xlink:href="#glyph0"/><use xlink:href="#glyph1"/><use xlink:href="#glyph0"/>',
    );
  });
});
