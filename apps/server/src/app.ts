import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);
  app.get('/health', () => ({ status: 'ok' }));
  return app;
}
