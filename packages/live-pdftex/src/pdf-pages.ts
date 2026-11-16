import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PDFObject } from 'mupdf';

type MuPdf = typeof import('mupdf');

let loading: Promise<MuPdf> | null = null;
/** MuPDF (WebAssembly), loaded on first use: servers without pdfTeX live preview never load it. */
const mupdf = (): Promise<MuPdf> => (loading ??= import('mupdf'));

/** A page of a PDF as a PDF of its own. */
export interface PdfPage {
  readonly pdf: Uint8Array;
  /**
   * Digest of what the page shows, the same for the same page of two runs
   * (whose PDFs differ in object numbers, font subsets and so on).
   */
  readonly hash: string;
}

/** Pages `first` to `last` (1-based, those that exist) of the PDF at `path`. */
export async function extractPages(
  path: string,
  first: number,
  last: number,
): Promise<Map<number, PdfPage>> {
  const { PDFDocument } = await mupdf();
  const source = new PDFDocument(await readFile(path));
  try {
    const pages = new Map<number, PdfPage>();
    for (let page = first; page <= Math.min(last, source.countPages()); page++) {
      const single = new PDFDocument();
      const loaded = source.loadPage(page - 1);
      try {
        single.graftPage(-1, source, page - 1);
        const saved = single.saveToBuffer('compress,garbage=compact');
        // Copied out of MuPDF's memory before the buffer is freed.
        const pdf = saved.asUint8Array().slice();
        saved.destroy();
        pages.set(page, { pdf, hash: pageHash(loaded.getObject()) });
      } finally {
        loaded.destroy();
        single.destroy();
      }
    }
    return pages;
  } finally {
    source.destroy();
  }
}

/**
 * Keys left out of the digest. Font programs (`FontFile*`), their glyph
 * lists (`CharSet`) and width ranges (`FirstChar`, `LastChar`, `Widths`)
 * depend on the characters all pages so far use, not on this page; within
 * a document a font name stands for one font. `Parent` leads to other pages.
 * Stream encodings are left out because streams are hashed decoded.
 */
const IGNORED = new Set([
  'Parent',
  'CharSet',
  'FirstChar',
  'LastChar',
  'Widths',
  'FontFile',
  'FontFile2',
  'FontFile3',
  'Length',
  'Filter',
  'DecodeParms',
]);

/**
 * Digest of a page object and everything it refers to (pdfTeX writes each
 * page's resources on the page itself). Subset tags (`ABCDEF+`) are removed
 * from font names, since they change with the subset.
 */
function pageHash(page: PDFObject): string {
  const hash = createHash('sha1');
  const seen = new Map<number, number>();
  const walk = (object: PDFObject): void => {
    if (object.isIndirect()) {
      const number = object.asIndirect();
      const index = seen.get(number);
      if (index !== undefined) {
        hash.update(`@${index}`);
        return;
      }
      seen.set(number, seen.size);
    }
    if (object.isStream()) {
      const data = object.readStream();
      hash.update(data.asUint8Array());
      data.destroy();
    }
    if (object.isDictionary()) {
      const keys: string[] = [];
      object.forEach((_value, key) => keys.push(String(key)));
      hash.update('<<');
      for (const key of keys.sort()) {
        if (IGNORED.has(key)) continue;
        const value = object.get(key);
        hash.update(`/${key} `);
        if ((key === 'BaseFont' || key === 'FontName') && value.isName()) {
          hash.update(value.asName().replace(/^[A-Z]{6}\+/, ''));
        } else {
          walk(value);
        }
      }
      hash.update('>>');
    } else if (object.isArray()) {
      hash.update('[');
      for (let index = 0; index < object.length; index++) walk(object.get(index));
      hash.update(']');
    } else if (!object.isStream()) {
      hash.update(`${object.toString()} `);
    }
  };
  walk(page);
  return hash.digest('base64');
}
