import type { PdfPoint, PdfRect } from '@myleaf/compile';
import {
  GlobalWorkerOptions,
  PDFWorker,
  RenderingCancelledException,
  getDocument,
} from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import {
  displayScale,
  mostVisiblePage,
  pageIndexAt,
  pageTops,
  stepZoom,
  zoomFactor,
} from './zoom.js';
import type { PdfZoom, Size } from './zoom.js';

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

/** What the viewer shows, for the toolbar. */
export interface PdfViewState {
  /** 1-based page with the largest visible part; 0 without a document. */
  readonly page: number;
  readonly pages: number;
  /** Zoom factor in effect (1 = 100 %), or null without a document. */
  readonly zoom: number | null;
}

export interface PdfViewerHandle {
  goToPage(page: number): void;
  /**
   * Point on the reading line, a third down the visible area (where forward
   * search places its target), for inverse search. Null when nothing is shown.
   */
  readingPoint(): PdfPoint | null;
}

interface PdfViewerProps {
  /** PDF to show; a new URL loads a new version, keeping the scroll position. */
  readonly url: string | null;
  /** Boxes to highlight, e.g. from forward search. The first is scrolled into view. */
  readonly highlights: readonly PdfRect[];
  /** Double-click on a page. Coordinates are PDF points from the page's top-left. */
  readonly onInverseSearch: (point: PdfPoint) => void;
  /** Defaults to fitting the page width. */
  readonly zoom?: PdfZoom;
  /** Called when a keyboard shortcut changes the zoom (Mod-+ / Mod--). */
  readonly onZoom?: (zoom: PdfZoom) => void;
  readonly onViewChange?: (state: PdfViewState) => void;
  readonly ref?: Ref<PdfViewerHandle>;
}

interface LoadedDocument {
  readonly pdf: PDFDocumentProxy;
  /** Page sizes in PDF points. */
  readonly pages: readonly Size[];
}

/** Display geometry of the loaded document at the current scale. */
interface PageLayout {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  readonly tops: readonly number[];
  readonly heights: readonly number[];
}

const PAGE_GAP = 12;
/** Pages within this distance of the visible area are rendered ahead of scrolling. */
const RENDER_MARGIN = '100% 0px';
/** Wait after a zoom or resize before re-rendering, so a drag does not re-render every frame. */
const RERENDER_DELAY_MS = 120;
/** Where the reading line sits, as a share of the visible height. */
const READING_LINE = 1 / 3;

/**
 * PDF.js-based viewer. Only pages near the visible area are rendered, and a
 * page keeps showing its previous version until the new one is drawn, so
 * recompiling neither flashes nor waits for off-screen pages. PDF.js is
 * confined to this module.
 */
