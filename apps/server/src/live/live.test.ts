import type { LiveServerMessage, ProjectDto } from '@myleaf/api';
import type {
  LivePreviewBackend,
  LivePreviewEvent,
  LivePreviewRequest,
  LivePreviewSession,
} from '@myleaf/live-preview';
import type { ProjectFile } from '@myleaf/project';
import { FakeCompileBackend, InMemoryProjectStore } from '@myleaf/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket as WsSocket } from 'ws';
import { buildApp } from '../app.js';
import { LiveSessionPool } from './live-session-pool.js';

class FakeLiveSession implements LivePreviewSession {
  readonly request: LivePreviewRequest;
  readonly emit: (event: LivePreviewEvent) => void;
  readonly updates: ProjectFile[] = [];
  readonly ranges: [number, number][] = [];
  closed = false;

  constructor(request: LivePreviewRequest, emit: (event: LivePreviewEvent) => void) {
    this.request = request;
    this.emit = emit;
  }
  updateFile(file: ProjectFile): void {
    this.updates.push(file);
  }
  showPages(first: number, last: number): void {
    this.ranges.push([first, last]);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakeLivePreview implements LivePreviewBackend {
  readonly sessions: FakeLiveSession[] = [];
  open(request: LivePreviewRequest, onEvent: (e: LivePreviewEvent) => void) {
    const session = new FakeLiveSession(request, onEvent);
    this.sessions.push(session);
    return Promise.resolve(session);
  }
}

const text = (file: ProjectFile | undefined) => new TextDecoder().decode(file?.content);

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('LiveSessionPool', () => {
  const request = (projectId: string) => ({
    projectId: projectId as ProjectDto['id'],
    rootFile: 'main.tex' as ProjectDto['rootFile'],
    files: [],
  });

  it('refuses sessions beyond its capacity until one closes', async () => {
    const pool = new LiveSessionPool(new FakeLivePreview(), { maxSessions: 1, idleMs: 60_000 });
    const first = await pool.open(
      request('a'),
      () => {},
      () => {},
    );
    expect(
      await pool.open(
        request('b'),
        () => {},
        () => {},
      ),
    ).toBeNull();
    await first?.close();
    expect(
      await pool.open(
        request('b'),
        () => {},
        () => {},
      ),
    ).not.toBeNull();
    await pool.closeAll();
    expect(pool.size).toBe(0);
  });

  it('closes sessions after the idle time, unless touched', async () => {
    const backend = new FakeLivePreview();
    const pool = new LiveSessionPool(backend, { maxSessions: 2, idleMs: 60 });
    let idle = 0;
    const handle = await pool.open(
      request('a'),
      () => {},
      () => idle++,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    handle?.touch();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(backend.sessions[0]?.closed).toBe(false);
    await until(() => (idle === 1 ? true : undefined), 'idle close');
    expect(backend.sessions[0]?.closed).toBe(true);
    expect(pool.forProject(request('a').projectId)).toEqual([]);
  });
});

describe('live preview routes', () => {
  let app: FastifyInstance;
  let backend: FakeLivePreview;
  let compiler: FakeCompileBackend;
  let project: ProjectDto;
  const sockets: WsSocket[] = [];

  const start = async (
    options: { maxSessions?: number; idleMs?: number; enabled?: boolean } = {},
  ) => {
    backend = new FakeLivePreview();
    compiler = new FakeCompileBackend();
    const pool =
      options.enabled === false
        ? null
        : new LiveSessionPool(backend, {
            maxSessions: options.maxSessions ?? 4,
            idleMs: options.idleMs ?? 60_000,
          });
    app = buildApp({
      store: new InMemoryProjectStore(),
      compiler,
      livePreview: pool,
    });
    await app.ready();
    project = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Live' } })
    ).json();
  };

  /** Connects and collects server messages. */
  const connect = async () => {
    const messages: LiveServerMessage[] = [];
    let closedWith: number | null = null;
    // Listen from the start: the server may send its first message immediately.
    const socket = await app.injectWS(
      `/api/projects/${project.id}/live`,
      {},
      {
        onInit: (ws) => {
          ws.on('message', (data: Buffer) =>
            messages.push(JSON.parse(data.toString()) as LiveServerMessage),
          );
          ws.on('close', (code: number) => (closedWith = code));
        },
      },
    );
    sockets.push(socket);
    return { socket, messages, closed: () => closedWith };
  };

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await app.close();
  });

  it('reports whether live preview is available', async () => {
    await start({ enabled: false });
    expect((await app.inject({ method: 'GET', url: '/api/live-preview' })).json()).toEqual({
      available: false,
    });
    const { messages } = await connect();
    await until(() => messages.find((m) => m.type === 'status'), 'status');
    expect(messages[0]).toMatchObject({ type: 'status', state: 'unavailable' });
  });

  it('starts a session with the project files and relays edits, pages and renders', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/api/live-preview' })).json()).toEqual({
      available: true,
    });
    const { socket, messages } = await connect();
    await until(
      () => messages.find((m) => m.type === 'status' && m.state === 'starting'),
      'starting',
    );
    const session = backend.sessions[0]!;
    expect(session.request).toMatchObject({ projectId: project.id, rootFile: 'main.tex' });
    expect(session.request.files.map((f) => f.path)).toEqual(['main.tex']);

