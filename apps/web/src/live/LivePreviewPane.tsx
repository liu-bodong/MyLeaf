import { LIVE_MAX_PAGE_RANGE, decodeLiveBinary } from '@myleaf/api';
import type { LiveClientMessage, LiveServerMessage } from '@myleaf/api';
import type { PdfPoint, PdfRect, SourceLocation } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { api } from '../api/client.js';
import { stepZoom } from '../pdf/zoom.js';
import type { PdfZoom } from '../pdf/zoom.js';
import type { LiveChannel } from './live-channel.js';
import { PdfRenderer } from './pdf-renderer.js';
import { liveMark, liveMarkAfterPaint, liveTimingOn } from './live-timing.js';
import { MIN_SLOT_WIDTH, geometryZoom, slotGeometry } from './slot-geometry.js';
import type { PaneMeasure } from './slot-geometry.js';
import type { RenderedPage, TextLine } from './pdf-renderer.js';
import './live-preview.css';

interface LivePreviewPaneProps {
  readonly projectId: ProjectId;
  readonly channel: LiveChannel;
  /** Called once the session runs, so the latest unsaved text can be sent. */
  readonly onReady: () => void;
  /**
   * The compiled PDF and the page shown in it, read when the pane mounts: its
   * pages stand in (dimmed) until live pages arrive, and the pane opens at
   * that page.
   */
  readonly seed?: LiveSeed | null;
  /** Defaults to fitting the page width. */
  readonly zoom?: PdfZoom;
  /** Called when a keyboard shortcut changes the zoom (Mod-+ / Mod--). */
  readonly onZoom?: (zoom: PdfZoom) => void;
  /** What the pane shows, for the toolbar. */
  readonly onViewChange?: (state: LiveViewState) => void;
  /** Boxes to highlight, e.g. from forward search. The first is scrolled into view. */
  readonly highlights?: readonly PdfRect[];
  /** Double-click on a page. Coordinates are PDF points from the page's top-left. */
  readonly onInverseSearch?: ((point: PdfPoint) => void) | undefined;
  readonly ref?: Ref<LivePreviewHandle>;
}

export interface LiveSeed {
  readonly url: string;
  /** 1-based page to open at. */
  readonly page: number;
}

export type LiveConnection =
  | { readonly state: 'connecting' }
  | { readonly state: 'live' }
  | { readonly state: 'ended'; readonly message: string };

/** What the live pane shows, for the toolbar. */
export interface LiveViewState {
  /** 1-based page shown most. */
  readonly page: number;
  readonly pages: number;
  /** Zoom factor in effect (1 = 100 %), or null before the pane is measured. */
  readonly zoom: number | null;
  readonly connection: LiveConnection;
}

/** SyncTeX on the live pages, as of the server's last finished run; page navigation. */
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
  /** Scrolls page `page` (1-based) to the top. */
  goToPage(page: number): void;
  /** The page shown most, 1-based. */
  currentPage(): number;
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

/** A page message, as live timing (live-timing.ts) names it: page and its sequence number. */
interface TimingKey {
  readonly page: number;
  readonly sequence: number;
}

