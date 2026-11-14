import type { FileEntryDto, MoveFileRequest } from '@myleaf/api';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import type { FastifyInstance } from 'fastify';

/** Upper bound for one uploaded file. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface FileParams {
  readonly id: string;
  readonly '*': string;
}

export function registerFileRoutes(app: FastifyInstance, store: ProjectStore): void {
  // File contents travel as raw bytes in both directions.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.get<{ Params: { id: string } }>(
    '/api/projects/:id/files',
    async (request): Promise<readonly FileEntryDto[]> =>
      store.listFiles(ProjectId(request.params.id)),
  );

  app.get<{ Params: FileParams }>('/api/projects/:id/files/*', async (request, reply) => {
    const content = await store.readFile(
      ProjectId(request.params.id),
      parseProjectPath(request.params['*']),
    );
    return reply
      .type('application/octet-stream')
      .header('cache-control', 'no-store')
      .send(Buffer.from(content));
  });

  app.put<{ Params: FileParams; Body: Buffer }>(
    '/api/projects/:id/files/*',
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        return reply.status(415).send({
          error: 'UnsupportedMediaType',
          message: 'File content must be sent as application/octet-stream',
        });
      }
      await store.writeFile(
        ProjectId(request.params.id),
        parseProjectPath(request.params['*']),
        new Uint8Array(request.body),
      );
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: FileParams }>('/api/projects/:id/files/*', async (request, reply) => {
    await store.deleteFile(ProjectId(request.params.id), parseProjectPath(request.params['*']));
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string }; Body: MoveFileRequest }>(
    '/api/projects/:id/move',
    {
      schema: {
        body: {
          type: 'object',
          required: ['from', 'to'],
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      await store.moveFile(
        ProjectId(request.params.id),
        parseProjectPath(request.body.from),
        parseProjectPath(request.body.to),
      );
      return reply.status(204).send();
    },
  );
}
