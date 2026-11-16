import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { LIVE_FONT_KEY } from '@myleaf/live-preview';
import type { LivePdfFont } from '@myleaf/live-preview';
import type { PDFDocument, PDFObject } from 'mupdf';

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
  /** Font programs left out of `pdf` (see `LivePdfFont`); none unless `separateFonts`. */
  readonly fonts: readonly LivePdfFont[];
}

/** Options of `extractPages`. */
export interface ExtractOptions {
  /** Leave each page's embedded font programs out of its PDF and return them beside it. */
  readonly separateFonts?: boolean;
  /**
   * Called with each page's digest before the page is cut out: when it
   * returns true, the page is left out of the result (its image is known).
   */
  readonly skip?: (page: number, hash: string) => boolean;
}

/**
 * Pages `first` to `last` (1-based, those that exist) of the PDF at `path`.
 * MuPDF's warnings and errors go to `log`.
 */
export function extractPages(
  path: string,
  first: number,
  last: number,
  log: (message: string) => void = () => {},
  options: ExtractOptions = {},
): Promise<Map<number, PdfPage>> {
  const pages: number[] = [];
  for (let page = Math.max(1, first); page <= last; page++) pages.push(page);
  return extractPageList(path, pages, log, options);
}

/** `pages` (1-based, those that exist) of the PDF at `path`, as `extractPages`. */
export async function extractPageList(
  path: string,
  pages: readonly number[],
  log: (message: string) => void = () => {},
  { separateFonts = false, skip }: ExtractOptions = {},
): Promise<Map<number, PdfPage>> {
  const { PDFDocument, setLog } = await mupdf();
  const data = await readFile(path);
  // Global in MuPDF; what follows runs without yielding to another call.
  setLog(log);
  const source = new PDFDocument(data);
  try {
    const result = new Map<number, PdfPage>();
    const count = source.countPages();
    for (const page of pages) {
      if (page < 1 || page > count) continue;
      const loaded = source.loadPage(page - 1);
      try {
        const hash = pageHash(loaded.getObject());
        if (skip?.(page, hash)) continue;
        const single = new PDFDocument();
        try {
          single.graftPage(-1, source, page - 1);
          const fonts = separateFonts ? takeFonts(single) : [];
          const saved = single.saveToBuffer('compress,garbage=compact');
          // Copied out of MuPDF's memory before the buffer is freed.
          const pdf = saved.asUint8Array().slice();
          saved.destroy();
          result.set(page, { pdf, hash, fonts });
        } finally {
          single.destroy();
        }
      } finally {
        loaded.destroy();
      }
    }
    return result;
  } finally {
    source.destroy();
  }
}

/** Keys of a font descriptor that hold a font program. */
const FONT_FILES = ['FontFile', 'FontFile2', 'FontFile3'];

/**
 * Takes the font programs out of `document`: each stream a font descriptor
 * holds keeps its dictionary, no data, and `/MyLeafFont (id)`.
 */
function takeFonts(document: PDFDocument): LivePdfFont[] {
  const fonts = new Map<string, LivePdfFont>();
  for (let number = 1; number < document.countObjects(); number++) {
    const descriptor = document.newIndirect(number).resolve();
    if (!descriptor.isDictionary() || descriptor.get('Type').toString() !== '/FontDescriptor') {
      continue;
    }
    for (const key of FONT_FILES) {
      const stream = descriptor.get(key);
      if (!stream.isStream() || !stream.get(LIVE_FONT_KEY).isNull()) continue;
      const raw = stream.readRawStream();
      const data = raw.asUint8Array().slice();
      raw.destroy();
      if (data.length === 0) continue;
      // The dictionary says how to read the data (Filter, Length1, Subtype, ...).
      const hash = createHash('sha256');
      const entries: string[] = [];
      stream.forEach((value, name) => {
        if (String(name) !== 'Length') entries.push(`/${String(name)} ${value.toString()}`);
      });
      hash.update(entries.sort().join(' '));
      hash.update('\n');
      hash.update(data);
      const id = hash.digest('base64url').slice(0, 22);
      stream.writeRawStream(new Uint8Array(0));
      stream.put(LIVE_FONT_KEY, document.newString(id));
      fonts.set(id, { id, data });
    }
  }
  return [...fonts.values()];
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
