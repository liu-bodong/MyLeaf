/**
 * MuPDF's SVG output stores each glyph's character in a `data-text`
 * attribute. Glyphs of math fonts map to control characters, which are not
 * allowed in XML, so browsers reject the whole document. The attribute is not
 * needed for display.
 */
export function sanitizeSvg(svg: string): string {
  // Strip the attribute whether it is single- or double-quoted.
  return svg.replace(/ data-text=(["'])[^"']*\1/g, '');
}
