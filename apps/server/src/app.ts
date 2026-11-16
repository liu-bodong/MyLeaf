import type { CompileBackend } from '@myleaf/compile';
import type { ImageCache } from '@myleaf/compile-texlive';
import type { ProjectStore } from '@myleaf/project';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { registerErrorHandler } from './error-handler.js';
import type { LiveSessionPool } from './live/live-session-pool.js';
import { LiveSources } from './live/live-sources.js';
import { registerCompileRoutes } from './routes/compile.js';
import { registerFileRoutes } from './routes/files.js';
import { registerLiveRoutes } from './routes/live.js';
import { registerProjectRoutes } from './routes/projects.js';

export interface AppDependencies {
  readonly store: ProjectStore;
  readonly compiler: CompileBackend;
  /** `null` or absent: live preview is not offered. */
  readonly livePreview?: LiveSessionPool | null;
  /** Converted images the compiler keeps (`reuseImages`), for live previews too. */
  readonly imageCache?: ImageCache | null;
}

/**
 * WebSocket compression (permessage-deflate) for live preview. A page is an
 * SVG of about 300 KB that deflate shrinks about 7-fold. Level 1 gets most of
 * that for a third of the CPU of zlib's default level 6; small messages
 * (status, page counts) stay uncompressed. Measured with
 * `pnpm bench:live-compression`.
 */
export const liveSocketCompression = {
  zlibDeflateOptions: { level: 1 },
  threshold: 1024,
} as const;

export function buildApp(
  { store, compiler, livePreview = null, imageCache = null }: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify({
    ...options,
    // Reject unknown properties instead of silently removing them.
    ajv: { customOptions: { removeAdditional: false } },
  });
  registerErrorHandler(app);
  const liveSources = livePreview && new LiveSources(imageCache, livePreview.engine);
  app.get('/health', () => ({ status: 'ok' }));
  registerProjectRoutes(app, store, compiler, livePreview);
  registerFileRoutes(app, store, livePreview, liveSources);
  registerCompileRoutes(app, store, compiler, livePreview);
  void app.register(websocket, { options: { perMessageDeflate: liveSocketCompression } });
  void app.register((scoped, _options, done) => {
    registerLiveRoutes(scoped, store, compiler, livePreview, liveSources);
    done();
  });
  app.addHook('onClose', async () => {
    await livePreview?.closeAll();
  });
  return app;
}
