import { rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { TexLiveCompileBackend } from '@myleaf/compile-texlive';
import {
  DEFAULT_MAX_SNAPSHOTS,
  DEFAULT_TAIL_DELAY_MS,
  PdftexLivePreview,
} from '@myleaf/live-pdftex';
import type { LivePreviewBackend } from '@myleaf/live-preview';
import { TexpressoLivePreview } from '@myleaf/live-texpresso';
import { FileSystemProjectStore } from '@myleaf/storage-fs';
import { buildApp } from './app.js';
import { LiveSessionPool } from './live/live-session-pool.js';
import { choosePdftex } from './live/pdftex-command.js';
import { chooseTexpresso } from './live/texpresso-command.js';
import { seedSampleProject } from './sample-project.js';

function positiveInt(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    const kind = minimum === 0 ? 'a non-negative' : 'a positive';
    throw new Error(`${name} must be ${kind} integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

const host = process.env.HOST ?? '127.0.0.1';
const port = positiveInt('PORT', 3000);
const dataDir = resolve(process.env.MYLEAF_DATA_DIR ?? 'data');

const store = await FileSystemProjectStore.open(join(dataDir, 'projects'));

// Sample project for testing by hand; `pnpm dev` points this at samples/icml2027.
const sampleDir = process.env.MYLEAF_SAMPLE_PROJECT;
const sampleCreated =
  sampleDir !== undefined &&
  (await seedSampleProject(store, {
    dir: resolve(sampleDir),
    name: 'ICML 2027 example',
    rootFile: 'example_paper.tex',
  }));
const compiler = new TexLiveCompileBackend({ workRoot: join(dataDir, 'builds') });

// Live sessions do not survive a restart: remove workspaces a crash left behind.
const liveRoot = join(dataDir, 'live');
const liveTracePath = process.env.MYLEAF_LIVE_TRACE;
const liveTrace =
  liveTracePath === undefined || liveTracePath === ''
    ? null
    : createWriteStream(resolve(liveTracePath), { flags: 'a' });
await rm(liveRoot, { recursive: true, force: true });

// Live preview engine: the patched TeXpresso (ADR 0012, default) or the
// patched pdfTeX (MYLEAF_LIVE_ENGINE=pdftex; docs/spikes/pdflatex-live-preview.md).
// MYLEAF_TEXPRESSO / MYLEAF_PDFTEX name the binary, or else the build of
// vendor/*/build.sh is used (this file is in apps/server/{src,dist}).
const liveEngine = process.env.MYLEAF_LIVE_ENGINE ?? 'texpresso';
let liveBackend: LivePreviewBackend | null = null;
let liveStatus: { readonly level: 'info' | 'warn'; readonly message: string };
if (liveEngine === 'pdftex') {
  const pdftex = await choosePdftex(
    process.env.MYLEAF_PDFTEX,
    resolve(import.meta.dirname, '../../../vendor/pdftex/build/bin/pdftex'),
  );
  if (pdftex.kind === 'enabled') {
    liveBackend = new PdftexLivePreview({
      command: pdftex.command,
      kpathsea: pdftex.kpathsea,
      workRoot: liveRoot,
      // Each snapshot is a paused pdfTeX process (about 3 MB of its own on Linux).
      maxSnapshots: positiveInt('MYLEAF_LIVE_MAX_SNAPSHOTS', DEFAULT_MAX_SNAPSHOTS, 0),
      // The rest of a run waits until typing pauses this long (0: never waits).
      tailDelayMs: positiveInt('MYLEAF_LIVE_TAIL_DELAY_MS', DEFAULT_TAIL_DELAY_MS, 0),
      // For diagnosis: a timestamped line per edit, run, pdfTeX message and page.
      ...(liveTrace === null
        ? {}
        : { trace: (line: string) => liveTrace.write(`${new Date().toISOString()} ${line}\n`) }),
    });
    liveStatus = { level: 'info', message: `Live preview: enabled, pdfTeX (${pdftex.command})` };
  } else {
    liveStatus = { level: pdftex.level, message: `Live preview disabled: ${pdftex.reason}` };
  }
} else if (liveEngine === 'texpresso') {
  const texpresso = await chooseTexpresso(
    process.env.MYLEAF_TEXPRESSO,
    resolve(import.meta.dirname, '../../../vendor/texpresso/build/bin/texpresso'),
  );
  if (texpresso.kind === 'enabled') {
    liveBackend = new TexpressoLivePreview({ command: texpresso.command, workRoot: liveRoot });
    liveStatus = { level: 'info', message: `Live preview: enabled (${texpresso.command})` };
  } else {
    liveStatus = { level: texpresso.level, message: `Live preview disabled: ${texpresso.reason}` };
  }
} else {
  throw new Error(
    `MYLEAF_LIVE_ENGINE must be texpresso or pdftex, got ${JSON.stringify(liveEngine)}`,
  );
}
const livePreview =
  liveBackend === null
    ? null
    : new LiveSessionPool(liveBackend, {
        maxSessions: positiveInt('MYLEAF_LIVE_MAX_SESSIONS', 4),
        idleMs: positiveInt('MYLEAF_LIVE_IDLE_MINUTES', 10) * 60_000,
      });

const app = buildApp({ store, compiler, livePreview }, { logger: true });

// Close live-preview sessions (and their TeXpresso processes) on shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
await app.listen({ host, port });
app.log.info(`Data directory: ${dataDir}`);
if (sampleCreated) app.log.info(`Sample project created from ${resolve(sampleDir)}`);
app.log[liveStatus.level](liveStatus.message);
