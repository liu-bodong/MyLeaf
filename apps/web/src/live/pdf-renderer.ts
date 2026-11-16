import type { RenderRequest, RenderResponse, TextLine } from './mupdf-worker.js';

export type { TextLine };

export interface RenderedPage {
  readonly bitmap: ImageBitmap;
  /** Page size in PDF points. */
  readonly width: number;
  readonly height: number;
  readonly lines: readonly TextLine[];
}

/** Draws one-page PDFs with MuPDF in a Web Worker, one at a time, in order. */
export class PdfRenderer {
  readonly #worker = new Worker(new URL('./mupdf-worker.ts', import.meta.url), {
    type: 'module',
  });
  readonly #waiting = new Map<
    number,
    { resolve: (page: RenderedPage) => void; reject: (error: Error) => void }
  >();
  #nextId = 0;

  constructor() {
    this.#worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const response = event.data;
      const waiting = this.#waiting.get(response.id);
      if (waiting === undefined) return;
      this.#waiting.delete(response.id);
      if ('error' in response) waiting.reject(new Error(response.error));
      else waiting.resolve(response);
    };
  }

  /** Draws `pdf`'s page `pixelWidth` device pixels wide. */
  render(pdf: Uint8Array, pixelWidth: number): Promise<RenderedPage> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      const request: RenderRequest = { id, pdf, pixelWidth };
      this.#worker.postMessage(request);
    });
  }

  close(): void {
    this.#worker.terminate();
    for (const waiting of this.#waiting.values()) waiting.reject(new Error('Renderer closed'));
    this.#waiting.clear();
  }
}
