/**
 * Keystroke to screen for each live-preview engine, side by side, split into
 * stages: the same document, the same typing, in a real browser at the
 * device pixel ratios asked for. Answers where TeXpresso's lead over pdfTeX
 * comes from (browser drawing, engine, server work, transport).
 *
 * For each engine (BENCH_ENGINES, default "texpresso,pdftex"), it starts the
 * built server with MYLEAF_LIVE_TIMING and MYLEAF_LIVE_TRACE, serves the
 * built web client with `vite preview`, creates a project with the benchmark
 * paper (packages/compile-texlive/bench/paper.tex), turns live preview on and,
 * for each spot and pixel ratio:
 *
 * - isolated keys: BENCH_KEYS keys (default 10), BENCH_GAP ms apart
 *   (default 1500), each timed from the key to the page painted with it;
 * - a burst: BENCH_BURST keys (default 25) BENCH_BURST_INTERVAL ms apart
 *   (default 80): page updates during it, and last key to last paint.
 *
 * Spots: "top" types in the first paragraph (page 1); "late" types in the
 * last paragraph before Section 5, further down a page. Where each one lands
 * comes from SyncTeX on a pdfLaTeX compile.
 *
 * Stages per isolated key (medians):
 *   key -> send      editor and React, until the edit goes on the WebSocket
 *   send -> server   the edit reaches the live route
 *   server -> page   engine and server work until the page event
 *   page -> recv     WebSocket (deflate) and the browser's message queue
 *   recv -> drawn    SVG decode, or MuPDF parse + raster + text in the worker
 *   drawn -> painted React commit, canvas copy, next frame
 *
 * Build first (the npm script does): the server and the web client, and the
 * engines with vendor/texpresso/build.sh and vendor/pdftex/build.sh. Then
 *
 *   pnpm bench:live-engines
 *
 * Other settings: BENCH_DPRS (default "2,1"), BENCH_SPOTS ("top,late"),
 * BENCH_HEADED (1 shows the browser; default on macOS), BENCH_CHANNEL
 * ("chrome" uses the installed Google Chrome instead of Playwright's
 * Chromium), BENCH_OUT (directory for the raw marks and traces; default a
 * new temporary directory). MYLEAF_TEXPRESSO and MYLEAF_PDFTEX pass through.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const API_PORT = Number(process.env.BENCH_API_PORT ?? 3290);
const WEB_PORT = Number(process.env.BENCH_WEB_PORT ?? 5290);
const api = `http://127.0.0.1:${API_PORT}`;
const web = `http://127.0.0.1:${WEB_PORT}`;
const list = (value: string | undefined, fallback: string) =>
  (value ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const engines = list(process.env.BENCH_ENGINES, 'texpresso,pdftex');
const dprs = list(process.env.BENCH_DPRS, '2,1').map(Number);
const spots = list(process.env.BENCH_SPOTS, 'top,late');
const KEYS = Number(process.env.BENCH_KEYS ?? 10);
const GAP = Number(process.env.BENCH_GAP ?? 1500);
const BURST = Number(process.env.BENCH_BURST ?? 25);
const BURST_INTERVAL = Number(process.env.BENCH_BURST_INTERVAL ?? 80);
const headed = (process.env.BENCH_HEADED ?? (process.platform === 'darwin' ? '1' : '0')) === '1';
const channel = process.env.BENCH_CHANNEL || undefined;
const out = process.env.BENCH_OUT ?? (await mkdtemp(join(tmpdir(), 'myleaf-live-engines-')));
await mkdir(out, { recursive: true });

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const median = (values: readonly number[]) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const ms = (value: number) => (Number.isFinite(value) ? `${Math.round(value)}` : '-');

// The document: the benchmark paper with a marker word at each spot.
const MARKERS = { top: 'Benchtop', late: 'Benchlate' } as const;
type Spot = keyof typeof MARKERS;
/** US Letter, in points (the paper's page size). */
const PAGE_HEIGHT = 792;
const paper = await readFile(join(repo, 'packages/compile-texlive/bench/paper.tex'), 'utf8');
const paperLines = paper.split('\n');
/** The paper with the "top" marker, and the "late" one on line `late` (0-based), if any. */
const withMarkers = (late: number | null) => {
  const lines = [...paperLines];
  const first = lines.findIndex((line) => line.startsWith('\\section{Section 1}')) + 1;
  lines[first] = `${MARKERS.top} ${lines[first]}`;
  if (late !== null) lines[late] = `${MARKERS.late} ${lines[late]}`;
  return lines.join('\n');
};
/** Set by chooseLateSpot() once a server runs. */
let source = withMarkers(null);
const markerLine = (spot: Spot) =>
  source.split('\n').findIndex((line) => line.startsWith(MARKERS[spot])) + 1;

