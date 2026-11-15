/**
 * WebSocket compression for live preview (permessage-deflate, see
 * `liveSocketCompression` in src/app.ts). Sends the benchmark paper's pages,
 * rendered to SVG as packages/live-pdftex does, from the real server routes
 * to a client, with and without compression, and measures per page:
 * - bytes on the wire,
 * - the time from the server emitting a page to the client having parsed it,
 * - the server's CPU time (the client runs in a separate process).
 * Networks: loopback, and a proxy in the client process that adds a round
 * trip time and paces the server's bytes to a bandwidth.
 * Needs pdflatex and mutool. Run `pnpm bench:live-compression`; set
 * BENCH_ROUNDS to change repetitions (each round sends all 8 pages).
 */
import { execFileSync, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LiveServerMessage, ProjectDto } from '@myleaf/api';
import type { LivePreviewBackend, LivePreviewEvent } from '@myleaf/live-preview';
// Strips MuPDF's data-text attributes; live-pdftex's version also renames glyph ids.
import { sanitizeSvg } from '@myleaf/live-texpresso';
import { buildApp, LiveSessionPool } from '@myleaf/server';
import { FakeCompileBackend, InMemoryProjectStore } from '@myleaf/testing';
import WebSocket from 'ws';

interface Network {
  readonly name: string;
  /** `null`: loopback without the proxy. */
  readonly mbitPerSecond: number | null;
  readonly rttMs: number;
}
const NETWORKS: Network[] = [
  { name: 'loopback', mbitPerSecond: null, rttMs: 0 },
  { name: '100 Mbit/s, 10 ms RTT', mbitPerSecond: 100, rttMs: 10 },
  { name: '20 Mbit/s, 40 ms RTT', mbitPerSecond: 20, rttMs: 40 },
];

/** Parent to client process. */
type ToClient = { type: 'connect'; url: string; deflate: boolean; network: Network };
/** Client process to parent. */
type ToParent =
  | { type: 'connected'; extensions: string }
  | { type: 'page'; page: number; at: number }
  | { type: 'bytes'; bytes: number };

const now = () => performance.timeOrigin + performance.now();

/**
 * Forwards TCP between a local port and `target`, adding half the round trip
 * time each way and pacing server-to-client bytes to the bandwidth.
 */
