import type { ProjectDto } from '@myleaf/api';
import { FakeCompileBackend, InMemoryProjectStore } from '@myleaf/testing';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('server API', () => {
  let app: FastifyInstance;
  let compiler: FakeCompileBackend;
  let project: ProjectDto;

  const putFile = (path: string, body: string | Buffer, contentType = 'application/octet-stream') =>
    app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/${path}`,
      headers: { 'content-type': contentType },
      payload: body,
    });

  beforeEach(async () => {
    compiler = new FakeCompileBackend();
    app = buildApp({ store: new InMemoryProjectStore(), compiler });
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Paper' },
    });
    expect(created.statusCode).toBe(201);
    project = created.json();
  });

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });

  describe('projects', () => {
    it('creates a project with a root file', async () => {
      expect(project).toMatchObject({ name: 'Paper', rootFile: 'main.tex' });
      const list = await app.inject({ method: 'GET', url: '/api/projects' });
      expect(list.json()).toEqual([project]);
      const files = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/files` });
      expect(files.json()).toEqual([{ path: 'main.tex', size: expect.any(Number) as number }]);
    });

    it('returns 404 with an error body for unknown projects', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/projects/nope' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: 'ProjectNotFoundError',
        message: 'Project nope not found',
      });
    });

    it('validates request bodies', async () => {
      const blank = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: ' ' },
      });
      expect(blank.statusCode).toBe(400);
      const extra = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'x', admin: true },
      });
      expect(extra.statusCode).toBe(400);
    });

    it('updates name and root file', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: { name: 'Thesis', rootFile: 'thesis.tex' },
      });
      expect(response.json()).toMatchObject({ name: 'Thesis', rootFile: 'thesis.tex' });
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: { rootFile: '../x.tex' },
      });
      expect(invalid.statusCode).toBe(400);
    });

    it('updates settings partially and validates them', async () => {
      expect(project.settings).toEqual({
        autoCompile: false,
        precompilePreamble: true,
        livePreview: false,
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: { settings: { autoCompile: true, livePreview: true } },
      });
      expect(response.json<ProjectDto>().settings).toEqual({
        autoCompile: true,
        precompilePreamble: true,
        livePreview: true,
      });
      for (const settings of [{ autoCompile: 'yes' }, { unknown: true }]) {
        const invalid = await app.inject({
          method: 'PATCH',
          url: `/api/projects/${project.id}`,
          payload: { settings },
        });
        expect(invalid.statusCode).toBe(400);
      }
    });

    it('deletes a project and its build output', async () => {
      const response = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
      expect(response.statusCode).toBe(204);
      expect(compiler.discarded).toEqual([project.id]);
      const get = await app.inject({ method: 'GET', url: `/api/projects/${project.id}` });
      expect(get.statusCode).toBe(404);
    });
  });

  describe('files', () => {
    it('stores and returns raw bytes, including encoded paths', async () => {
      const binary = Buffer.from([0, 1, 254, 255]);
      expect((await putFile('figures/my%20plot%C3%BC.bin', binary)).statusCode).toBe(204);
      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/files/figures/my%20plot%C3%BC.bin`,
      });
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.rawPayload).toEqual(binary);
      const files = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/files` });
      expect(files.json()).toContainEqual({ path: 'figures/my plotü.bin', size: 4 });
    });

    it('rejects paths that escape the project', async () => {
      // Encoded separators reach the handler decoded and fail path validation (400);
      // dot segments are normalized away by URL parsing and match no route (404).
      for (const path of ['..%2Fsecret.tex', '%2Fetc%2Fpasswd', 'a/%2E%2E/%2E%2E/b.tex']) {
        expect((await putFile(path, 'x')).statusCode).toBeOneOf([400, 404]);
      }
      expect((await putFile('..%2Fsecret.tex', 'x')).statusCode).toBe(400);
      const files = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/files` });
      expect(files.json<{ path: string }[]>().map((f) => f.path)).toEqual(['main.tex']);
    });

    it('requires raw bytes for uploads', async () => {
      const response = await putFile('a.tex', JSON.stringify({ a: 1 }), 'application/json');
      expect(response.statusCode).toBe(415);
    });

    it('moves and deletes files', async () => {
      await putFile('a.tex', 'a');
      const move = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/move`,
        payload: { from: 'a.tex', to: 'b/a.tex' },
      });
      expect(move.statusCode).toBe(204);
      const conflict = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/move`,
        payload: { from: 'b/a.tex', to: 'main.tex' },
      });
      expect(conflict.statusCode).toBe(409);
      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/files/b/a.tex`,
      });
      expect(remove.statusCode).toBe(204);
      const missing = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/files/b/a.tex`,
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('compile', () => {
    it('compiles every project file from the root file', async () => {
      await putFile('chapters/one.tex', 'one');
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/compile`,
        payload: { engine: 'xelatex' },
      });
      expect(response.json()).toMatchObject({ status: 'success', hasPdf: true });
      const [request] = compiler.requests;
      expect(request).toMatchObject({
        projectId: project.id,
        rootFile: 'main.tex',
        engine: 'xelatex',
      });
      expect(request?.files.map((f) => f.path)).toEqual(['chapters/one.tex', 'main.tex']);
    });

    it("passes the project's precompile setting to the compiler", async () => {
      await app.inject({ method: 'POST', url: `/api/projects/${project.id}/compile` });
      await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: { settings: { precompilePreamble: false } },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/compile`,
      });
      expect(compiler.requests.map((r) => r.options.precompilePreamble)).toEqual([true, false]);
      expect(second.json()).toMatchObject({ preamble: 'disabled' });
    });

    it('passes single-pass requests to the compiler (default: full)', async () => {
      const url = `/api/projects/${project.id}/compile`;
      await app.inject({ method: 'POST', url });
      await app.inject({ method: 'POST', url, payload: { singlePass: true } });
      const invalid = await app.inject({ method: 'POST', url, payload: { singlePass: 'yes' } });
      expect(invalid.statusCode).toBe(400);
      expect(compiler.requests.map((r) => r.options.singlePass)).toEqual([false, true]);
    });

    it('defaults to pdflatex and rejects unknown engines', async () => {
      await app.inject({ method: 'POST', url: `/api/projects/${project.id}/compile` });
      expect(compiler.requests[0]?.engine).toBe('pdflatex');
      const invalid = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/compile`,
        payload: { engine: 'troff' },
      });
      expect(invalid.statusCode).toBe(400);
    });

    it('serves the PDF once compiled', async () => {
      const before = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/output.pdf`,
      });
      expect(before.statusCode).toBe(404);
      await app.inject({ method: 'POST', url: `/api/projects/${project.id}/compile` });
      const after = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/output.pdf`,
      });
      expect(after.headers['content-type']).toBe('application/pdf');
      expect(after.body).toBe('%PDF-fake');
    });

    it('answers SyncTeX queries', async () => {
      const forward = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/synctex/forward`,
        payload: { file: 'main.tex', line: 1, column: null },
      });
      expect(forward.json()).toEqual({ rects: [compiler.rect] });
      const inverse = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/synctex/inverse`,
        payload: { page: 2, x: 1.5, y: 3 },
      });
      expect(inverse.json()).toEqual({ location: { file: 'main.tex', line: 2, column: null } });
    });
  });
});
