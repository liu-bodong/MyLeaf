import { LIVE_MAX_PAGE_RANGE, decodeLivePdfPage } from '@myleaf/api';
import type { LiveClientMessage, LiveServerMessage } from '@myleaf/api';
import type { PdfPoint, PdfRect, SourceLocation, TexEngine } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import { Fragment, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { api } from '../api/client.js';
import { engineName } from './engine-name.js';
import type { LiveChannel } from './live-channel.js';
import { PdfRenderer } from './pdf-renderer.js';
import type { TextLine } from './pdf-renderer.js';
import './live-preview.css';

interface LivePreviewPaneProps {
  readonly projectId: ProjectId;
  readonly channel: LiveChannel;
  /** The engine that typesets the live pages. */
  readonly engine: TexEngine;
  /** Called once the session runs, so the latest unsaved text can be sent. */
  readonly onReady: () => void;
  /** Offered when the session ended: switch the output pane to the PDF. */
  readonly onShowPdf: () => void;
  /** Offered when the session ended: start a new session. */
  readonly onRetry: () => void;
  /** Boxes to highlight, e.g. from forward search. The first is scrolled into view. */
  readonly highlights?: readonly PdfRect[];
  /** Double-click on a page. Coordinates are PDF points from the page's top-left. */
  readonly onInverseSearch?: ((point: PdfPoint) => void) | undefined;
  readonly ref?: Ref<LivePreviewHandle>;
}

/** SyncTeX on the live pages, as of the server's last finished run. */
export interface LivePreviewHandle {
  /** Boxes on the live pages that `location` produced; none without SyncTeX. */
  forwardSearch(location: SourceLocation): Promise<readonly PdfRect[]>;
  /** The source that produced `point`, or `null`. */
  inverseSearch(point: PdfPoint): Promise<SourceLocation | null>;
  /**
   * Point on the reading line, a third down the visible area (where forward
   * search places its target), for inverse search. Null when nothing is shown.
   */
  readingPoint(): PdfPoint | null;
}

/** Where the reading line sits, as a share of the visible height (as in PdfViewer). */
const READING_LINE = 1 / 3;
/** A SyncTeX request, without the id the pane gives it. */
type SearchRequest =
  Extract<LiveClientMessage, { type: 'forward' | 'inverse' }> extends infer M
    ? M extends unknown
      ? Omit<M, 'id'>
      : never
    : never;
/** The server's answer to a SyncTeX request. */
type SearchResult = Extract<LiveServerMessage, { type: 'forward-result' | 'inverse-result' }>;

type Connection =
  | { readonly state: 'connecting' }
  | { readonly state: 'live' }
  | { readonly state: 'ended'; readonly message: string };

/** A shown page: an SVG (TeXpresso) or a PDF drawn by MuPDF (pdfTeX). */
type LivePage =
  | {
      readonly kind: 'svg';
      readonly url: string;
      /** Page size from the SVG, in its units (pt); sets the slot's aspect ratio. */
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'pdf';
      readonly pdf: Uint8Array;
      readonly bitmap: ImageBitmap;
      /** Page size in PDF points. */
      readonly width: number;
      readonly height: number;
      readonly lines: readonly PlacedLine[];
    };

/** A line of the text layer, with the horizontal stretch that makes it as wide as on the page. */
interface PlacedLine extends TextLine {
  readonly stretch: number;
}

/** Font of the text layer; its glyphs are invisible, only their extent matters. */
const TEXT_FONT = 'sans-serif';

let measure: CanvasRenderingContext2D | null = null;
/** Stretches each line so the text layer's glyphs cover the page's. */
function placeLines(lines: readonly TextLine[]): PlacedLine[] {
  measure ??= document.createElement('canvas').getContext('2d');
  if (measure === null) return lines.map((line) => ({ ...line, stretch: 1 }));
  measure.font = `100px ${TEXT_FONT}`;
  return lines.map((line) => {
    // Width at a font size of 100 px; the layer's font size is the line's height.
    const natural = (measure!.measureText(line.text).width * line.height) / 100;
    return { ...line, stretch: natural > 0 ? line.width / natural : 1 };
  });
}

/**
 * Where page slots go in the scroller, on whole device pixels: a canvas
 * shown at a fractional size or position is resampled, which blurs it.
 */
interface SlotGeometry {
  readonly dpr: number;
  /** Slot width in device pixels; pages are drawn this wide. */
  readonly width: number;
  /** Left margin in CSS pixels that moves slots onto a device pixel. */
  readonly offset: number;
}

/** Tolerance for floating-point error in positions, in device pixels. */
const EPSILON = 0.01;

function measureSlots(scroller: HTMLElement): SlotGeometry {
  const dpr = window.devicePixelRatio;
  const style = getComputedStyle(scroller);
  const box = scroller.getBoundingClientRect();
  // Borders and scrollbar are whole CSS pixels; the box may be fractional.
  const inner = box.width - (scroller.offsetWidth - scroller.clientWidth);
  const left = (box.left + scroller.clientLeft + parseFloat(style.paddingLeft)) * dpr;
  const right =
    left + (inner - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * dpr;
  const start = Math.ceil(left - EPSILON);
  return {
    dpr,
    width: Math.max(100, Math.floor(right + EPSILON) - start),
    offset: Math.max(0, start - left) / dpr,
  };
}

/** Calls `onChange` when the device pixel ratio changes (zoom, another monitor). */
function watchPixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const listen = () => {
    query?.removeEventListener('change', changed);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', changed);
  };
  const changed = () => {
    listen();
    onChange();
  };
  listen();
  return () => query?.removeEventListener('change', changed);
}

/** Time to wait after the pane is resized before drawing pages at the new size. */
const RESIZE_DELAY_MS = 200;

const release = (page: LivePage) => {
  if (page.kind === 'svg') URL.revokeObjectURL(page.url);
  else page.bitmap.close();
};

/** US Letter, until the first page arrives. */
const DEFAULT_SIZE = { width: 612, height: 792 };
/** Pages rendered beyond the visible ones in each direction. */
const PREFETCH = 1;

function svgSize(svg: string): { width: number; height: number } | null {
  const match = /<svg[^>]*\swidth="([\d.]+)[a-z]*"[^>]*\sheight="([\d.]+)[a-z]*"/.exec(svg);
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Live-rendered pages over the project's live-preview WebSocket (ADR 0012,
 * 0014), in one continuous scroll. The visible pages (plus PREFETCH) are
 * requested from the server; other pages keep their latest rendering or a
 * placeholder of the same size. Each mount is one session.
 */
export function LivePreviewPane({
  projectId,
  channel,
  engine,
  onReady,
  onShowPdf,
  onRetry,
  highlights = [],
  onInverseSearch,
  ref,
}: LivePreviewPaneProps) {
  const [connection, setConnection] = useState<Connection>({ state: 'connecting' });
  const [pages, setPages] = useState<ReadonlyMap<number, LivePage>>(new Map());
  /** Pages being typeset again since their image was rendered: shown dimmed. */
  const [stale, setStale] = useState<ReadonlySet<number>>(new Set());
  /** Pages to lay out: the final count, or the most seen while re-typesetting. */
  const [count, setCount] = useState(1);
  const [current, setCurrent] = useState(1);
  const [geometry, setGeometry] = useState<SlotGeometry | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  /** Sends a SyncTeX request on the session; resolves with `null` if it ends first. */
  const searchRef = useRef<((message: SearchRequest) => Promise<SearchResult | null>) | null>(null);

  useEffect(() => {
    const socket = new WebSocket(api.livePreviewUrl(projectId));
    socketRef.current = socket;
    socket.binaryType = 'arraybuffer';
    let ended = false;
    let closed = false;
    const live = new Map<number, LivePage>();
    /** Page messages received per page; a drawn page is shown only if it is the latest. */
    const received = new Map<number, number>();
    const staleNow = new Set<number>();
    const renderer = new PdfRenderer();
    /** Where slots go (see measureSlots); pages are drawn at its width. */
    let measured: SlotGeometry | null = null;
    const searches = new Map<number, (result: SearchResult | null) => void>();
    let nextSearch = 0;
    searchRef.current = (message) =>
      new Promise((resolve) => {
        if (socket.readyState !== WebSocket.OPEN) {
          resolve(null);
          return;
        }
        const id = nextSearch++;
        searches.set(id, resolve);
        const request: LiveClientMessage = { ...message, id };
        socket.send(JSON.stringify(request));
      });
    const endSearches = () => {
      for (const resolve of searches.values()) resolve(null);
      searches.clear();
    };
    const end = (message: string) => {
      ended = true;
      setConnection({ state: 'ended', message });
    };
    /** Shows `next` for `page` if no newer message for it arrived meanwhile. */
    const show = (page: number, sequence: number, next: LivePage) => {
      if (closed || received.get(page) !== sequence) {
        release(next);
        return;
      }
      const previous = live.get(page);
      if (previous !== undefined) release(previous);
      live.set(page, next);
      setPages(new Map(live));
    };
    const draw = (page: number, sequence: number, pdf: Uint8Array) => {
      renderer
        .render(pdf, measured?.width ?? 800)
        .then(({ bitmap, width, height, lines }) =>
          show(page, sequence, {
            kind: 'pdf',
            pdf,
            bitmap,
            width,
            height,
            lines: placeLines(lines),
          }),
        )
        .catch(() => {});
    };
    /** Counts a new message for `page`; returns its sequence number. */
    const receive = (page: number, isStale: boolean) => {
      const sequence = (received.get(page) ?? 0) + 1;
      received.set(page, sequence);
      if (isStale) staleNow.add(page);
      else staleNow.delete(page);
      setStale(new Set(staleNow));
      return sequence;
    };

    // Slots follow the pane's size at once; pages are drawn again at the new
    // width once resizing pauses.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const scroller = scrollerRef.current;
      if (scroller === null) return;
      const next = measureSlots(scroller);
      const previous = measured;
      if (
        previous !== null &&
        previous.dpr === next.dpr &&
        previous.width === next.width &&
        previous.offset === next.offset
      ) {
        return;
      }
      measured = next;
      setGeometry(next);
      if (previous === null || previous.width === next.width) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        for (const [page, shown] of live) {
          if (shown.kind !== 'pdf') continue;
          const sequence = (received.get(page) ?? 0) + 1;
          received.set(page, sequence);
          draw(page, sequence, shown.pdf);
        }
      }, RESIZE_DELAY_MS);
    };
    measure();
    const resizes = new ResizeObserver(measure);
    if (scrollerRef.current !== null) resizes.observe(scrollerRef.current);
    const unwatchPixelRatio = watchPixelRatio(measure);

    socket.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
      const message: LiveServerMessage =
        typeof event.data === 'string'
          ? (JSON.parse(event.data) as LiveServerMessage)
          : decodeLivePdfPage(new Uint8Array(event.data));
      if (message.type === 'page' && 'pdf' in message) {
        const { page } = message;
        draw(page, receive(page, message.stale === true), message.pdf);
      } else if (message.type === 'page') {
        const { page } = message;
        const sequence = receive(page, message.stale === true);
        const url = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
        const size = svgSize(message.svg) ?? DEFAULT_SIZE;
        // Decoded before it replaces the shown image, so the page does not flash blank.
        const image = new Image();
        image.src = url;
        void image
          .decode()
          .catch(() => {})
          .then(() => show(page, sequence, { kind: 'svg', url, ...size }));
      } else if (message.type === 'page-unchanged') {
        staleNow.delete(message.page);
        setStale(new Set(staleNow));
      } else if (message.type === 'stale') {
        for (const page of received.keys()) if (page >= message.from) staleNow.add(page);
        setStale(new Set(staleNow));
      } else if (message.type === 'forward-result' || message.type === 'inverse-result') {
        searches.get(message.id)?.(message);
        searches.delete(message.id);
      } else if (message.type === 'page-count') {
        setCount((shown) =>
          message.final ? Math.max(1, message.count) : Math.max(shown, message.count),
        );
      } else if (message.state === 'starting') {
        setConnection({ state: 'live' });
        onReadyRef.current();
      } else {
        end(message.message ?? message.state);
      }
    });
    socket.addEventListener('close', () => {
      endSearches();
      if (!ended) end('Disconnected');
    });
    const unsubscribe = channel.subscribe((update) => {
      const message: LiveClientMessage = {
        type: 'update',
        path: update.path,
        content: update.text,
      };
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    });

    return () => {
      closed = true;
      unsubscribe();
      socket.close();
      socketRef.current = null;
      searchRef.current = null;
      endSearches();
      resizes.disconnect();
      unwatchPixelRatio();
      clearTimeout(resizeTimer);
      renderer.close();
      for (const page of live.values()) release(page);
    };
  }, [projectId, channel]);

  // Requests the visible pages whenever they change (scrolling, resizing,
  // pages appearing or disappearing).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const visible = new Set<number>();
    let requested = '';
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) visible.add(page);
          else visible.delete(page);
        }
        if (visible.size === 0) return;
        const shown = [...visible].sort((a, b) => a - b);
        const firstVisible = shown[0] ?? 1;
        setCurrent(firstVisible);
        const first = Math.max(1, firstVisible - PREFETCH);
        const last = Math.min(
          (shown.at(-1) ?? firstVisible) + PREFETCH,
          first + LIVE_MAX_PAGE_RANGE - 1,
        );
        const key = `${first}-${last}`;
        const socket = socketRef.current;
        if (key !== requested && socket?.readyState === WebSocket.OPEN) {
          requested = key;
          const message: LiveClientMessage = { type: 'pages', first, last };
          socket.send(JSON.stringify(message));
        }
      },
      { root: scroller },
    );
    for (const slot of scroller.querySelectorAll('[data-page]')) observer.observe(slot);
    return () => observer.disconnect();
  }, [count, connection.state]);

  const fallbackSize = pages.get(current) ?? pages.values().next().value ?? DEFAULT_SIZE;
  const slots = Array.from({ length: count }, (_, index) => index + 1);
  /** Page size in PDF points: the page's own, or that of the pages around it. */
  const sizeOf = (page: number) => pages.get(page) ?? fallbackSize;
  const sizeOfRef = useRef(sizeOf);
  useEffect(() => {
    sizeOfRef.current = sizeOf;
  });

  // Scroll each new set of highlights into view once.
  const scrolledTo = useRef<readonly PdfRect[] | null>(null);
  useEffect(() => {
    const target = highlights[0];
    const scroller = scrollerRef.current;
    if (target === undefined || scroller === null || scrolledTo.current === highlights) return;
    const slot = scroller.querySelector(`[data-page="${target.page}"]`);
    if (slot === null) return;
    scrolledTo.current = highlights;
    const box = slot.getBoundingClientRect();
    const scale = box.width / sizeOfRef.current(target.page).width;
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        box.top -
        scroller.getBoundingClientRect().top +
        target.y * scale -
        scroller.clientHeight * READING_LINE,
      behavior: 'smooth',
    });
  }, [highlights]);

  useImperativeHandle(
    ref,
    () => ({
      async forwardSearch(location) {
        const result = await searchRef.current?.({
          type: 'forward',
          path: location.file,
          line: location.line,
          column: location.column,
        });
        return result?.type === 'forward-result' ? result.rects : [];
      },
      async inverseSearch({ page, x, y }) {
        const result = await searchRef.current?.({ type: 'inverse', page, x, y });
        return result?.type === 'inverse-result' ? result.location : null;
      },
      readingPoint() {
        const scroller = scrollerRef.current;
        if (scroller === null || scroller.clientHeight === 0) return null;
        const line = scroller.getBoundingClientRect().top + scroller.clientHeight * READING_LINE;
        const slots = [...scroller.querySelectorAll<HTMLElement>('[data-page]')];
        // The last page that starts above the reading line.
        const slot = slots.findLast((element) => element.getBoundingClientRect().top <= line);
        if (slot === undefined) return null;
        const page = Number(slot.dataset.page);
        const box = slot.getBoundingClientRect();
        const size = sizeOfRef.current(page);
        const scale = box.width / size.width;
        return {
          page,
          x: size.width / 2,
          y: Math.min(Math.max((line - box.top) / scale, 0), size.height),
        };
      },
    }),
    [],
  );

  return (
    <div className="live-pane" data-testid="live-preview">
      <header>
        <span className="live-badge">Live · {engineName(engine)}</span>
        <span data-testid="live-page">
          Page {Math.min(current, count)} of {count}
        </span>
        <span className="live-status" role="status">
          {connection.state === 'connecting' && 'Starting…'}
          {connection.state === 'ended' && connection.message}
        </span>
        {connection.state === 'ended' && (
          <>
            <button onClick={onRetry}>Retry</button>
            <button onClick={onShowPdf}>Show PDF</button>
          </>
        )}
      </header>
      <div className="live-pages" ref={scrollerRef}>
        {slots.map((page) => {
          const rendered = pages.get(page);
          const size = rendered ?? fallbackSize;
          return (
            <div
              key={page}
              className={stale.has(page) ? 'live-slot stale' : 'live-slot'}
              data-page={page}
              style={
                geometry === null
                  ? { aspectRatio: `${size.width} / ${size.height}` }
                  : {
                      width: `${geometry.width / geometry.dpr}px`,
                      height: `${Math.round((geometry.width * size.height) / size.width) / geometry.dpr}px`,
                      marginLeft: `${geometry.offset}px`,
                    }
              }
              onDoubleClick={
                onInverseSearch &&
                ((event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onInverseSearch({
                    page,
                    x: ((event.clientX - box.left) / box.width) * size.width,
                    y: ((event.clientY - box.top) / box.height) * size.height,
                  });
                })
              }
            >
              {rendered?.kind === 'svg' ? (
                <img src={rendered.url} alt={`Live preview of page ${page}`} />
              ) : rendered?.kind === 'pdf' ? (
                <PdfPage page={rendered} label={`Live preview of page ${page}`} />
              ) : (
                connection.state !== 'ended' && <p className="placeholder">Rendering…</p>
              )}
              {highlights
                .filter((rect) => rect.page === page)
                .map((rect, index) => (
                  <div
                    key={index}
                    className="pdf-highlight"
                    style={{
                      left: `${(rect.x / size.width) * 100}%`,
                      top: `${(rect.y / size.height) * 100}%`,
                      width: `${(rect.width / size.width) * 100}%`,
                      height: `${(rect.height / size.height) * 100}%`,
                    }}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A page drawn by MuPDF, with an invisible text layer over it for selecting and copying. */
function PdfPage({ page, label }: { page: LivePage & { kind: 'pdf' }; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = page.bitmap.width;
    canvas.height = page.bitmap.height;
    canvas.getContext('2d')?.drawImage(page.bitmap, 0, 0);
  }, [page.bitmap]);
  return (
    <>
      <canvas ref={canvasRef} role="img" aria-label={label} />
      <div className="live-text" style={{ fontFamily: TEXT_FONT }}>
        {page.lines.map((line, index) => (
          // A line break after each line, so copied text keeps its lines.
          <Fragment key={index}>
            <span
              style={{
                left: `${(line.left / page.width) * 100}%`,
                top: `${(line.top / page.height) * 100}%`,
                fontSize: `${(line.height / page.width) * 100}cqw`,
                transform: `scaleX(${line.stretch})`,
              }}
            >
              {line.text}
            </span>
            <br />
          </Fragment>
        ))}
      </div>
    </>
  );
}
