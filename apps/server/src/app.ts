import type { CompileBackend } from '@myleaf/compile';
import type { ProjectStore } from '@myleaf/project';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { registerErrorHandler } from './error-handler.js';
import { registerCompileRoutes } from './routes/compile.js';
import { registerFileRoutes } from './routes/files.js';
import { registerProjectRoutes } from './routes/projects.js';

export interface AppDependencies {
  readonly store: ProjectStore;
  readonly compiler: CompileBackend;
}

export function buildApp(
  { store, compiler }: AppDependencies,
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
  registerFileRoutes(app, store);
  registerCompileRoutes(app, store, compiler);
  return app;
}