/** The DOM element method used in the page (this file is type-checked without the DOM). */
interface ScrollTarget {
  scrollIntoView(options: { block: 'start' }): void;
}

interface Mark {
  readonly t: number;
  readonly kind: string;
  readonly page?: number;
  readonly sequence?: number;
  readonly stale?: boolean;
  readonly bytes?: number;
  readonly pixels?: number;
  readonly open?: number;
  readonly draw?: number;
  readonly bitmap?: number;
  readonly text?: number;
}

function start(command: string, args: string[], env: Record<string, string>, cwd = repo) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-4000);
  });
  return { child, errors: () => errors };
}

async function waitFor(url: string, child: ChildProcess, errors: () => string) {
  for (let tries = 0; tries < 300; tries++) {
    if (child.exitCode !== null) throw new Error(`${url}: exited\n${errors()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }
  throw new Error(`${url} did not come up\n${errors()}`);
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, init);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** Page and vertical position (share of the page height) of each spot, from SyncTeX. */
async function locate(id: string): Promise<Record<Spot, { page: number; y: number }>> {
  await json(`/api/projects/${id}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ engine: 'pdflatex' }),
  });
  const result = {} as Record<Spot, { page: number; y: number }>;
  for (const spot of Object.keys(MARKERS) as Spot[]) {
    const { rects } = await json<{ rects: { page: number; y: number }[] }>(
      `/api/projects/${id}/synctex/forward`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'main.tex', line: markerLine(spot), column: null }),
      },
    );
    const rect = rects[0];
    if (!rect) throw new Error(`SyncTeX found no page for ${spot}`);
    result[spot] = { page: rect.page, y: rect.y / PAGE_HEIGHT };
  }
  return result;
}

/**
 * Puts the "late" marker at the start of the paragraph that starts lowest on
 * a page after the first (at most 85% down), from SyncTeX on a pdfLaTeX
 * compile: there, pdfTeX resumes from the top of the page.
 */
