import type {
  CreateProjectRequest,
  ImportProjectQuery,
  ProjectDto,
  UpdateProjectRequest,
} from '@myleaf/api';
import type { CompileBackend } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { ProjectNotFoundError, parseProjectPath } from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import type { FastifyInstance } from 'fastify';
import { MAX_ZIP_BYTES, extractProject } from '../zip-import.js';
import type { LiveSessionPool } from '../live/live-session-pool.js';

const NEW_PROJECT_ROOT = 'main.tex';
const NEW_PROJECT_CONTENT = String.raw`\documentclass{article}

\begin{document}

Start writing here.

\end{document}
`;

interface IdParams {
  readonly id: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  compiler: CompileBackend,
  livePreview: LiveSessionPool | null = null,
): void {
  app.get('/api/projects', async (): Promise<readonly ProjectDto[]> => {
    const projects = await store.listProjects();
    return [...projects].sort((a, b) => a.createdAt - b.createdAt);
  });

  app.post<{ Body: CreateProjectRequest }>(
    '/api/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply): Promise<ProjectDto> => {
      const rootFile = parseProjectPath(NEW_PROJECT_ROOT);
      const project = await store.createProject({
        name: request.body.name,
        rootFile,
        files: [{ path: rootFile, content: new TextEncoder().encode(NEW_PROJECT_CONTENT) }],
      });
      reply.status(201);
      return project;
    },
  );

  // A zip upload travels as raw bytes, its project name in the query string.
  app.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: MAX_ZIP_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post<{ Querystring: ImportProjectQuery; Body: Buffer }>(
    '/api/projects/import',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply): Promise<ProjectDto> => {
      if (!Buffer.isBuffer(request.body)) {
        return reply.status(415).send({
          error: 'UnsupportedMediaType',
          message: 'The zip file must be sent as application/zip',
        });
      }
      const { rootFile, files } = extractProject(new Uint8Array(request.body));
      const project = await store.createProject({ name: request.query.name, rootFile, files });
      reply.status(201);
      return project;
    },
  );

  app.get<{ Params: IdParams }>('/api/projects/:id', async (request): Promise<ProjectDto> => {
    const id = ProjectId(request.params.id);
    const project = await store.getProject(id);
    if (project === null) {
      throw new ProjectNotFoundError(id);
    }
    return project;
  });

  app.patch<{ Params: IdParams; Body: UpdateProjectRequest }>(
    '/api/projects/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rootFile: { type: 'string' },
            settings: {
              type: 'object',
              properties: {
                autoCompile: { type: 'boolean' },
                precompilePreamble: { type: 'boolean' },
                livePreview: { type: 'boolean' },
                liveSnapshots: { type: ['integer', 'null'], minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ProjectDto> => {
      const { name, rootFile, settings } = request.body;
      const id = ProjectId(request.params.id);
      const project = await store.updateProject(id, {
        ...(name === undefined ? {} : { name }),
        ...(rootFile === undefined ? {} : { rootFile: parseProjectPath(rootFile) }),
        ...(settings === undefined ? {} : { settings }),
      });
      // Open live previews keep fewer (or more) snapshots from their next run.
      if (settings?.liveSnapshots !== undefined) {
        for (const handle of livePreview?.forProject(id) ?? []) {
          handle.session.setMaxSnapshots?.(project.settings.liveSnapshots);
        }
      }
      return project;
    },
  );

  app.delete<{ Params: IdParams }>('/api/projects/:id', async (request, reply) => {
    const id = ProjectId(request.params.id);
    await store.deleteProject(id);
    await compiler.discard(id);
    return reply.status(204).send();
  });
}