/** A shown page: an SVG (TeXpresso) or a PDF drawn by MuPDF (pdfTeX). */
type LivePage = (
  | {
      readonly kind: 'svg';
      readonly url: string;
      /** Page size from the SVG, in its units (pt); sets the slot's aspect ratio. */
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'pdf';
      /** Draws the page again at another width (after a resize or zoom). */
      readonly redraw: (pixelWidth: number) => Promise<RenderedPage>;
      readonly bitmap: ImageBitmap;
      /** A page of the compiled PDF, standing in until the live page arrives. */
      readonly compiled: boolean;
      /** Page size in PDF points. */
      readonly width: number;
      readonly height: number;
      readonly lines: readonly PlacedLine[];
    }
) & {
  /** With live timing on: the message this page came from, marked once painted. */
  readonly timing?: TimingKey;
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

/** Tolerance for floating-point error in positions, in device pixels. */
const EPSILON = 0.01;
/** Padding around the pages in `.live-pages`, in CSS pixels. */
const PAGE_GAP = 12;

function measurePane(scroller: HTMLElement): PaneMeasure {
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
    left,
    start,
    width: Math.max(MIN_SLOT_WIDTH, Math.floor(right + EPSILON) - start),
    height: scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
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

/** Time to wait after the pane is resized or zoomed before drawing pages at the new size. */
const RESIZE_DELAY_MS = 200;

const release = (page: LivePage) => {
  if (page.kind === 'svg') URL.revokeObjectURL(page.url);
  else page.bitmap.close();
};

/** US Letter, until the first page arrives. */
const DEFAULT_SIZE = { width: 612, height: 792 };
/** Visible shares at which the shown page is worked out again. */
const THRESHOLDS = Array.from({ length: 11 }, (_, index) => index / 10);
/**
 * Pages requested beyond the visible ones, ahead in the direction of the
 * last scroll and behind it: the server sends them and they are drawn
 * before they scroll into view. Pages leave their fonts out, so each costs
 * tens of KB.
 */
const PREFETCH_AHEAD = 2;
const PREFETCH_BEHIND = 1;

function svgSize(svg: string): { width: number; height: number } | null {
  const match = /<svg[^>]*\swidth="([\d.]+)[a-z]*"[^>]*\sheight="([\d.]+)[a-z]*"/.exec(svg);
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Live-rendered pages over the project's live-preview WebSocket (ADR 0012,
 * 0014), in one continuous scroll. The visible pages (plus PREFETCH_*) are
 * requested from the server; other pages keep their latest rendering, a
 * page of the compiled PDF (`seed`), or a placeholder of the same size.
 * Each mount is one session. Status, page and zoom go to the toolbar
 * through `onViewChange`.
 */
export function LivePreviewPane({
  projectId,
  channel,
  onReady,
  seed = null,
  zoom = 'fit-width',
  onZoom,
  onViewChange,
  highlights = [],
  onInverseSearch,
  ref,
}: LivePreviewPaneProps) {
  const [connection, setConnection] = useState<LiveConnection>({ state: 'connecting' });
  const [pages, setPages] = useState<ReadonlyMap<number, LivePage>>(new Map());
  /** Pages being typeset again since their image was rendered, or from the compiled PDF: shown dimmed. */
  const [stale, setStale] = useState<ReadonlySet<number>>(new Set());
  /** Pages to lay out: the final count, or the most seen while re-typesetting. */
  const [count, setCount] = useState(1);
  const [current, setCurrent] = useState(1);
  const [pane, setPane] = useState<PaneMeasure | null>(null);
  /** Page to scroll to once laid out (the seed's page). */
  const [openAt, setOpenAt] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  const seedRef = useRef(seed);
  /** Sends a SyncTeX request on the session; resolves with `null` if it ends first. */
  const searchRef = useRef<((message: SearchRequest) => Promise<SearchResult | null>) | null>(null);
  /** Width pages are drawn at, in device pixels (the slot width). */
  const drawWidthRef = useRef(800);
  /** Draws every shown page again at `drawWidthRef`'s width. */
  const redrawRef = useRef<(() => void) | null>(null);
  /** Asks for pages `first`–`last` (visible plus prefetch). */
  const showPagesRef = useRef<((first: number, last: number) => void) | null>(null);

  useEffect(() => {
    const socket = new WebSocket(api.livePreviewUrl(projectId));
    socketRef.current = socket;
    socket.binaryType = 'arraybuffer';
    let ended = false;
    let closed = false;
    const live = new Map<number, LivePage>();
    /**
     * Page messages received (and redraws started) per page; a drawn page is
     * shown only if it is the latest. 0 (absent): only the seed may draw it.
     */
    const received = new Map<number, number>();
    const staleNow = new Set<number>();
    const renderer = new PdfRenderer();
    /** Font programs sent on this connection since the last `fonts-reset`, by id. */
    const fonts = new Map<string, Uint8Array>();
    /** The compiled PDF that stands in for pages not rendered live yet. */
    let seedDocument: { key: string; pdf: Uint8Array; pages: number } | null = null;
    const seeding = new Set<number>();
    /** Whether the server reported the final page count (which overrides the seed's). */
    let counted = false;
    let wanted: { first: number; last: number } | null = null;
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
      if (closed || (received.get(page) ?? 0) !== sequence) {
        release(next);
        return;
      }
      const previous = live.get(page);
      if (previous !== undefined) release(previous);
      if (next.timing) liveMark('shown', { ...next.timing });
      live.set(page, next);
      setPages(new Map(live));
    };
    const draw = (
      page: number,
      sequence: number,
      redraw: (pixelWidth: number) => Promise<RenderedPage>,
      compiled = false,
    ) =>
      redraw(drawWidthRef.current)
        .then((rendered) => {
          const timed = liveTimingOn && sequence > 0 && !compiled;
          if (timed) {
            liveMark('drawn', {
              page,
              sequence,
              ...rendered.timing,
              pixels: rendered.bitmap.width * rendered.bitmap.height,
            });
          }
          show(page, sequence, {
            ...(timed ? { timing: { page, sequence } } : {}),
            kind: 'pdf',
            redraw,
            compiled,
            bitmap: rendered.bitmap,
            width: rendered.width,
            height: rendered.height,
            lines: placeLines(rendered.lines),
          });
          return rendered;
        })
        .catch(() => null);
    /** Counts a new message for `page`; returns its sequence number. */
    const receive = (page: number, isStale: boolean) => {
      const sequence = (received.get(page) ?? 0) + 1;
      received.set(page, sequence);
      if (isStale) staleNow.add(page);
      else staleNow.delete(page);
      setStale(new Set(staleNow));
      return sequence;
    };
    /** Draws a page of the compiled PDF where no live page arrived yet. */
    const drawSeed = (page: number) => {
      const document = seedDocument;
      if (document === null || page > document.pages) return;
      if (received.has(page) || seeding.has(page) || live.has(page)) return;
      seeding.add(page);
      staleNow.add(page);
      setStale(new Set(staleNow));
      void draw(page, 0, (width) => renderer.renderPage(document, page, width), true);
    };
    redrawRef.current = () => {
      for (const [page, shown] of live) {
        if (shown.kind !== 'pdf') continue;
        const sequence = (received.get(page) ?? 0) + 1;
        received.set(page, sequence);
        void draw(page, sequence, shown.redraw, shown.compiled);
      }
    };
    showPagesRef.current = (first, last) => {
      wanted = { first, last };
      if (socket.readyState === WebSocket.OPEN) {
        const message: LiveClientMessage = { type: 'pages', first, last };
        socket.send(JSON.stringify(message));
      }
      for (let page = first; page <= last; page++) drawSeed(page);
    };

    const opening = seedRef.current;
    if (opening !== null) {
      void (async () => {
        const response = await fetch(opening.url);
        if (!response.ok || closed) return;
        const document = {
          key: opening.url,
          pdf: new Uint8Array(await response.arrayBuffer()),
          pages: 0,
        };
        // The seed's page first: it is the one shown, and it tells the page count.
        const page = Math.max(1, opening.page);
        seeding.add(page);
        const rendered = await draw(
          page,
          0,
          (width) => renderer.renderPage(document, page, width),
          true,
        );
        if (rendered === null || closed) return;
        seedDocument = { ...document, pages: rendered.pages };
        if (!received.has(page)) {
          staleNow.add(page);
          setStale(new Set(staleNow));
        }
        // Until the server's count is final, at least the compiled PDF's pages.
        if (!counted) setCount((shown) => Math.max(shown, rendered.pages));
        setOpenAt(Math.min(page, rendered.pages));
        // Set by the visible-range observer meanwhile (TypeScript cannot see that).
        const range = wanted as { first: number; last: number } | null;
        if (range !== null) {
          for (let next = range.first; next <= range.last; next++) drawSeed(next);
        }
      })().catch(() => {});
    }

    socket.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
      const message: LiveServerMessage =
        typeof event.data === 'string'
          ? (JSON.parse(event.data) as LiveServerMessage)
          : decodeLiveBinary(new Uint8Array(event.data));
      if (message.type === 'font') {
        fonts.set(message.id, message.data);
      } else if (message.type === 'fonts-reset') {
        // Shown pages keep the fonts they use (their redraw holds them).
        fonts.clear();
      } else if (message.type === 'page' && 'pdf' in message) {
        const { page, pdf } = message;
        const sequence = receive(page, message.stale === true);
        if (liveTimingOn) {
          const bytes = typeof event.data === 'string' ? event.data.length : event.data.byteLength;
          liveMark('recv', { page, sequence, format: 'pdf', bytes, stale: message.stale === true });
        }
        const pageFonts =
          message.fonts === undefined
            ? undefined
            : new Map(
                message.fonts.flatMap((id) => {
                  const data = fonts.get(id);
                  return data === undefined ? [] : [[id, data] as const];
                }),
              );
        void draw(page, sequence, (width) => renderer.render(pdf, width, pageFonts));
      } else if (message.type === 'page') {
        const { page } = message;
        const sequence = receive(page, message.stale === true);
        const stale = message.stale === true;
        if (liveTimingOn) {
          liveMark('recv', { page, sequence, format: 'svg', bytes: message.svg.length, stale });
        }
        const url = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
        const size = svgSize(message.svg) ?? DEFAULT_SIZE;
        // Decoded before it replaces the shown image, so the page does not flash blank.
        const image = new Image();
        image.src = url;
        void image
          .decode()
          .catch(() => {})
          .then(() => {
            if (liveTimingOn) liveMark('drawn', { page, sequence });
            show(page, sequence, {
              ...(liveTimingOn ? { timing: { page, sequence } } : {}),
              kind: 'svg',
              url,
              ...size,
            });
          });
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
        if (message.final) counted = true;
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
      // Not after unmounting (or React's development remount): the pane is gone.
      if (!ended && !closed) end('Disconnected');
    });
    const unsubscribe = channel.subscribe((update) => {
      const message: LiveClientMessage = {
        type: 'update',
        path: update.path,
        content: update.text,
      };
      if (socket.readyState === WebSocket.OPEN) {
        if (liveTimingOn) liveMark('send', { path: update.path, bytes: update.text.length });
        socket.send(JSON.stringify(message));
      }
    });

    return () => {
      closed = true;
      unsubscribe();
      socket.close();
      socketRef.current = null;
      searchRef.current = null;
      redrawRef.current = null;
      showPagesRef.current = null;
      endSearches();
      renderer.close();
      for (const page of live.values()) release(page);
    };
  }, [projectId, channel]);

  // Measure the pane: slots follow its size at once.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const measure = () => {
      if (scroller.clientWidth === 0) return; // Hidden: keep the last size.
      const next = measurePane(scroller);
      setPane((previous) =>
        previous !== null &&
        previous.dpr === next.dpr &&
        previous.left === next.left &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    const resizes = new ResizeObserver(measure);
    resizes.observe(scroller);
    const unwatchPixelRatio = watchPixelRatio(measure);
    return () => {
      resizes.disconnect();
      unwatchPixelRatio();
    };
  }, []);

  // Requests the visible pages whenever they change (scrolling, resizing,
  // pages appearing or disappearing).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const visible = new Set<number>();
    /** Visible height of each visible page, updated at THRESHOLDS. */
    const shares = new Map<number, number>();
    let requested = '';
    /** 1 when the last scroll went down the document, -1 when up. */
    let direction = 1;
    let lastFirst = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) {
            visible.add(page);
            shares.set(page, entry.intersectionRect.height);
          } else {
            visible.delete(page);
            shares.delete(page);
          }
        }
        if (visible.size === 0) return;
        const shown = [...visible].sort((a, b) => a - b);
        const firstVisible = shown[0] ?? 1;
        // The page shown most, as in the PDF viewer; the first on a tie.
        setCurrent(
          shown.reduce((best, page) =>
            (shares.get(page) ?? 0) > (shares.get(best) ?? 0) ? page : best,
          ),
        );
        if (firstVisible !== lastFirst) direction = firstVisible > lastFirst ? 1 : -1;
        lastFirst = firstVisible;
        const first = Math.max(
          1,
          firstVisible - (direction > 0 ? PREFETCH_BEHIND : PREFETCH_AHEAD),
        );
        const last = Math.min(
          (shown.at(-1) ?? firstVisible) + (direction > 0 ? PREFETCH_AHEAD : PREFETCH_BEHIND),
          first + LIVE_MAX_PAGE_RANGE - 1,
        );
        const key = `${first}-${last}`;
        if (key !== requested) {
          requested = key;
          showPagesRef.current?.(first, last);
        }
      },
      { root: scroller, threshold: THRESHOLDS },
    );
    for (const slot of scroller.querySelectorAll('[data-page]')) observer.observe(slot);
    return () => observer.disconnect();
  }, [count, connection.state]);

  const fallbackSize = pages.get(current) ?? pages.values().next().value ?? DEFAULT_SIZE;
  /** Page size the zoom is worked out from. */
  const reference = { width: fallbackSize.width, height: fallbackSize.height };
  const geometry = useMemo(
    () => (pane === null ? null : slotGeometry(pane, zoom, reference)),
    // Only the reference's size matters, not the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pane, zoom, reference.width, reference.height],
  );
  const slots = Array.from({ length: count }, (_, index) => index + 1);
  /** Page size in PDF points: the page's own, or that of the pages around it. */
  const sizeOf = (page: number) => pages.get(page) ?? fallbackSize;
  const sizeOfRef = useRef(sizeOf);
  useEffect(() => {
    sizeOfRef.current = sizeOf;
  });

  // Live timing: a page is painted with the frame after its commit (canvases
  // are drawn in PdfPage's effect, which runs before this one).
  const paintMarked = useRef(new WeakSet<TimingKey>());
  useEffect(() => {
    if (!liveTimingOn) return;
    for (const shown of pages.values()) {
      if (shown.timing === undefined || paintMarked.current.has(shown.timing)) continue;
      paintMarked.current.add(shown.timing);
      liveMarkAfterPaint('painted', { ...shown.timing });
    }
  }, [pages]);

  /** Scroll position as page and share of its height, kept across zooms. */
  const anchor = useRef<{ page: number; fraction: number } | null>(null);
  const slotAt = (page: number) =>
    scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`) ?? null;
  const updateAnchor = () => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const top = scroller.scrollTop;
    const slot = [...scroller.querySelectorAll<HTMLElement>('[data-page]')].findLast(
      (element) => element.offsetTop <= top + PAGE_GAP,
    );
    if (slot === undefined) return;
    anchor.current = {
      page: Number(slot.dataset.page),
      fraction: (top - slot.offsetTop) / Math.max(1, slot.offsetHeight),
    };
  };

  // Pages are drawn at the slot width: again once a resize or zoom settles,
  // keeping the same part of the document in view.
  const drawnWidth = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (geometry === null) return;
    drawWidthRef.current = geometry.width;
    const previous = drawnWidth.current;
    drawnWidth.current = geometry.width;
    if (previous === null || previous === geometry.width) return;
    const position = anchor.current;
    const slot = position === null ? null : slotAt(position.page);
    if (position !== null && slot !== null) {
      scrollerRef.current?.scrollTo({
        top: slot.offsetTop + position.fraction * slot.offsetHeight,
      });
    }
    const timer = setTimeout(() => redrawRef.current?.(), RESIZE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [geometry]);

  // Open at the seed's page once the seed laid the pages out.
  const openedAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (openAt === null || openedAt.current === openAt) return;
    openedAt.current = openAt;
    const slot = slotAt(openAt);
    if (slot !== null) scrollerRef.current?.scrollTo({ top: slot.offsetTop - PAGE_GAP });
  }, [openAt]);

  const factor = geometry === null ? null : geometryZoom(geometry, reference);
  const shownPage = Math.min(current, count);
  const onViewChangeRef = useRef(onViewChange);
  useLayoutEffect(() => {
    onViewChangeRef.current = onViewChange;
  });
  useEffect(() => {
    onViewChangeRef.current?.({ page: shownPage, pages: count, zoom: factor, connection });
  }, [shownPage, count, factor, connection]);

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

  const goToPage = (page: number) => {
    const slot = slotAt(Math.min(Math.max(page, 1), count));
    if (slot !== null) scrollerRef.current?.scrollTo({ top: slot.offsetTop - PAGE_GAP });
  };
  const goToPageRef = useRef(goToPage);
  const currentRef = useRef(shownPage);
  useLayoutEffect(() => {
    goToPageRef.current = goToPage;
    currentRef.current = shownPage;
  });

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
      goToPage(page) {
        goToPageRef.current(page);
      },
      currentPage() {
        return currentRef.current;
      },
    }),
    [],
  );

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
      event.preventDefault();
      goToPage(shownPage + 1);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      goToPage(shownPage - 1);
    }
  };

  return (
    <div className="live-pane" data-testid="live-preview">
      <div
        className="live-pages"
        ref={scrollerRef}
        role="region"
        aria-label="Live pages"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={updateAnchor}
      >
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
                <PdfPage
                  page={rendered}
                  label={
                    rendered.compiled
                      ? `Page ${page} of the last compile`
                      : `Live preview of page ${page}`
                  }
                />
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