async function chooseLateSpot(): Promise<void> {
  const id = await newProject('spots');
  await json(`/api/projects/${id}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ engine: 'pdflatex' }),
  });
  let best: { line: number; y: number } | null = null;
  for (const [index, line] of paperLines.entries()) {
    if (!line.startsWith('Lorem ipsum')) continue;
    const { rects } = await json<{ rects: { page: number; y: number }[] }>(
      `/api/projects/${id}/synctex/forward`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'main.tex', line: index + 1, column: null }),
      },
    );
    const rect = rects[0];
    if (!rect || rect.page < 2 || rect.y / PAGE_HEIGHT > 0.85) continue;
    if (best === null || rect.y > best.y) best = { line: index, y: rect.y };
  }
  if (best === null) throw new Error('No paragraph found for the "late" spot');
  source = withMarkers(best.line);
}

async function newProject(name: string): Promise<string> {
  const { id } = await json<{ id: string }>('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const put = await fetch(`${api}/api/projects/${id}/files/main.tex`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: source,
  });
  if (!put.ok) throw new Error(`upload: ${put.status}`);
  await json(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { livePreview: true } }),
  });
  return id;
}

/** Puts the editor's cursor right after `word`, with CodeMirror's search. */
async function placeCursor(page: Page, word: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+f');
  const field = page.locator('.cm-search input[name="search"]');
  // Typed, not filled: the panel reads its query on key events.
  await field.fill('');
  await field.pressSequentially(word);
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
}

async function readServerMarks(path: string, from: number): Promise<Mark[]> {
  const text = await readFile(path, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Mark)
    .filter((mark) => mark.t >= from);
}

interface KeyTiming {
  keySend: number;
  sendServer: number;
  serverPage: number;
  pageRecv: number;
  recvDrawn: number;
  drawnPainted: number;
  total: number;
  bytes: number;
  pixels: number;
  open: number;
  draw: number;
  bitmap: number;
  text: number;
}

/** Joins browser and server marks for each key: the first fresh page `target` after it. */
function analyseKeys(
  keys: readonly number[],
  browser: readonly Mark[],
  server: readonly Mark[],
  target: number,
): (KeyTiming | null)[] {
  const after = (
    marks: readonly Mark[],
    kind: string,
    t: number,
    until: number,
    test: (mark: Mark) => boolean = () => true,
  ) => marks.find((mark) => mark.kind === kind && mark.t >= t && mark.t < until && test(mark));
  return keys.map((key, index) => {
    const until = keys[index + 1] ?? Infinity;
    const send = after(browser, 'send', key, until);
    if (!send) return null;
    // Same machine, same clock; allow for rounding.
    const update = after(server, 'update', send.t - 2, until);
    if (!update) return null;
    const pageEvent = after(
      server,
      'page',
      update.t,
      until,
      (mark) => mark.page === target && !mark.stale,
    );
    if (!pageEvent) return null;
    const recv = after(
      browser,
      'recv',
      pageEvent.t - 2,
      until,
      (mark) => mark.page === target && !mark.stale,
    );
    if (!recv) return null;
    const same = (mark: Mark) => mark.page === target && mark.sequence === recv.sequence;
    const drawn = after(browser, 'drawn', recv.t, Infinity, same);
    const painted = after(browser, 'painted', recv.t, Infinity, same);
    if (!drawn || !painted) return null;
    return {
      keySend: send.t - key,
      sendServer: update.t - send.t,
      serverPage: pageEvent.t - update.t,
      pageRecv: recv.t - pageEvent.t,
      recvDrawn: drawn.t - recv.t,
      drawnPainted: painted.t - drawn.t,
      total: painted.t - key,
      bytes: recv.bytes ?? NaN,
      pixels: drawn.pixels ?? NaN,
      open: drawn.open ?? NaN,
      draw: drawn.draw ?? NaN,
      bitmap: drawn.bitmap ?? NaN,
      text: drawn.text ?? NaN,
    };
  });
}

interface Row {
  engine: string;
  dpr: number;
  spot: string;
  page: number;
  y: number;
  timed: number;
  medians: Record<keyof KeyTiming, number>;
  burstPaints: number;
  burstLast: number;
}

const rows: Row[] = [];
const preview = start(
  join(repo, 'apps/web/node_modules/.bin/vite'),
  ['preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'],
  { MYLEAF_API_URL: api },
  join(repo, 'apps/web'),
);
await waitFor(web, preview.child, preview.errors);
const browser = await chromium.launch({
  headless: !headed,
  ...(channel ? { channel } : {}),
  // As in playwright.config.ts: a preinstalled browser instead of `playwright install`.
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});

try {
  for (const engine of engines) {
    const dataDir = await mkdtemp(join(tmpdir(), `myleaf-bench-${engine}-`));
    const timingPath = join(out, `${engine}-timing.jsonl`);
    const tracePath = join(out, `${engine}-trace.log`);
    const server = start('node', ['apps/server/dist/main.js'], {
      PORT: String(API_PORT),
      MYLEAF_DATA_DIR: dataDir,
      MYLEAF_LIVE_ENGINE: engine,
      MYLEAF_LIVE_TIMING: timingPath,
      MYLEAF_LIVE_TRACE: tracePath,
    });
    try {
      await waitFor(`${api}/health`, server.child, server.errors);
      const info = await json<{ available: boolean; engine: string | null }>('/api/live-preview');
      if (!info.available) {
        console.log(`${engine}: live preview is not available (not built?), skipped`);
        continue;
      }
      if (!source.includes(MARKERS.late)) await chooseLateSpot();
      for (const dpr of dprs) {
        for (const spot of spots as Spot[]) {
          const id = await newProject(`${engine} ${dpr}x ${spot}`);
          const where = (await locate(id))[spot];
          const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: dpr,
          });
          // Turns live timing on (apps/web/src/live/live-timing.ts) and marks each key.
          await context.addInitScript(`
            localStorage.setItem('myleaf.liveTiming', '1');
            const marks = (window.__myleafLiveTiming = []);
            window.addEventListener('keydown', () => {
              marks.push({ t: performance.timeOrigin + performance.now(), kind: 'key' });
            }, true);
          `);
          const page = await context.newPage();
          await page.goto(`${web}/#/projects/${id}`);
          const live = page.getByTestId('live-preview');
          await live
            .getByRole('img', { name: 'Live preview of page 1' })
            .waitFor({ timeout: 60_000 });
          await live
            .locator(`[data-page="${where.page}"]`)
            .evaluate((slot) =>
              (slot as unknown as ScrollTarget).scrollIntoView({ block: 'start' }),
            );
          await live
            .getByRole('img', { name: `Live preview of page ${where.page}` })
            .waitFor({ timeout: 60_000 });
          await placeCursor(page, MARKERS[spot]);
          // Let the session settle (references, other pages) before timing.
          await sleep(4000);
          await page.evaluate(() => {
            (globalThis as unknown as { __myleafLiveTiming: unknown[] }).__myleafLiveTiming.length =
              0;
          });
          const since = performance.timeOrigin + performance.now();

          for (let key = 0; key < KEYS; key++) {
            await page.keyboard.press('x');
            await sleep(GAP);
          }
          await sleep(1500);
          const burstStart = performance.timeOrigin + performance.now();
          for (let key = 0; key < BURST; key++) {
            await page.keyboard.press('y');
            await sleep(BURST_INTERVAL);
          }
          await sleep(4000);

          const typed = await page.locator('.cm-activeLine').textContent();
          if (!typed?.includes(`${MARKERS[spot]}x`)) {
            throw new Error(`The keys did not land after ${MARKERS[spot]}: ${typed ?? ''}`);
          }
          const browserMarks = (await page.evaluate(
            () => (globalThis as unknown as { __myleafLiveTiming: unknown[] }).__myleafLiveTiming,
          )) as Mark[];
          const serverMarks = await readServerMarks(timingPath, since);
          await writeFile(
            join(out, `${engine}-${dpr}x-${spot}.json`),
            JSON.stringify({ engine, dpr, spot, where, browserMarks, serverMarks }, null, 1),
          );
          await context.close();

          const keyTimes = browserMarks.filter((mark) => mark.kind === 'key').map((mark) => mark.t);
          const isolated = keyTimes.filter((t) => t < burstStart);
          const burst = keyTimes.filter((t) => t >= burstStart);
          const timings = analyseKeys(isolated, browserMarks, serverMarks, where.page).filter(
            (timing): timing is KeyTiming => timing !== null,
          );
          const fields = Object.keys(timings[0] ?? {}) as (keyof KeyTiming)[];
          const medians = Object.fromEntries(
            fields.map((field) => [field, median(timings.map((timing) => timing[field]))]),
          ) as Record<keyof KeyTiming, number>;
          const paints = browserMarks.filter(
            (mark) =>
              mark.kind === 'painted' &&
              mark.page === where.page &&
              mark.t >= (burst[0] ?? Infinity),
          );
          rows.push({
            engine,
            dpr,
            spot,
            page: where.page,
            y: where.y,
            timed: timings.length,
            medians,
            burstPaints: paints.length,
            burstLast: (paints.at(-1)?.t ?? NaN) - (burst.at(-1) ?? NaN),
          });
          console.log(
            `${engine} ${dpr}x ${spot} (page ${where.page}, ${Math.round(where.y * 100)}% down): ` +
              `${timings.length}/${isolated.length} keys timed, median key -> painted ${ms(medians.total)} ms`,
          );
        }
      }
    } finally {
      server.child.kill('SIGTERM');
      await new Promise((done) => server.child.once('exit', done));
    }
  }
} finally {
  await browser.close();
  preview.child.kill('SIGTERM');
}

