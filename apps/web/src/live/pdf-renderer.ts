import type { RenderRequest, RenderResponse, TextLine, WorkerReady } from './mupdf-worker.js';

export type { TextLine };

export interface RenderedPage {
  readonly bitmap: ImageBitmap;
  /** Page size in PDF points. */
  readonly width: number;
  readonly height: number;
  readonly lines: readonly TextLine[];
  /** Pages in the document. */
  readonly pages: number;
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
  /**
   * Requests wait until the worker says it is ready: MuPDF loads with a
   * top-level await, and a message sent before that finishes can be lost.
   */
  #queue: RenderRequest[] | null = [];
  /** Key of the document the worker keeps open. */
  #kept: string | null = null;

  constructor() {
    this.#worker.onmessage = (event: MessageEvent<RenderResponse | WorkerReady>) => {
      const response = event.data;
      if ('ready' in response) {
        for (const request of this.#queue ?? []) this.#worker.postMessage(request);
        this.#queue = null;
        return;
      }
      const waiting = this.#waiting.get(response.id);
      if (waiting === undefined) return;
      this.#waiting.delete(response.id);
      if ('error' in response) waiting.reject(new Error(response.error));
      else waiting.resolve(response);
    };
  }

  /** Draws `pdf`'s first page `pixelWidth` device pixels wide. */
  render(pdf: Uint8Array, pixelWidth: number): Promise<RenderedPage> {
    return this.#request({ id: this.#nextId++, pdf, pixelWidth });
  }

  /**
   * Draws page `page` (1-based) of a whole document, which the worker keeps
   * open under `key` so later pages do not send or parse it again.
   */
  renderPage(
    document: { readonly key: string; readonly pdf: Uint8Array },
    page: number,
    pixelWidth: number,
  ): Promise<RenderedPage> {
    const sent = this.#kept === document.key;
    this.#kept = document.key;
    return this.#request({
      id: this.#nextId++,
      key: document.key,
      ...(sent ? {} : { pdf: document.pdf }),
      page: page - 1,
      pixelWidth,
    });
  }

  #request(request: RenderRequest): Promise<RenderedPage> {
    return new Promise((resolve, reject) => {
      this.#waiting.set(request.id, { resolve, reject });
      if (this.#queue === null) this.#worker.postMessage(request);
      else this.#queue.push(request);
    });
  }

  close(): void {
    this.#worker.terminate();
    for (const waiting of this.#waiting.values()) waiting.reject(new Error('Renderer closed'));
    this.#waiting.clear();
  }
}
