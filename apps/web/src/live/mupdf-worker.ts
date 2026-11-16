/// <reference lib="webworker" />
// Draws live-preview pages (one-page PDFs) with MuPDF, off the main thread.
import * as mupdf from 'mupdf';

export interface RenderRequest {
  readonly id: number;
  readonly pdf: Uint8Array;
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
    }
  | { readonly id: number; readonly error: string };

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
  const { id, pdf, pixelWidth } = event.data;
  try {
    const document = new mupdf.PDFDocument(pdf);
    const page = document.loadPage(0);
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
    document.destroy();
    const response: RenderResponse = { id, bitmap, width: x1 - x0, height: y1 - y0, lines };
    self.postMessage(response, [bitmap]);
  } catch (error) {
    const response: RenderResponse = { id, error: String(error) };
    self.postMessage(response);
  }
};