export function PdfViewer({
  url,
  highlights,
  onInverseSearch,
  zoom = 'fit-width',
  onZoom,
  onViewChange,
  ref,
}: PdfViewerProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Size | null>(null);
  const [page, setPage] = useState(1);

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
        if (cancelled) return;
        setDocument({ pdf, pages: viewports.map(({ width, height }) => ({ width, height })) });
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

  // Track the pane size; a hidden pane (size 0) keeps the last size.
  useEffect(() => {
    if (scroller === null) return;
    const observer = new ResizeObserver(() => {
      const width = scroller.clientWidth;
      const height = scroller.clientHeight;
      if (width === 0 || height === 0) return;
      setPane((previous) =>
        previous?.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  const layout = useMemo((): PageLayout | null => {
    if (document === null || pane === null || document.pages.length === 0) return null;
    const scale = displayScale(zoom, document.pages, pane, PAGE_GAP);
    const heights = document.pages.map((size) => size.height * scale);
    return { scale, heights, tops: pageTops(heights, PAGE_GAP) };
  }, [document, pane, zoom]);

  /** Scroll position as page and fraction of its height, kept across zooms. */
  const anchor = useRef<{ index: number; fraction: number } | null>(null);
  const shownScale = useRef<number | null>(null);

  const updatePosition = () => {
    if (scroller === null || layout === null) return;
    const top = scroller.scrollTop;
    const index = pageIndexAt(layout.tops, top);
    anchor.current = {
      index,
      fraction: (top - layout.tops[index]!) / layout.heights[index]!,
    };
    const visible = mostVisiblePage(layout.tops, layout.heights, top, top + scroller.clientHeight);
    setPage(visible + 1);
  };

  // Keep the same part of the document in view when the scale changes.
  useLayoutEffect(() => {
    if (layout === null || scroller === null) return;
    const previous = shownScale.current;
    shownScale.current = layout.scale;
    const position = anchor.current;
    if (previous === null || previous === layout.scale || position === null) return;
    const index = Math.min(position.index, layout.tops.length - 1);
    scroller.scrollTo({ top: layout.tops[index]! + position.fraction * layout.heights[index]! });
  }, [layout, scroller]);

  const lastPageCount = document?.pages.length ?? 0;
  const pageCount = url === null ? 0 : lastPageCount;
  const shownPage = pageCount === 0 ? 0 : Math.min(page, pageCount);
  const factor = layout === null || url === null ? null : zoomFactor(layout.scale);
  const onViewChangeRef = useRef(onViewChange);
  useLayoutEffect(() => {
    onViewChangeRef.current = onViewChange;
  });
  useEffect(() => {
    onViewChangeRef.current?.({ page: shownPage, pages: pageCount, zoom: factor });
  }, [shownPage, pageCount, factor]);

  // Scroll each new set of highlights into view once.
  const scrolledTo = useRef<readonly PdfRect[] | null>(null);
  useEffect(() => {
    const target = highlights[0];
    if (target === undefined || scroller === null || layout === null) return;
    if (scrolledTo.current === highlights) return;
    const top = layout.tops[target.page - 1];
    if (top === undefined) return;
    scrolledTo.current = highlights;
    scroller.scrollTo({
      top: top + target.y * layout.scale - scroller.clientHeight * READING_LINE,
      behavior: 'smooth',
    });
  }, [highlights, layout, scroller]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(target) {
        if (scroller === null || layout === null) return;
        const index = Math.min(Math.max(target, 1), layout.tops.length) - 1;
        scroller.scrollTo({ top: layout.tops[index]! - PAGE_GAP });
      },
      readingPoint() {
        if (scroller === null || layout === null || document === null) return null;
        if (scroller.clientHeight === 0) return null;
        const y = scroller.scrollTop + scroller.clientHeight * READING_LINE;
        const index = pageIndexAt(layout.tops, y);
        const size = document.pages[index]!;
        return {
          page: index + 1,
          x: size.width / 2,
          y: Math.min(Math.max((y - layout.tops[index]!) / layout.scale, 0), size.height),
        };
      },
    }),
    [document, layout, scroller],
  );

  const movePage = (delta: number) => {
    if (scroller === null || layout === null) return;
    const target = Math.min(Math.max(shownPage + delta, 1), layout.tops.length);
    scroller.scrollTo({ top: layout.tops[target - 1]! - PAGE_GAP });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === '=' || event.key === '+')) {
      if (factor === null) return;
      event.preventDefault();
      onZoom?.(stepZoom(factor, 1));
    } else if (mod && event.key === '-') {
      if (factor === null) return;
      event.preventDefault();
      onZoom?.(stepZoom(factor, -1));
    } else if (event.key === 'PageDown') {
      if (layout === null) return;
      event.preventDefault();
      movePage(1);
    } else if (event.key === 'PageUp') {
      if (layout === null) return;
      event.preventDefault();
      movePage(-1);
    }
  };

  if (url === null) {
    return <div className="pdf-empty">Compile to see the PDF.</div>;
  }

  return (
    <div
      className="pdf-viewer"
      ref={setScroller}
      data-testid="pdf-viewer"
      role="region"
      aria-label="PDF pages"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={updatePosition}
    >
      {error !== null && <div className="pdf-error">Could not display the PDF: {error}</div>}
      {document !== null &&
        layout !== null &&
        document.pages.map((size, index) => (
          <PdfPage
            key={index}
            pdf={document.pdf}
            pageNumber={index + 1}
            scale={layout.scale}
            width={size.width * layout.scale}
            height={size.height * layout.scale}
            scroller={scroller}
            highlights={highlights.filter((rect) => rect.page === index + 1)}
            onInverseSearch={onInverseSearch}
          />
        ))}
    </div>
  );
}

interface PdfPageProps {
  readonly pdf: PDFDocumentProxy;
  readonly pageNumber: number;
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Display size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly scroller: HTMLDivElement | null;
  readonly highlights: readonly PdfRect[];
  readonly onInverseSearch: (point: PdfPoint) => void;
}

function PdfPage(props: PdfPageProps) {
  const { pdf, pageNumber, scale, width, height, scroller, highlights, onInverseSearch } = props;
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  /** Document of the canvas on screen; a re-render of the same document is a zoom. */
  const renderedPdf = useRef<PDFDocumentProxy | null>(null);
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
    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const pixelRatio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise;
      // Swap only when complete, so the previous version stays visible meanwhile.
      if (!cancelled) {
        canvasHostRef.current?.replaceChildren(canvas);
        renderedPdf.current = pdf;
      }
    };
    // A new version renders at once; a zoom of the shown version waits for the zoom to settle.
    const timer = setTimeout(
      () =>
        void render().catch((reason: unknown) => {
          if (!(reason instanceof RenderingCancelledException) && !cancelled) {
            console.error(`Could not render page ${pageNumber}`, reason);
          }
        }),
      renderedPdf.current === pdf ? RERENDER_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, pageNumber, scale, visible]);

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
          x: (event.clientX - box.left) / scale,
          y: (event.clientY - box.top) / scale,
        });
      }}
    >
      <div className="pdf-canvas" ref={canvasHostRef} />
      {highlights.map((rect, index) => (
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
  );
}
