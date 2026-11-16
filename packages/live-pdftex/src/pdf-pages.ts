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

/**
 * Pages `first` to `last` (1-based, those that exist) of the PDF at `path`.
 * MuPDF's warnings and errors go to `log`.
 */
export async function extractPages(
  path: string,
  first: number,
  last: number,
  log: (message: string) => void = () => {},
): Promise<Map<number, PdfPage>> {
  const { PDFDocument, setLog } = await mupdf();
  const data = await readFile(path);
  // Global in MuPDF; what follows runs without yielding to another call.
  setLog(log);
  const source = new PDFDocument(data);
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

const isEmpty = (dictionary: PDFObject): boolean => {
  let empty = true;
  dictionary.forEach(() => (empty = false));
  return empty;
};

/** Null (or a reference to a missing object), or an empty dictionary. */
const absent = (value: PDFObject): boolean => {
  const resolved = value.resolve();
  return (
    resolved.isNull() || (resolved.isDictionary() && !resolved.isStream() && isEmpty(resolved))
  );
};

/** The streams of a content: one stream, or an array of them (a page's `Contents`). */
const streams = (content: PDFObject): PDFObject[] => {
  if (content.isStream()) return [content];
  if (!content.isArray()) return [];
  const all: PDFObject[] = [];
  for (let index = 0; index < content.length; index++) all.push(...streams(content.get(index)));
  return all;
};

/**
 * The names (`/Name` tokens) in the content of `owner`: a page's `Contents`,
 * or a form's or pattern's own stream. `null` when it has neither, then all
 * of its resources count.
 */
function usedNames(owner: PDFObject): Set<string> | null {
  const content = owner.isStream() ? [owner] : streams(owner.get('Contents'));
  if (content.length === 0) return null;
  const names = new Set<string>();
  for (const stream of content) {
    const data = stream.readStream();
    const text = new TextDecoder('latin1').decode(data.asUint8Array());
    data.destroy();
    for (const [, name] of text.matchAll(/\/([^\s/[\]<>(){}%]+)/g)) {
      names.add(
        name!.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        ),
      );
    }
  }
  return names;
}

/**
 * Digest of a page object and everything it refers to (pdfTeX writes each
 * page's resources on the page itself). Subset tags (`ABCDEF+`) are removed
 * from font names, since they change with the subset. Of resources, only
 * those the content names count, and entries that are null or an empty
 * dictionary are left out: a page that a finisher wrote refers to objects
 * written at the end of the document (PGF's color spaces and graphics
 * states, for one), which are missing there and filled in the run's PDF.
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
        if (absent(value)) continue;
        hash.update(`/${key} `);
        if ((key === 'BaseFont' || key === 'FontName') && value.isName()) {
          hash.update(value.asName().replace(/^[A-Z]{6}\+/, ''));
        } else if (key === 'Resources' && value.isDictionary()) {
          walkResources(value, usedNames(object));
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
  /** Resources: each category (`Font`, `XObject`, ...) holds only the names in `used`. */
  const walkResources = (resources: PDFObject, used: Set<string> | null): void => {
    const keys: string[] = [];
    resources.forEach((_value, key) => keys.push(String(key)));
    hash.update('<<');
    for (const key of keys.sort()) {
      const value = resources.get(key);
      if (value.resolve().isNull()) continue;
      if (value.isDictionary()) {
        const names: string[] = [];
        value.forEach((entry, name) => {
          if ((used === null || used.has(String(name))) && !absent(entry)) names.push(String(name));
        });
        if (names.length === 0) continue;
        hash.update(`/${key} <<`);
        for (const name of names.sort()) {
          hash.update(`/${name} `);
          walk(value.get(name));
        }
        hash.update('>>');
      } else {
        hash.update(`/${key} `);
        walk(value);
      }
    }
    hash.update('>>');
  };
  walk(page);
  return hash.digest('base64');
}
