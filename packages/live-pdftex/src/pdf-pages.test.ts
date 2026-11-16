import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_FONT_KEY } from '@myleaf/live-preview';
import * as mupdf from 'mupdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractPages } from './pdf-pages.js';

/** Pixels of page 1 of `pdf`, after `prepare`. */
function draw(pdf: Uint8Array, prepare: (document: mupdf.PDFDocument) => void = () => {}) {
  const document = new mupdf.PDFDocument(pdf);
  prepare(document);
  const pixmap = document
    .loadPage(0)
    .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const pixels = pixmap.getPixels().slice();
  pixmap.destroy();
  document.destroy();
  return pixels;
}

describe('extractPages', () => {
  let dir: string;
  let path: string;

  beforeAll(async () => {
    // Three pages that use one embedded font (MuPDF embeds the font program).
    const document = new mupdf.PDFDocument();
    const font = document.addFont(new mupdf.Font('Times-Roman'));
    const resources = document.addObject({ Font: { F1: font } });
    for (const glyphs of ['00240025', '00260027', '0028']) {
      const page = document.addPage(
        [0, 0, 200, 100],
        0,
        resources,
        `BT /F1 36 Tf 10 40 Td <${glyphs}> Tj ET`,
      );
      document.insertPage(-1, page);
    }
    dir = await mkdtemp(join(tmpdir(), 'myleaf-pdf-pages-'));
    path = join(dir, 'doc.pdf');
    await writeFile(path, document.saveToBuffer('compress').asUint8Array());
    document.destroy();
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('keeps fonts in the pages by default', async () => {
    const pages = await extractPages(path, 1, 3);
    expect([...pages.keys()]).toEqual([1, 2, 3]);
    for (const page of pages.values()) expect(page.fonts).toEqual([]);
  });

  it('separates fonts: one font program, shared by every page, left out of each', async () => {
    const whole = await extractPages(path, 1, 3);
    const split = await extractPages(path, 1, 3, () => {}, { separateFonts: true });
    const ids = new Set<string>();
    for (const [number, page] of split) {
      const complete = whole.get(number)!;
      expect(page.hash).toBe(complete.hash);
      expect(page.fonts).toHaveLength(1);
      ids.add(page.fonts[0]!.id);
      // The font program is most of a page.
      expect(page.fonts[0]!.data.length).toBeGreaterThan(10_000);
      expect(page.pdf.length).toBeLessThan(complete.pdf.length - page.fonts[0]!.data.length / 2);
    }
    expect(ids.size).toBe(1);
  });

  it('draws the same page once the font data is put back', async () => {
    const whole = (await extractPages(path, 2, 2)).get(2)!;
    const split = (await extractPages(path, 2, 2, () => {}, { separateFonts: true })).get(2)!;
    const [font] = split.fonts;
    const restored = draw(split.pdf, (document) => {
      let found = 0;
      for (let number = 1; number < document.countObjects(); number++) {
        // Indirect: a resolved object does not know it is a stream.
        const object = document.newIndirect(number);
        if (!object.isStream() || !object.get(LIVE_FONT_KEY).isString()) continue;
        expect(object.get(LIVE_FONT_KEY).asString()).toBe(font!.id);
        expect(object.readRawStream().asUint8Array()).toHaveLength(0);
        object.writeRawStream(font!.data);
        found++;
      }
      expect(found).toBe(1);
    });
    expect(Buffer.from(restored).equals(Buffer.from(draw(whole.pdf)))).toBe(true);
    // Without its font, the page draws differently (MuPDF substitutes one).
    expect(Buffer.from(draw(split.pdf)).equals(Buffer.from(restored))).toBe(false);
  });
});
