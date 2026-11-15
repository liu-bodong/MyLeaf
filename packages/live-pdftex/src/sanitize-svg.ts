/**
 * Prepares MuPDF's SVG output for the browser and for change detection.
 *
 * - MuPDF stores each glyph's character in a `data-text` attribute. Glyphs of
 *   math fonts map to control characters, which are not allowed in XML, so
 *   browsers reject the whole document. The attribute is not needed for
 *   display.
 * - Glyph outlines get ids from their index in pdfTeX's font subset, which
 *   changes when other pages use more glyphs. Renumbering them in order of
 *   use makes an unchanged page give the same SVG.
 */
export function sanitizeSvg(svg: string): string {
  // Strip the attribute whether it is single- or double-quoted.
  const cleaned = svg.replace(/ data-text=(["'])[^"']*\1/g, '');
  const ids = new Map<string, string>();
  for (const [, id] of cleaned.matchAll(/href="#(font_\d+_\d+)"/g)) {
    if (id !== undefined && !ids.has(id)) ids.set(id, `glyph${ids.size}`);
  }
  return cleaned.replace(/font_\d+_\d+/g, (id) => {
    let renamed = ids.get(id);
    if (renamed === undefined) {
      renamed = `glyph${ids.size}`;
      ids.set(id, renamed);
    }
    return renamed;
  });
}
