import { constants } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TexLiveCompileBackend } from '@myleaf/compile-texlive';
import { TexpressoLivePreview } from '@myleaf/live-texpresso';
import { FileSystemProjectStore } from '@myleaf/storage-fs';
import { buildApp } from './app.js';
import { LiveSessionPool } from './live/live-session-pool.js';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

const host = process.env.HOST ?? '127.0.0.1';
const port = positiveInt('PORT', 3000);
const dataDir = resolve(process.env.MYLEAF_DATA_DIR ?? 'data');

const store = await FileSystemProjectStore.open(join(dataDir, 'projects'));
const compiler = new TexLiveCompileBackend({ workRoot: join(dataDir, 'builds') });

// Live preview (ADR 0012) is enabled by pointing MYLEAF_TEXPRESSO at the patched binary.
const texpresso = process.env.MYLEAF_TEXPRESSO;
let texpressoProblem: string | null = null;
if (texpresso) {
  try {
    await access(texpresso, constants.X_OK);
  } catch {
    texpressoProblem = `MYLEAF_TEXPRESSO (${texpresso}) is not an executable file; build it with vendor/texpresso/build.sh`;
  }
}
// Live sessions do not survive a restart: remove workspaces a crash left behind.
const liveRoot = join(dataDir, 'live');
await rm(liveRoot, { recursive: true, force: true });
const livePreview =
  texpresso && texpressoProblem === null
    ? new LiveSessionPool(new TexpressoLivePreview({ command: texpresso, workRoot: liveRoot }), {
        maxSessions: positiveInt('MYLEAF_LIVE_MAX_SESSIONS', 4),
        idleMs: positiveInt('MYLEAF_LIVE_IDLE_MINUTES', 10) * 60_000,
      })
    : null;

const app = buildApp({ store, compiler, livePreview }, { logger: true });

// Close live-preview sessions (and their TeXpresso processes) on shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
await app.listen({ host, port });
app.log.info(`Data directory: ${dataDir}`);
if (texpressoProblem !== null) app.log.warn(`Live preview disabled: ${texpressoProblem}`);
else app.log.info(`Live preview: ${livePreview ? `enabled (${texpresso})` : 'disabled'}`);