async function startProxy(target: AddressInfo, network: Network): Promise<number> {
  const bytesPerMs = ((network.mbitPerSecond ?? 0) * 1e6) / 8 / 1000;
  const oneWay = network.rttMs / 2;
  const server = createServer((client) => {
    const upstream = createConnection(target.port, target.address);
    let linkFreeAt = 0;
    const forward = (from: Socket, to: Socket, paced: boolean) => {
      from.on('data', (chunk: Buffer) => {
        let delay = oneWay;
        if (paced) {
          linkFreeAt = Math.max(linkFreeAt, performance.now()) + chunk.length / bytesPerMs;
          delay += linkFreeAt - performance.now();
        }
        setTimeout(() => to.write(chunk), delay);
      });
      from.on('close', () => to.destroy());
    };
    forward(client, upstream, false);
    forward(upstream, client, true);
  });
  server.unref();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

async function runClient(): Promise<void> {
  const send = (message: ToParent) => process.send?.(message);
  const [message] = (await once(process, 'message')) as [ToClient];
  let url = message.url;
  if (message.network.mbitPerSecond !== null) {
    const target = new URL(url);
    const port = await startProxy(
      { address: target.hostname, port: Number(target.port), family: 'IPv4' },
      message.network,
    );
    target.port = String(port);
    url = target.toString();
  }
  const socket = new WebSocket(url, { perMessageDeflate: message.deflate });
  socket.on('message', (data: Buffer) => {
    const parsed = JSON.parse(data.toString('utf8')) as LiveServerMessage;
    if (parsed.type === 'page') send({ type: 'page', page: parsed.page, at: now() });
  });
  await once(socket, 'open');
  send({ type: 'connected', extensions: socket.extensions });
  process.on('message', (request: { type: string }) => {
    if (request.type === 'bytes') {
      // ws has no public accessor for its TCP socket.
      send({ type: 'bytes', bytes: (socket as unknown as { _socket: Socket })._socket.bytesRead });
    } else {
      socket.close();
      process.disconnect();
    }
  });
}

async function renderPages(): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'myleaf-live-compression-'));
  try {
    const paper = fileURLToPath(
      new URL('../../../packages/compile-texlive/bench/paper.tex', import.meta.url),
    );
    await copyFile(paper, join(dir, 'paper.tex'));
    // Twice, for cross references, as a live session's later runs have them.
    for (let i = 0; i < 2; i++) {
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'paper.tex'], {
        cwd: dir,
        stdio: 'ignore',
      });
    }
    execFileSync('mutool', ['draw', '-q', '-F', 'svg', '-o', 'page-%d.svg', 'paper.pdf'], {
      cwd: dir,
      stdio: 'ignore',
    });
    const pages: string[] = [];
    for (let page = 1; ; page++) {
      const raw = await readFile(join(dir, `page-${page}.svg`), 'utf8').catch(() => null);
      if (raw === null) return pages;
      pages.push(sanitizeSvg(raw));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function runParent(): Promise<void> {
  const rounds = Number(process.env.BENCH_ROUNDS ?? 10);
  const pages = await renderPages();
  const messageBytes = pages.map((svg) =>
    Buffer.byteLength(JSON.stringify({ type: 'page', page: 1, svg })),
  );
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  console.log(
    `${pages.length} pages, ${(average(messageBytes) / 1024).toFixed(0)} KB per page message on average ` +
      `(largest ${(Math.max(...messageBytes) / 1024).toFixed(0)} KB); ${rounds} rounds\n`,
  );

  let emit: (event: LivePreviewEvent) => void = () => {};
  const backend: LivePreviewBackend = {
    engine: 'pdflatex',
    open(_request, onEvent) {
      emit = onEvent;
      return Promise.resolve({
        updateFile() {},
        showPages() {},
        close: () => Promise.resolve(),
      });
    },
  };
  const app = buildApp({
    store: new InMemoryProjectStore(),
    compiler: new FakeCompileBackend(),
    livePreview: new LiveSessionPool(backend, { maxSessions: 1, idleMs: 3_600_000 }),
  });
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Bench' } })
  ).json<ProjectDto>();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `${address.replace('http', 'ws')}/api/projects/${project.id}/live`;

  console.log(
    '| Network | Compression | KB per page on the wire | Median ms emit to parsed | Server CPU ms per page |',
  );
  console.log('| --- | --- | --: | --: | --: |');
  for (const network of NETWORKS) {
    for (const deflate of [false, true]) {
      const client: ChildProcess = fork(fileURLToPath(import.meta.url), ['client']);
      const next = <T extends ToParent['type']>(type: T) =>
        new Promise<Extract<ToParent, { type: T }>>((resolve) => {
          const listener = (message: ToParent) => {
            if (message.type !== type) return;
            client.off('message', listener);
            resolve(message as Extract<ToParent, { type: T }>);
          };
          client.on('message', listener);
        });
      const connected = next('connected');
      client.send({ type: 'connect', url, deflate, network } satisfies ToClient);
      const { extensions } = await connected;
      if ((extensions !== '') !== deflate) throw new Error(`unexpected extensions: ${extensions}`);

      const send = async (page: number) => {
        const received = next('page');
        const start = now();
        emit({ type: 'page', page, svg: pages[page - 1]! });
        return (await received).at - start;
      };
      // Warm up: the first page also carries the connection's start-up.
      for (let page = 1; page <= pages.length; page++) await send(page);

      const bytesBefore = next('bytes');
      client.send({ type: 'bytes' });
      const before = (await bytesBefore).bytes;
      const cpuBefore = process.cpuUsage();
      const times: number[] = [];
      for (let round = 0; round < rounds; round++) {
        for (let page = 1; page <= pages.length; page++) times.push(await send(page));
      }
      const cpu = process.cpuUsage(cpuBefore);
      const bytesAfter = next('bytes');
      client.send({ type: 'bytes' });
      const sent = (await bytesAfter).bytes - before;
      client.send({ type: 'close' });
      await once(client, 'exit');

      const count = rounds * pages.length;
      console.log(
        `| ${network.name} | ${deflate ? 'on' : 'off'} | ${(sent / count / 1024).toFixed(1)} | ` +
          `${median(times).toFixed(1)} | ${((cpu.user + cpu.system) / 1000 / count).toFixed(2)} |`,
      );
    }
  }
  await app.close();
}

if (process.argv[2] === 'client') {
  await runClient();
} else {
  await runParent();
}
