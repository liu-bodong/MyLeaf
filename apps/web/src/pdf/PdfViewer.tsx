import type { PdfPoint, PdfRect } from '@myleaf/compile';
import {
  GlobalWorkerOptions,
  PDFWorker,
  RenderingCancelledException,
  getDocument,
} from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = workerUrl;

let sharedWorker: PDFWorker | null = null;

/**
 * One PDF.js worker for all documents. Without it, every recompile starts a
 * new worker, which costs about 0.3 s before the PDF is even fetched.
 */
function pdfWorker(): PDFWorker {
  if (sharedWorker === null || sharedWorker.destroyed) {
    sharedWorker = PDFWorker.create({ name: 'myleaf-pdf' });
  }
  return sharedWorker;
}

interface PdfViewerProps {
  /** PDF to show; a new URL loads a new version, keeping the scroll position. */
  readonly url: string | null;
  /** Boxes to highlight, e.g. from forward search. The first is scrolled into view. */
  readonly highlights: readonly PdfRect[];
  /** Double-click on a page. Coordinates are PDF points from the page's top-left. */
  readonly onInverseSearch: (point: PdfPoint) => void;
}

interface LoadedDocument {
  readonly pdf: PDFDocumentProxy;
  /** CSS pixels per PDF point, fitting the widest page to the viewer. */
  readonly scale: number;
  /** Page sizes in PDF points. */
  readonly pages: readonly { readonly width: number; readonly height: number }[];
}

const PAGE_GAP = 12;
/** Pages within this distance of the visible area are rendered ahead of scrolling. */
const RENDER_MARGIN = '100% 0px';

/**
 * PDF.js-based viewer. Only pages near the visible area are rendered, and a
 * page keeps showing its previous version until the new one is drawn, so
 * recompiling neither flashes nor waits for off-screen pages. PDF.js is
 * confined to this module.
 */
export function PdfViewer({ url, highlights, onInverseSearch }: PdfViewerProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url === null || scroller === null) return;
    let cancelled = false;
    // Once displayed, a document is released by the effect below instead.
    let adopted = false;
    const task = getDocument({ url, worker: pdfWorker() });
    task.promise
      .then(async (pdf) => {
        const viewports = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, index) =>
            (await pdf.getPage(index + 1)).getViewport({ scale: 1 }),
          ),
        );
        const widest = Math.max(...viewports.map((viewport) => viewport.width));
        if (cancelled) return;
        setDocument({
          pdf,
          scale: (scroller.clientWidth - 2 * PAGE_GAP) / widest,
          pages: viewports.map(({ width, height }) => ({ width, height })),
        });
        adopted = true;
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      if (!adopted) void task.destroy();
    };
  }, [url, scroller]);

  // Release a displayed document once it has been replaced.
  useEffect(() => () => void document?.pdf.loadingTask.destroy(), [document]);

  useEffect(() => {
    const target = highlights[0];
    const pageElement = scroller?.querySelector<HTMLElement>(`[data-page="${target?.page}"]`);
    if (target && scroller && pageElement && document) {
      scroller.scrollTo({
        top: pageElement.offsetTop + target.y * document.scale - scroller.clientHeight / 3,
        behavior: 'smooth',
      });
    }
  }, [highlights, document, scroller]);

  if (url === null) {
    return <div className="pdf-empty">Compile to see the PDF.</div>;
  }

  return (
    <div className="pdf-viewer" ref={setScroller} data-testid="pdf-viewer">
      {error !== null && <div className="pdf-error">Could not display the PDF: {error}</div>}
      {document?.pages.map((size, index) => (
        <PdfPage
          key={index}
          document={document}
          pageNumber={index + 1}
          width={size.width * document.scale}
          height={size.height * document.scale}
          scroller={scroller}
          highlights={highlights.filter((rect) => rect.page === index + 1)}
          onInverseSearch={onInverseSearch}
        />
      ))}
    </div>
  );
}

interface PdfPageProps {
  readonly document: LoadedDocument;
  readonly pageNumber: number;
  /** Display size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly scroller: HTMLDivElement | null;
  readonly highlights: readonly PdfRect[];
  readonly onInverseSearch: (point: PdfPoint) => void;
}

function PdfPage(props: PdfPageProps) {
  const { document, pageNumber, width, height, scroller, highlights, onInverseSearch } = props;
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = pageRef.current;
    if (element === null || scroller === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { root: scroller, rootMargin: RENDER_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      const page = await document.pdf.getPage(pageNumber);
      if (cancelled) return;
      const pixelRatio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: document.scale * pixelRatio });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise;
      // Swap only when complete, so the previous version stays visible meanwhile.
      if (!cancelled) canvasHostRef.current?.replaceChildren(canvas);
    })().catch((reason: unknown) => {
      if (!(reason instanceof RenderingCancelledException) && !cancelled) {
        console.error(`Could not render page ${pageNumber}`, reason);
      }
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, pageNumber, visible]);

  return (
    <div
      ref={pageRef}
      className="pdf-page"
      data-page={pageNumber}
      style={{ width, height, marginBottom: PAGE_GAP }}
      onDoubleClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        onInverseSearch({
          page: pageNumber,
          x: (event.clientX - box.left) / document.scale,
          y: (event.clientY - box.top) / document.scale,
        });
      }}
    >
      <div className="pdf-canvas" ref={canvasHostRef} />
      {highlights.map((rect, index) => (
        <div
          key={index}
          className="pdf-highlight"
          style={{
            left: rect.x * document.scale,
            top: rect.y * document.scale,
            width: rect.width * document.scale,
            height: rect.height * document.scale,
          }}
        />
      ))}
    </div>
  );
}