    socket.send(JSON.stringify({ type: 'update', path: 'main.tex', content: 'edited' }));
    socket.send(JSON.stringify({ type: 'pages', first: 3, last: 5 }));
    await until(() => (session.ranges.length > 0 ? true : undefined), 'page request');
    expect(text(session.updates[0])).toBe('edited');
    expect(session.ranges).toEqual([[3, 5]]);

    session.emit({ type: 'page', page: 3, svg: '<svg/>' });
    session.emit({ type: 'page-count', count: 7, final: true });
    await until(() => messages.find((m) => m.type === 'page-count'), 'page count');
    expect(messages.slice(-2)).toEqual([
      { type: 'page', page: 3, svg: '<svg/>' },
      { type: 'page-count', count: 7, final: true },
    ]);
  });

  it('closes the session when the browser disconnects', async () => {
    // A real connection: closing an injected socket does not reach the server.
    await start();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const browser = new WebSocket(
      `${address.replace('http', 'ws')}/api/projects/${project.id}/live`,
    );
    await new Promise((resolve) => browser.addEventListener('message', resolve, { once: true }));
    const session = await until(() => backend.sessions[0], 'session');
    browser.close();
    await until(() => (session.closed ? true : undefined), 'session close');
  });

  it('passes saved files and uploads to open sessions', async () => {
    await start();
    const { messages } = await connect();
    await until(() => messages.find((m) => m.type === 'status'), 'starting');
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/fig.png`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from([1, 2, 3]),
    });
    expect(backend.sessions[0]?.updates.map((f) => [f.path, [...f.content]])).toEqual([
      ['fig.png', [1, 2, 3]],
    ]);
  });

  it('starts sessions with the latest bibliography, replacing a stored one', async () => {
    await start();
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/main.bbl`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('stored'),
    });
    compiler.bibliography = {
      path: 'main.bbl' as ProjectFile['path'],
      content: new TextEncoder().encode('compiled'),
    };
    const { messages } = await connect();
    await until(() => messages.find((m) => m.type === 'status'), 'starting');
    const files = backend.sessions[0]?.request.files ?? [];
    expect(files.filter((f) => f.path === 'main.bbl').map(text)).toEqual(['compiled']);
  });

  it('sends the bibliography of each compile to open sessions', async () => {
    await start();
    const { messages } = await connect();
    await until(() => messages.find((m) => m.type === 'status'), 'starting');
    compiler.bibliography = {
      path: 'main.bbl' as ProjectFile['path'],
      content: new TextEncoder().encode('\\bibitem{knuth}'),
    };
    await app.inject({ method: 'POST', url: `/api/projects/${project.id}/compile` });
    const updates = backend.sessions[0]?.updates ?? [];
    expect(updates.map((f) => [f.path, text(f)])).toEqual([['main.bbl', '\\bibitem{knuth}']]);
  });

  it('turns connections away when the pool is full', async () => {
    await start({ maxSessions: 1 });
    const first = await connect();
    await until(() => first.messages.find((m) => m.type === 'status'), 'first');
    const second = await connect();
    await until(() => second.messages.find((m) => m.type === 'status'), 'second');
    expect(second.messages[0]).toMatchObject({ type: 'status', state: 'busy' });
    expect(backend.sessions).toHaveLength(1);
  });

  it('closes on invalid messages and paths', async () => {
    await start();
    const bad = await connect();
    await until(() => bad.messages.find((m) => m.type === 'status'), 'starting');
    bad.socket.send('{"type":"update","path":"../etc/passwd","content":"x"}');
    expect(await until(() => bad.closed() ?? undefined, 'close')).toBe(1008);
    const range = await connect();
    await until(() => range.messages.find((m) => m.type === 'status'), 'starting');
    range.socket.send(JSON.stringify({ type: 'pages', first: 1, last: 21 }));
    expect(await until(() => range.closed() ?? undefined, 'close')).toBe(1003);
    const garbage = await connect();
    await until(() => garbage.messages.find((m) => m.type === 'status'), 'starting');
    garbage.socket.send('not json');
    expect(await until(() => garbage.closed() ?? undefined, 'close')).toBe(1003);
  });

  it('stops idle sessions and tells the browser', async () => {
    await start({ idleMs: 50 });
    const { messages } = await connect();
    const stopped = await until(
      () => messages.find((m) => m.type === 'status' && m.state === 'stopped'),
      'stopped',
    );
    expect(stopped).toMatchObject({ message: 'Closed after inactivity' });
    expect(backend.sessions[0]?.closed).toBe(true);
  });
});
