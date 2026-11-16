import type { FileEntryDto, MoveFileRequest } from '@myleaf/api';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import type { FastifyInstance } from 'fastify';
import type { LiveSessionPool } from '../live/live-session-pool.js';
import type { LiveSources } from '../live/live-sources.js';

/** Upper bound for one uploaded file. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface FileParams {
  readonly id: string;
  readonly '*': string;
}

export function registerFileRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  livePreview: LiveSessionPool | null,
  liveSources: LiveSources | null = null,
): void {
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
      const id = ProjectId(request.params.id);
      const file = {
        path: parseProjectPath(request.params['*']),
        content: new Uint8Array(request.body),
      };
      await store.writeFile(id, file.path, file.content);
      // Open live previews see saved files and uploads too. Touch each session
      // so an active preview is not closed for idleness mid-upload.
      const handles = livePreview?.forProject(id) ?? [];
      const project = handles.length > 0 && liveSources ? await store.getProject(id) : null;
      const live =
        project && liveSources
          ? await liveSources.files(project, [file])
          : { files: [file], convert: () => {} };
      for (const handle of handles) {
        handle.touch();
        handle.session.updateFile(live.files[0]!);
      }
      // An image converted for reuse replaces the upload in the sessions,
      // unless another upload replaced it meanwhile.
      live.convert((converted, original) => {
        void store.readFile(id, original.path).then(
          (current) => {
            if (!Buffer.from(current).equals(original.content)) return;
            for (const handle of livePreview?.forProject(id) ?? []) {
              handle.session.updateFile(converted);
            }
          },
          () => {},
        );
      });
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
