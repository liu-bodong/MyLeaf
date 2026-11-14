import { join, resolve } from 'node:path';
import { TexLiveCompileBackend } from '@myleaf/compile-texlive';
import { FileSystemProjectStore } from '@myleaf/storage-fs';
import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.MYLEAF_DATA_DIR ?? 'data');

const store = await FileSystemProjectStore.open(join(dataDir, 'projects'));
const compiler = new TexLiveCompileBackend({ workRoot: join(dataDir, 'builds') });

const app = buildApp({ store, compiler }, { logger: true });
await app.listen({ host, port });
app.log.info(`Data directory: ${dataDir}`);
