/// <reference lib="webworker" />
// Draws live-preview pages (one-page PDFs) with MuPDF, off the main thread.
import * as mupdf from 'mupdf';

export interface RenderRequest {
  readonly id: number;
  /**
   * The document; omitted when `key` names the document the worker kept from
   * an earlier request.
   */
  readonly pdf?: Uint8Array;
  /** Keeps the document open under this key for later requests (one at a time). */
  readonly key?: string;
  /** 0-based page to draw; default the first. */
  readonly page?: number;
  /** Width to draw the page at, in device pixels. */
  readonly pixelWidth: number;
}

/** A line of text, in PDF points from the page's top left. */
export interface TextLine {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type RenderResponse =
  | {
      readonly id: number;
      readonly bitmap: ImageBitmap;
      /** Page size in PDF points. */
      readonly width: number;
      readonly height: number;
      readonly lines: readonly TextLine[];
      /** Pages in the document. */
      readonly pages: number;
    }
  | { readonly id: number; readonly error: string };

/** Sent once the worker takes requests. */
export interface WorkerReady {
  readonly ready: true;
}

/** The document kept open for requests that name its key. */
let kept: { readonly key: string; readonly document: mupdf.PDFDocument } | null = null;

function openDocument({ pdf, key }: RenderRequest): mupdf.PDFDocument {
  if (key !== undefined && kept?.key === key) return kept.document;
  if (pdf === undefined) throw new Error(`No document for ${key ?? 'the request'}`);
  const document = new mupdf.PDFDocument(pdf);
  if (key !== undefined) {
    kept?.document.destroy();
    kept = { key, document };
  }
  return document;
}

/** The page's lines of text with their extent, from MuPDF's character quads. */
function textLines(page: mupdf.PDFPage): TextLine[] {
  const lines: TextLine[] = [];
  let text = '';
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const structured = page.toStructuredText('preserve-whitespace');
  structured.walk({
    beginLine() {
      text = '';
      left = top = Infinity;
      right = bottom = -Infinity;
    },
    onChar(char, _origin, _font, _size, quad) {
      text += char;
      left = Math.min(left, quad[0], quad[4]);
      right = Math.max(right, quad[2], quad[6]);
      top = Math.min(top, quad[1], quad[3]);
      bottom = Math.max(bottom, quad[5], quad[7]);
    },
    endLine() {
      if (text.trim() !== '' && right > left && bottom > top) {
        lines.push({ text, left, top, width: right - left, height: bottom - top });
      }
    },
  });
  structured.destroy();
  return lines;
}

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { id, key, pixelWidth } = event.data;
  try {
    const document = openDocument(event.data);
    const pages = document.countPages();
    const page = document.loadPage(Math.min(event.data.page ?? 0, pages - 1));
    const [x0, y0, x1, y1] = page.getBounds();
    const scale = pixelWidth / (x1 - x0);
    const width = Math.max(1, Math.round((x1 - x0) * scale));
    const height = Math.max(1, Math.round((y1 - y0) * scale));
    // Drawn on opaque white, so the pixels need no alpha handling.
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], true);
    pixmap.clear(255);
    const device = new mupdf.DrawDevice([scale, 0, 0, scale, -x0 * scale, -y0 * scale], pixmap);
    page.run(device, mupdf.Matrix.identity);
    device.close();
    const pixels = new Uint8ClampedArray(pixmap.getPixels());
    const bitmap = await createImageBitmap(new ImageData(pixels, width, height));
    const lines = textLines(page).map((line) => ({
      ...line,
      left: line.left - x0,
      top: line.top - y0,
    }));
    device.destroy();
    pixmap.destroy();
    page.destroy();
    if (key === undefined) document.destroy();
    const response: RenderResponse = {
      id,
      bitmap,
      width: x1 - x0,
      height: y1 - y0,
      lines,
      pages,
    };
    self.postMessage(response, [bitmap]);
  } catch (error) {
    const response: RenderResponse = { id, error: String(error) };
    self.postMessage(response);
  }
};

const ready: WorkerReady = { ready: true };
self.postMessage(ready);
