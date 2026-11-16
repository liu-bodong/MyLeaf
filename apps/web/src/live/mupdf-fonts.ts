// Puts back the font programs a live page's PDF left out (LivePdfPageMessage.fonts).
import { LIVE_PDF_FONT_KEY } from '@myleaf/api';
import type * as mupdf from 'mupdf';

/**
 * Writes each font stream of `document` that names a font left out
 * (`/MyLeafFont (id)`) with that font's data from `fonts`. Returns the ids
 * of fonts it did not have: MuPDF draws their text with a substitute font.
 */
export function restoreFonts(
  document: mupdf.PDFDocument,
  fonts: ReadonlyMap<string, Uint8Array>,
): string[] {
  const missing: string[] = [];
  for (let number = 1; number < document.countObjects(); number++) {
    // Not resolved: only the reference knows that it is a stream.
    const object = document.newIndirect(number);
    if (!object.isStream()) continue;
    const name = object.get(LIVE_PDF_FONT_KEY);
    if (!name.isString()) continue;
    const id = name.asString();
    const data = fonts.get(id);
    if (data === undefined) {
      missing.push(id);
      continue;
    }
    object.writeRawStream(data);
    object.delete(LIVE_PDF_FONT_KEY);
  }
  return missing;
}
