import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompileRequest } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TexLiveCompileBackend } from './tex-live-compile-backend.js';

const hasTexLive = (() => {
  try {
    execFileSync('latexmk', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const encoder = new TextEncoder();
const file = (path: string, content: string) => ({
  path: parseProjectPath(path),
  content: encoder.encode(content),
});

const MAIN = String.raw`\documentclass{article}
\begin{document}
Hello from the root file.

\input{chapters/one}
\end{document}
`;
const CHAPTER = 'Text of chapter one.\n';

describe.skipIf(!hasTexLive)('TexLiveCompileBackend (requires TeX Live)', () => {
  let workRoot: string;
  let backend: TexLiveCompileBackend;
  let nextId = 0;

  const request = (files: CompileRequest['files'], projectId = ProjectId(`p${nextId++}`)) => ({
    projectId,
    rootFile: parseProjectPath('main.tex'),
    engine: 'pdflatex' as const,
    files,
  });

  beforeAll(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'myleaf-compile-'));
    backend = new TexLiveCompileBackend({ workRoot, timeoutMs: 20_000 });
  });

  afterAll(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('compiles a multi-file document to PDF', async () => {
    const req = request([file('main.tex', MAIN), file('chapters/one.tex', CHAPTER)]);
    const result = await backend.compile(req);

    expect(result).toMatchObject({ status: 'success', hasPdf: true });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pdf = await backend.readPdf(req.projectId);
    expect(new TextDecoder().decode(pdf?.slice(0, 5))).toBe('%PDF-');
  });

  it('reports errors with their project file and line', async () => {
    const result = await backend.compile(
      request([file('main.tex', MAIN), file('chapters/one.tex', 'Fine.\n\n\\undefinedmacro\n')]),
    );
    expect(result.status).toBe('failure');
    expect(result.diagnostics).toContainEqual({
      severity: 'error',
      message: 'Undefined control sequence.',
      file: 'chapters/one.tex',
      line: 3,
    });
  });

  it('maps between source and PDF positions', async () => {
    const req = request([file('main.tex', MAIN), file('chapters/one.tex', CHAPTER)]);
    await backend.compile(req);

    const rects = await backend.forwardSearch(req.projectId, {
      file: parseProjectPath('chapters/one.tex'),
      line: 1,
      column: null,
    });
    expect(rects.length).toBeGreaterThan(0);
    const [rect] = rects;
    expect(rect).toMatchObject({ page: 1 });

    const location = await backend.inverseSearch(req.projectId, {
      page: 1,
      x: rect!.x + 10,
      y: rect!.y + rect!.height / 2,
    });
    expect(location).toMatchObject({ file: 'chapters/one.tex', line: 1 });
  });

  it('keeps unchanged files and removes deleted ones between compiles', async () => {
    const projectId = ProjectId('incremental');
    const srcFile = (path: string) => join(workRoot, projectId, 'src', ...path.split('/'));
    await backend.compile(
      request(
        [file('main.tex', MAIN), file('chapters/one.tex', CHAPTER), file('old.tex', 'x')],
        projectId,
      ),
    );
    const before = await stat(srcFile('chapters/one.tex'));

    await backend.compile(
      request([file('main.tex', `${MAIN}%`), file('chapters/one.tex', CHAPTER)], projectId),
    );

    expect((await stat(srcFile('chapters/one.tex'))).mtimeMs).toBe(before.mtimeMs);
    await expect(stat(srcFile('old.tex'))).rejects.toThrow();
  });

  it('does not let documents read files outside the project', async () => {
    const result = await backend.compile(
      request([
        file(
          'main.tex',
          '\\documentclass{article}\\begin{document}\\input{/etc/hostname}\\end{document}',
        ),
      ]),
    );
    expect(result.status).toBe('failure');
    expect(result.log).toContain("File `/etc/hostname.tex' not found");
  });

  it('stops runaway compiles', async () => {
    const runaway = new TexLiveCompileBackend({ workRoot, timeoutMs: 1_500 });
    const result = await runaway.compile(
      request([
        file(
          'main.tex',
          '\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}',
        ),
      ]),
    );
    expect(result.status).toBe('timeout');
  });

  it('has no output before the first compile and after discard', async () => {
    const req = request([file('main.tex', MAIN), file('chapters/one.tex', CHAPTER)]);
    expect(await backend.readPdf(req.projectId)).toBeNull();
    await backend.compile(req);
    await backend.discard(req.projectId);
    expect(await backend.readPdf(req.projectId)).toBeNull();
  });
});
