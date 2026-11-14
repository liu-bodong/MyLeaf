import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

const app = buildApp({ logger: true });
await app.listen({ host, port });
