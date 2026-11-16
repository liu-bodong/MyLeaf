import { LIVE_MAX_PAGE_RANGE, encodeLiveBinary } from '@myleaf/api';
import type { LiveClientMessage, LivePreviewInfo, LiveServerMessage } from '@myleaf/api';
import type { CompileBackend } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { LiveFonts } from '../live/live-fonts.js';
import type { LiveSessionHandle, LiveSessionPool } from '../live/live-session-pool.js';
import type { LiveSources } from '../live/live-sources.js';

const send = (socket: WebSocket, message: LiveServerMessage) => {
  if (socket.readyState !== socket.OPEN) return;
  const binary = message.type === 'font' || (message.type === 'page' && 'pdf' in message);
  socket.send(binary ? encodeLiveBinary(message) : JSON.stringify(message));
};

function parseClientMessage(raw: string): LiveClientMessage | null {
  try {
    const message = JSON.parse(raw) as Partial<Record<string, unknown>>;
    if (
      message.type === 'update' &&
      typeof message.path === 'string' &&
      typeof message.content === 'string'
    ) {
      return { type: 'update', path: message.path, content: message.content };
    }
    if (
      message.type === 'forward' &&
      Number.isInteger(message.id) &&
      typeof message.path === 'string' &&
      Number.isInteger(message.line) &&
      (message.column === null || Number.isInteger(message.column))
    ) {
      return {
        type: 'forward',
        id: message.id as number,
        path: message.path,
        line: message.line as number,
        column: message.column as number | null,
      };
    }
    if (
      message.type === 'inverse' &&
      Number.isInteger(message.id) &&
      Number.isInteger(message.page) &&
      Number.isFinite(message.x) &&
      Number.isFinite(message.y)
    ) {
      return {
        type: 'inverse',
        id: message.id as number,
        page: message.page as number,
        x: message.x as number,
        y: message.y as number,
      };
    }
    if (
      message.type === 'pages' &&
      Number.isInteger(message.first) &&
      Number.isInteger(message.last)
    ) {
      const first = message.first as number;
      const last = message.last as number;
      if (first >= 1 && last >= first && last - first < LIVE_MAX_PAGE_RANGE) {
        return { type: 'pages', first, last };
      }
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/**
 * Live preview over a WebSocket per open project (ADR 0012). The browser
 * sends edits and the page it shows; the server pushes rendered pages.
 * `pool` is `null` when the server does not offer live preview.
 */
export function registerLiveRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  compiler: CompileBackend,
  pool: LiveSessionPool | null,
  sources: LiveSources | null = null,
): void {
  app.get('/api/live-preview', (): LivePreviewInfo => ({
    available: pool !== null,
    engine: pool?.engine ?? null,
    maxSnapshots: pool?.maxSnapshots ?? null,
    synctex: pool?.synctex ?? false,
  }));

  app.get<{ Params: { id: string } }>(
    '/api/projects/:id/live',
    { websocket: true },
    async (socket, request) => {
      if (pool === null) {
        send(socket, {
          type: 'status',
          state: 'unavailable',
          message: 'Live preview is not enabled on this server',
        });
        socket.close();
        return;
      }
      const projectId = ProjectId(request.params.id);
      const project = await store.getProject(projectId);
      if (project === null) {
        socket.close(1008, 'Project not found');
        return;
      }

      // Messages that arrive while the session starts are applied once it is ready.
      const pending: LiveClientMessage[] = [];
      let handle: LiveSessionHandle | null = null;
      let socketClosed = false;
      const fonts = new LiveFonts();
      const apply = (message: LiveClientMessage) => {
        if (handle === null) {
          pending.push(message);
          return;
        }
        handle.touch();
        const { session } = handle;
        if (message.type === 'update') {
          const file = {
            path: parseProjectPath(message.path),
            content: new TextEncoder().encode(message.content),
          };
          session.updateFile(sources ? sources.text(project, file) : file);
        } else if (message.type === 'pages') {
          session.showPages(message.first, message.last);
        } else if (message.type === 'forward') {
          const { id, line, column } = message;
          const location = { file: parseProjectPath(message.path), line, column };
          void (session.forwardSearch?.(location) ?? Promise.resolve([]))
            .catch(() => [])
            .then((rects) => send(socket, { type: 'forward-result', id, rects }));
        } else {
          const { id, page, x, y } = message;
          void (session.inverseSearch?.({ page, x, y }) ?? Promise.resolve(null))
            .catch(() => null)
            .then((location) => send(socket, { type: 'inverse-result', id, location }));
        }
      };
      socket.on('message', (data: Buffer) => {
        const message = parseClientMessage(data.toString('utf8'));
        if (message === null) {
          socket.close(1003, 'Invalid message');
          return;
        }
        try {
          apply(message);
        } catch {
          socket.close(1008, 'Invalid file path');
        }
      });
      socket.on('close', () => {
        socketClosed = true;
        void handle?.close();
      });

      const entries = await store.listFiles(projectId);
      const stored = await Promise.all(
        entries.map(async ({ path }) => ({ path, content: await store.readFile(projectId, path) })),
      );
      // Citations come from the latest compile's bibliography (TeXpresso does
      // not run BibTeX); it replaces a stored file of the same name.
      const bibliography = await compiler.readBibliography(projectId);
      const all =
        bibliography === null
          ? stored
          : [...stored.filter((file) => file.path !== bibliography.path), bibliography];
      // The project's image options (draft, converted images).
      const { files, convert } = sources
        ? await sources.files(project, all)
        : { files: all, convert: () => {} };
      handle = await pool.open(
        {
          projectId,
          rootFile: project.rootFile,
          files,
          ...(project.settings.liveSnapshots === null
            ? {}
            : { maxSnapshots: project.settings.liveSnapshots }),
        },
        (event) => {
          if (event.type === 'page' && 'pdf' in event) {
            const { page, pdf, stale } = event;
            // Fonts the page leaves out go first, once per connection.
            for (const message of fonts.send(event.fonts ?? [])) send(socket, message);
            const ids = event.fonts?.length ? { fonts: event.fonts.map((font) => font.id) } : {};
            send(
              socket,
              stale
                ? { type: 'page', page, pdf, ...ids, stale }
                : { type: 'page', page, pdf, ...ids },
            );
          } else if (event.type === 'page') {
            send(
              socket,
              event.stale
                ? { type: 'page', page: event.page, svg: event.svg, stale: true }
                : { type: 'page', page: event.page, svg: event.svg },
            );
          } else if (event.type === 'page-unchanged') {
            send(socket, { type: 'page-unchanged', page: event.page });
          } else if (event.type === 'stale') {
            send(socket, { type: 'stale', from: event.from });
          } else if (event.type === 'page-count') {
            send(socket, { type: 'page-count', count: event.count, final: event.final });
          } else {
            send(socket, { type: 'status', state: 'stopped', message: event.reason });
            socket.close();
          }
        },
        () => {
          send(socket, { type: 'status', state: 'stopped', message: 'Closed after inactivity' });
          socket.close();
        },
      );
      if (handle === null) {
        send(socket, { type: 'status', state: 'busy', message: 'Too many live previews are open' });
        socket.close();
        return;
      }
      if (socketClosed) {
        await handle.close();
        return;
      }
      send(socket, { type: 'status', state: 'starting' });
      // Images converted meanwhile replace the originals, unless they were replaced.
      convert((converted, original) => {
        void store.readFile(projectId, original.path).then(
          (current) => {
            if (!socketClosed && Buffer.from(current).equals(original.content)) {
              handle?.session.updateFile(converted);
            }
          },
          () => {},
        );
      });
      for (const message of pending.splice(0)) apply(message);
    },
  );
}
