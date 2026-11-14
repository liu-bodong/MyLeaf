import { join, resolve } from 'node:path';
import { TexLiveCompileBackend } from '@myleaf/compile-texlive';
import { TexpressoLivePreview } from '@myleaf/live-texpresso';
import { FileSystemProjectStore } from '@myleaf/storage-fs';
import { buildApp } from './app.js';
import { LiveSessionPool } from './live/live-session-pool.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.MYLEAF_DATA_DIR ?? 'data');

const store = await FileSystemProjectStore.open(join(dataDir, 'projects'));
const compiler = new TexLiveCompileBackend({ workRoot: join(dataDir, 'builds') });

// Live preview (ADR 0012) is enabled by pointing MYLEAF_TEXPRESSO at the patched binary.
const texpresso = process.env.MYLEAF_TEXPRESSO;
const livePreview = texpresso
  ? new LiveSessionPool(
      new TexpressoLivePreview({ command: texpresso, workRoot: join(dataDir, 'live') }),
      {
        maxSessions: Number(process.env.MYLEAF_LIVE_MAX_SESSIONS ?? 4),
        idleMs: Number(process.env.MYLEAF_LIVE_IDLE_MINUTES ?? 10) * 60_000,
      },
    )
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
app.log.info(`Live preview: ${livePreview ? `enabled (${texpresso})` : 'disabled'}`);
