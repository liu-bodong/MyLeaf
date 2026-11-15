import { TEX_ENGINES } from '@myleaf/api';
import type {
  CompileRequestBody,
  CompileResponse,
  ForwardSearchRequest,
  ForwardSearchResponse,
  InverseSearchRequest,
  InverseSearchResponse,
  ReferencesResponse,
} from '@myleaf/api';
import type { CompileBackend } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { ProjectNotFoundError, parseProjectPath } from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import type { FastifyInstance } from 'fastify';
import type { LiveSessionPool } from '../live/live-session-pool.js';

interface IdParams {
  readonly id: string;
}

export function registerCompileRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  compiler: CompileBackend,
  livePreview: LiveSessionPool | null,
): void {
  app.post<{ Params: IdParams; Body: CompileRequestBody | undefined }>(
    '/api/projects/:id/compile',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          properties: {
            engine: { type: 'string', enum: [...TEX_ENGINES] },
            singlePass: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<CompileResponse> => {
      const id = ProjectId(request.params.id);
      const project = await store.getProject(id);
      if (project === null) {
        throw new ProjectNotFoundError(id);
      }
      const entries = await store.listFiles(id);
      const files = await Promise.all(
        entries.map(async ({ path }) => ({ path, content: await store.readFile(id, path) })),
      );
      const result = await compiler.compile({
        projectId: id,
        rootFile: project.rootFile,
        engine: request.body?.engine ?? 'pdflatex',
        files,
        options: {
          precompilePreamble: project.settings.precompilePreamble,
          singlePass: request.body?.singlePass ?? false,
        },
      });
      // Live previews do not run BibTeX: give them the new bibliography.
      const sessions = livePreview?.forProject(id) ?? [];
      const bibliography = sessions.length > 0 ? await compiler.readBibliography(id) : null;
      if (bibliography !== null) {
        for (const handle of sessions) handle.session.updateFile(bibliography);
      }
      return result;
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/projects/:id/references',
    (request): Promise<ReferencesResponse> => compiler.readReferences(ProjectId(request.params.id)),
  );

  app.get<{ Params: IdParams }>('/api/projects/:id/output.pdf', async (request, reply) => {
    const pdf = await compiler.readPdf(ProjectId(request.params.id));
    if (pdf === null) {
      return reply.status(404).send({ error: 'NoOutput', message: 'No PDF has been compiled yet' });
    }
    return reply.type('application/pdf').header('cache-control', 'no-store').send(Buffer.from(pdf));
  });

  app.post<{ Params: IdParams; Body: ForwardSearchRequest }>(
    '/api/projects/:id/synctex/forward',
    {
      schema: {
        body: {
          type: 'object',
          required: ['file', 'line', 'column'],
          properties: {
            file: { type: 'string' },
            line: { type: 'integer', minimum: 1 },
            column: { type: ['integer', 'null'], minimum: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ForwardSearchResponse> => {
      const { file, line, column } = request.body;
      const rects = await compiler.forwardSearch(ProjectId(request.params.id), {
        file: parseProjectPath(file),
        line,
        column,
      });
      return { rects };
    },
  );

  app.post<{ Params: IdParams; Body: InverseSearchRequest }>(
    '/api/projects/:id/synctex/inverse',
    {
      schema: {
        body: {
          type: 'object',
          required: ['page', 'x', 'y'],
          properties: {
            page: { type: 'integer', minimum: 1 },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<InverseSearchResponse> => ({
      location: await compiler.inverseSearch(ProjectId(request.params.id), request.body),
    }),
  );
}
