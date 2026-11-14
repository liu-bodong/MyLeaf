import type { LiveClientMessage, LivePreviewInfo, LiveServerMessage } from '@myleaf/api';
import type { CompileBackend } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { LiveSessionHandle, LiveSessionPool } from '../live/live-session-pool.js';

const send = (socket: WebSocket, message: LiveServerMessage) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
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
      message.type === 'page' &&
      Number.isInteger(message.page) &&
      (message.page as number) >= 1
    ) {
      return { type: 'page', page: message.page as number };
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
): void {
  app.get('/api/live-preview', (): LivePreviewInfo => ({ available: pool !== null }));

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
      const apply = (message: LiveClientMessage) => {
        if (handle === null) {
          pending.push(message);
          return;
        }
        handle.touch();
        if (message.type === 'update') {
          handle.session.updateFile({
            path: parseProjectPath(message.path),
            content: new TextEncoder().encode(message.content),
          });
        } else {
          handle.session.showPage(message.page);
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
      const files =
        bibliography === null
          ? stored
          : [...stored.filter((file) => file.path !== bibliography.path), bibliography];
      handle = await pool.open(
        { projectId, rootFile: project.rootFile, files },
        (event) => {
          if (event.type === 'page') {
            send(socket, { type: 'page', page: event.page, svg: event.svg });
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
      for (const message of pending.splice(0)) apply(message);
    },
  );
}
