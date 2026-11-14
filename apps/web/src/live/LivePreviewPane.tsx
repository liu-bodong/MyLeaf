import type { LiveClientMessage, LiveServerMessage } from '@myleaf/api';
import type { ProjectId } from '@myleaf/doc-model';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { LiveChannel } from './live-channel.js';

interface LivePreviewPaneProps {
  readonly projectId: ProjectId;
  readonly channel: LiveChannel;
  /** Called once the session runs, so the latest unsaved text can be sent. */
  readonly onReady: () => void;
}

type Connection =
  | { readonly state: 'connecting' }
  | { readonly state: 'live' }
  | { readonly state: 'ended'; readonly message: string };

interface RenderedPage {
  readonly page: number;
  readonly url: string;
}

/**
 * Live-rendered pages over the project's live-preview WebSocket (ADR 0012).
 * Mounted only while live preview is on, so each mount is one session.
 */
export function LivePreviewPane({ projectId, channel, onReady }: LivePreviewPaneProps) {
  const [connection, setConnection] = useState<Connection>({ state: 'connecting' });
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [page, setPage] = useState(1);
  const socketRef = useRef<WebSocket | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const socket = new WebSocket(api.livePreviewUrl(projectId));
    socketRef.current = socket;
    let ended = false;
    let url: string | null = null;
    const end = (message: string) => {
      ended = true;
      setConnection({ state: 'ended', message });
    };

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as LiveServerMessage;
      if (message.type === 'page') {
        const next = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
        if (url !== null) URL.revokeObjectURL(url);
        url = next;
        setRendered({ page: message.page, url: next });
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
      unsubscribe();
      socket.close();
      socketRef.current = null;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [projectId, channel]);

  const goTo = (target: number) => {
    const next = Math.max(1, target);
    setPage(next);
    const message: LiveClientMessage = { type: 'page', page: next };
    socketRef.current?.send(JSON.stringify(message));
  };

  return (
    <div className="live-pane" data-testid="live-preview">
      <header>
        <span className="live-badge">Live · XeLaTeX</span>
        <button onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Previous page">
          ◀
        </button>
        <span data-testid="live-page">Page {rendered?.page ?? page}</span>
        <button onClick={() => goTo(page + 1)} aria-label="Next page">
          ▶
        </button>
        <span className="live-status" role="status">
          {connection.state === 'connecting' && 'Starting…'}
          {connection.state === 'ended' && connection.message}
        </span>
      </header>
      <div className="live-page">
        {rendered !== null ? (
          <img src={rendered.url} alt={`Live preview of page ${rendered.page}`} />
        ) : (
          connection.state !== 'ended' && <p className="placeholder">Rendering…</p>
        )}
      </div>
    </div>
  );
}