const table = (header: string[], body: string[][]) =>
  [header, header.map(() => '---'), ...body].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
const label = (row: Row) => [
  row.engine,
  `${row.dpr}x`,
  `${row.spot} (p${row.page}, ${Math.round(row.y * 100)}%)`,
];
console.log('\nIsolated keys, medians in ms:\n');
console.log(
  table(
    [
      'Engine',
      'DPR',
      'Spot',
      'Keys',
      'Total',
      'key->send',
      'send->server',
      'server->page',
      'page->recv',
      'recv->drawn',
      'drawn->painted',
      'KB',
    ],
    rows.map((row) => [
      ...label(row),
      String(row.timed),
      ms(row.medians.total),
      ms(row.medians.keySend),
      ms(row.medians.sendServer),
      ms(row.medians.serverPage),
      ms(row.medians.pageRecv),
      ms(row.medians.recvDrawn),
      ms(row.medians.drawnPainted),
      ms(row.medians.bytes / 1024),
    ]),
  ),
);
console.log('\npdfTeX pages in the browser worker, medians in ms:\n');
console.log(
  table(
    ['Engine', 'DPR', 'Spot', 'Megapixels', 'Open', 'Raster', 'Bitmap', 'Text'],
    rows
      .filter((row) => Number.isFinite(row.medians.draw))
      .map((row) => [
        ...label(row),
        (row.medians.pixels / 1e6).toFixed(1),
        ms(row.medians.open),
        ms(row.medians.draw),
        ms(row.medians.bitmap),
        ms(row.medians.text),
      ]),
  ),
);
console.log(`\nBurst of ${BURST} keys ${BURST_INTERVAL} ms apart:\n`);
console.log(
  table(
    ['Engine', 'DPR', 'Spot', 'Page updates painted', 'Last key -> last paint (ms)'],
    rows.map((row) => [...label(row), String(row.burstPaints), ms(row.burstLast)]),
  ),
);
console.log(`\nRaw marks and server traces: ${out}`);
