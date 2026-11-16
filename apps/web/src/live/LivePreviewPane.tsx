import { LIVE_MAX_PAGE_RANGE } from '@myleaf/api';
import type { LiveClientMessage, LiveServerMessage } from '@myleaf/api';
import type { TexEngine } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { engineName } from './engine-name.js';
import type { LiveChannel } from './live-channel.js';
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
}

type Connection =
  | { readonly state: 'connecting' }
  | { readonly state: 'live' }
  | { readonly state: 'ended'; readonly message: string };

interface LivePage {
  readonly url: string;
  /** Page size from the SVG, in its units (pt); sets the slot's aspect ratio. */
  readonly width: number;
  readonly height: number;
}

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
}: LivePreviewPaneProps) {
  const [connection, setConnection] = useState<Connection>({ state: 'connecting' });
  const [pages, setPages] = useState<ReadonlyMap<number, LivePage>>(new Map());
  /** Pages being typeset again since their image was rendered: shown dimmed. */
  const [stale, setStale] = useState<ReadonlySet<number>>(new Set());
  /** Pages to lay out: the final count, or the most seen while re-typesetting. */
  const [count, setCount] = useState(1);
  const [current, setCurrent] = useState(1);
  const socketRef = useRef<WebSocket | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const socket = new WebSocket(api.livePreviewUrl(projectId));
    socketRef.current = socket;
    let ended = false;
    let closed = false;
    const live = new Map<number, LivePage>();
    /** Page messages received per page; a decoded image is shown only if it is the latest. */
    const received = new Map<number, number>();
    const staleNow = new Set<number>();
    const end = (message: string) => {
      ended = true;
      setConnection({ state: 'ended', message });
    };

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as LiveServerMessage;
      if (message.type === 'page') {
        const { page } = message;
        const sequence = (received.get(page) ?? 0) + 1;
        received.set(page, sequence);
        if (message.stale) staleNow.add(page);
        else staleNow.delete(page);
        setStale(new Set(staleNow));
        const url = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
        const size = svgSize(message.svg) ?? DEFAULT_SIZE;
        // Decoded before it replaces the shown image, so the page does not flash blank.
        const image = new Image();
        image.src = url;
        void image
          .decode()
          .catch(() => {})
          .then(() => {
            if (closed || received.get(page) !== sequence) {
              URL.revokeObjectURL(url);
              return;
            }
            const previous = live.get(page);
            if (previous !== undefined) URL.revokeObjectURL(previous.url);
            live.set(page, { url, ...size });
            setPages(new Map(live));
          });
      } else if (message.type === 'page-unchanged') {
        staleNow.delete(message.page);
        setStale(new Set(staleNow));
      } else if (message.type === 'stale') {
        for (const page of received.keys()) if (page >= message.from) staleNow.add(page);
        setStale(new Set(staleNow));
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
      for (const page of live.values()) URL.revokeObjectURL(page.url);
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
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
            >
              {rendered !== undefined ? (
                <img src={rendered.url} alt={`Live preview of page ${page}`} />
              ) : (
                connection.state !== 'ended' && <p className="placeholder">Rendering…</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
