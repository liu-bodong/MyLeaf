import type { PdfPoint, PdfRect } from '@myleaf/compile';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  /** PDF to show; a new URL reloads the document, keeping the scroll position. */
  readonly url: string | null;
  /** Boxes to highlight, e.g. from forward search. The first is scrolled into view. */
  readonly highlights: readonly PdfRect[];
  /** Double-click on a page. Coordinates are PDF points from the page's top-left. */
  readonly onInverseSearch: (point: PdfPoint) => void;
}

interface RenderedPage {
  readonly page: number;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

const PAGE_GAP = 12;

/** PDF.js-based viewer. PDF.js is confined to this module. */
export function PdfViewer({ url, highlights, onInverseSearch }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<readonly RenderedPage[]>([]);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url === null) {
      return;
    }
    let cancelled = false;
    const task = getDocument({ url });
    void (async () => {
      try {
        const pdf = await task.promise;
        const container = scrollRef.current!;
        const first = await pdf.getPage(1);
        const fitScale =
          (container.clientWidth - 2 * PAGE_GAP) / first.getViewport({ scale: 1 }).width;
        const pixelRatio = window.devicePixelRatio || 1;
        const rendered: RenderedPage[] = [];
        for (let number = 1; number <= pdf.numPages && !cancelled; number++) {
          const page = await pdf.getPage(number);
          const viewport = page.getViewport({ scale: fitScale * pixelRatio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${viewport.width / pixelRatio}px`;
          canvas.style.height = `${viewport.height / pixelRatio}px`;
          await page.render({ canvas, viewport }).promise;
          rendered.push({
            page: number,
            canvas,
            width: viewport.width / pixelRatio,
            height: viewport.height / pixelRatio,
          });
        }
        if (!cancelled) {
          setScale(fitScale);
          setPages(rendered);
          setError(null);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    const target = highlights[0];
    const container = scrollRef.current;
    const pageElement = container?.querySelector<HTMLElement>(`[data-page="${target?.page}"]`);
    if (target && container && pageElement) {
      container.scrollTo({
        top: pageElement.offsetTop + target.y * scale - container.clientHeight / 3,
        behavior: 'smooth',
      });
    }
  }, [highlights, scale]);

  if (url === null) {
    return <div className="pdf-empty">Compile to see the PDF.</div>;
  }

  return (
    <div className="pdf-viewer" ref={scrollRef} data-testid="pdf-viewer">
      {error !== null && <div className="pdf-error">Could not display the PDF: {error}</div>}
      {pages.map(({ page, canvas, width, height }) => (
        <div
          key={page}
          className="pdf-page"
          data-page={page}
          style={{ width, height, marginBottom: PAGE_GAP }}
          onDoubleClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onInverseSearch({
              page,
              x: (event.clientX - box.left) / scale,
              y: (event.clientY - box.top) / scale,
            });
          }}
        >
          <CanvasHost canvas={canvas} />
          {highlights
            .filter((rect) => rect.page === page)
            .map((rect, index) => (
              <div
                key={index}
                className="pdf-highlight"
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.height * scale,
                }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

/** Mounts an already rendered canvas element. */
function CanvasHost({ canvas }: { readonly canvas: HTMLCanvasElement }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hostRef.current?.replaceChildren(canvas);
  }, [canvas]);
  return <div ref={hostRef} />;
}
