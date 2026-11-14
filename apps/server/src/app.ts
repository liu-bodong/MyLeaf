import type { CompileBackend } from '@myleaf/compile';
import type { ProjectStore } from '@myleaf/project';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { registerErrorHandler } from './error-handler.js';
import type { LiveSessionPool } from './live/live-session-pool.js';
import { registerCompileRoutes } from './routes/compile.js';
import { registerFileRoutes } from './routes/files.js';
import { registerLiveRoutes } from './routes/live.js';
import { registerProjectRoutes } from './routes/projects.js';

export interface AppDependencies {
  readonly store: ProjectStore;
  readonly compiler: CompileBackend;
  /** `null` or absent: live preview is not offered. */
  readonly livePreview?: LiveSessionPool | null;
}

export function buildApp(
  { store, compiler, livePreview = null }: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify({
    ...options,
    // Reject unknown properties instead of silently removing them.
    ajv: { customOptions: { removeAdditional: false } },
  });
  registerErrorHandler(app);
  app.get('/health', () => ({ status: 'ok' }));
  registerProjectRoutes(app, store, compiler);
  registerFileRoutes(app, store, livePreview);
  registerCompileRoutes(app, store, compiler);
  void app.register(websocket);
  void app.register((scoped, _options, done) => {
    registerLiveRoutes(scoped, store, livePreview);
    done();
  });
  app.addHook('onClose', async () => {
    await livePreview?.closeAll();
  });
  return app;
}
