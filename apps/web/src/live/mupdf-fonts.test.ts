import { LIVE_PDF_FONT_KEY } from '@myleaf/api';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { restoreFonts } from './mupdf-fonts.js';

/** A one-page PDF with an embedded font, whole and with its font program left out. */
function pages() {
  const document = new mupdf.PDFDocument();
  const font = document.addFont(new mupdf.Font('Times-Roman'));
  const resources = document.addObject({ Font: { F1: font } });
  const page = document.addPage(
    [0, 0, 200, 100],
    0,
    resources,
    'BT /F1 36 Tf 10 40 Td <00240025> Tj ET',
  );
  document.insertPage(-1, page);
  const whole = document.saveToBuffer('').asUint8Array().slice();
  const stream = font.get('DescendantFonts').get(0).get('FontDescriptor').get('FontFile3');
  const data = stream.readRawStream().asUint8Array().slice();
  stream.writeRawStream(new Uint8Array(0));
  stream.put(LIVE_PDF_FONT_KEY, document.newString('font-1'));
  const stripped = document.saveToBuffer('').asUint8Array().slice();
  document.destroy();
  return { whole, stripped, data };
}

function draw(pdf: Uint8Array, fonts?: ReadonlyMap<string, Uint8Array>) {
  const document = new mupdf.PDFDocument(pdf);
  const missing = fonts === undefined ? [] : restoreFonts(document, fonts);
  const pixmap = document
    .loadPage(0)
    .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const pixels = Buffer.from(pixmap.getPixels());
  pixmap.destroy();
  document.destroy();
  return { pixels, missing };
}

describe('restoreFonts', () => {
  it('puts the font programs a page left out back', () => {
    const { whole, stripped, data } = pages();
    expect(stripped.length).toBeLessThan(whole.length - data.length / 2);
    const restored = draw(stripped, new Map([['font-1', data]]));
    expect(restored.missing).toEqual([]);
    expect(restored.pixels.equals(draw(whole).pixels)).toBe(true);
  });

  it('reports fonts it does not have', () => {
    const { stripped } = pages();
    expect(draw(stripped, new Map()).missing).toEqual(['font-1']);
  });
});
