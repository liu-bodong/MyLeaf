import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
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

  const request = (
    files: CompileRequest['files'],
    projectId = ProjectId(`p${nextId++}`),
    overrides: Partial<CompileRequest> = {},
  ): CompileRequest => ({
    projectId,
    rootFile: parseProjectPath('main.tex'),
    engine: 'pdflatex',
    files,
    options: { precompilePreamble: false },
    ...overrides,
  });

  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'myleaf-compile-'));
    // Reached through a symlink, like macOS's /var -> /private/var: SyncTeX
    // reports paths with symlinks resolved.
    await mkdir(join(tempDir, 'real'));
    // A junction on Windows, where symlinks need Developer Mode; ignored elsewhere.
    await symlink(join(tempDir, 'real'), join(tempDir, 'link'), 'junction');
    workRoot = join(tempDir, 'link');
    backend = new TexLiveCompileBackend({ workRoot, timeoutMs: 20_000 });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
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

  describe('precompiled preamble', () => {
    const cached = { options: { precompilePreamble: true } };
    const PREAMBLE = '\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{mymacros}\n';
    const body = (text: string) => `${PREAMBLE}\\begin{document}\n${text}\n\\end{document}\n`;
    const macros = (value: string) =>
      file('mymacros.sty', `\\ProvidesPackage{mymacros}\n\\newcommand{\\val}{${value}}\n`);

    it('is built after the first compile and reused by later ones', async () => {
      const projectId = ProjectId('preamble-reuse');
      const first = await backend.compile(
        request([file('main.tex', body('First \\val.')), macros('one')], projectId, cached),
      );
      expect(first).toMatchObject({ status: 'success', preamble: 'building' });

      // The error is on line 6 and must be reported there although the preamble is skipped.
      const second = await backend.compile(
        request(
          [file('main.tex', body('Second.\n\\undefinedmacro')), macros('one')],
          projectId,
          cached,
        ),
      );
      expect(second.preamble).toBe('reused');
      expect(second.diagnostics).toContainEqual({
        severity: 'error',
        message: 'Undefined control sequence.',
        file: 'main.tex',
        line: 6,
      });

      const third = await backend.compile(
        request([file('main.tex', body('Third \\val.')), macros('one')], projectId, cached),
      );
      expect(third).toMatchObject({ status: 'success', preamble: 'reused', hasPdf: true });
      const rects = await backend.forwardSearch(projectId, {
        file: parseProjectPath('main.tex'),
        line: 5,
        column: null,
      });
      expect(rects.length).toBeGreaterThan(0);
      const location = await backend.inverseSearch(projectId, {
        page: rects[0]!.page,
        x: rects[0]!.x + 5,
        y: rects[0]!.y + rects[0]!.height / 2,
      });
      expect(location).toMatchObject({ file: 'main.tex', line: 5 });
    });

    it('is rebuilt when the preamble or a project package it loads changes', async () => {
      const projectId = ProjectId('preamble-invalidation');
      const compile = (main: string, value: string) =>
        backend.compile(request([file('main.tex', main), macros(value)], projectId, cached));

      expect((await compile(body('A'), 'one')).preamble).toBe('building');
      expect((await compile(body('B'), 'one')).preamble).toBe('reused');
      expect((await compile(body('B'), 'two')).preamble).toBe('building');
      expect((await compile(body('C'), 'two')).preamble).toBe('reused');
      expect((await compile(`% comment\n${body('C')}`, 'two')).preamble).toBe('building');
      expect((await compile(`% comment\n${body('D')}`, 'two')).preamble).toBe('reused');
    });

    it('is not used when disabled, for other engines, or without \\begin{document}', async () => {
      const files = [file('main.tex', body('x')), macros('one')];
      expect((await backend.compile(request(files))).preamble).toBe('disabled');
      expect(
        (await backend.compile(request(files, undefined, { ...cached, engine: 'lualatex' })))
          .preamble,
      ).toBe('unavailable');
      expect(
        (await backend.compile(request([file('main.tex', '\\relax')], undefined, cached))).preamble,
      ).toBe('unavailable');
    });

    it('falls back to normal compiles when the preamble cannot be precompiled', async () => {
      // TeX cannot save a format inside an open group, but compiles the document.
      const projectId = ProjectId('preamble-unbuildable');
      const main =
        '\\documentclass{article}\\begingroup\n\\begin{document}\nText.\n\\end{document}\n';
      const first = await backend.compile(request([file('main.tex', main)], projectId, cached));
      expect(first).toMatchObject({ hasPdf: true, preamble: 'building' });
      const second = await backend.compile(request([file('main.tex', main)], projectId, cached));
      expect(second).toMatchObject({ hasPdf: true, preamble: 'unavailable' });
    });
  });

  describe('single pass', () => {
    const doc = (body: string) => String.raw`\documentclass{article}
\begin{document}
${body}
\section{One}\label{one}
\end{document}
`;
    const undefinedRefs = (result: { diagnostics: readonly { message: string }[] }) =>
      result.diagnostics.filter((d) => /undefined/.test(d.message)).length;

    it('compiles fully when there is no previous compile', async () => {
      const req = request([file('main.tex', doc('See \\ref{one}.'))], undefined, {
        options: { precompilePreamble: false, singlePass: true },
      });
      const result = await backend.compile(req);
      expect(result).toMatchObject({ status: 'success', hasPdf: true });
      // latexmk reran until the forward reference resolved.
      expect(undefinedRefs(result)).toBe(0);
    });

    it('runs once, with references from the previous compile', async () => {
      const id = ProjectId(`p${nextId++}`);
      const full = await backend.compile(request([file('main.tex', doc('See \\ref{one}.'))], id));
      expect(undefinedRefs(full)).toBe(0);
      // A new label is not known to the single pass yet...
      const edited = doc('See \\ref{one} and \\ref{two}.\n\\section{Two}\\label{two}');
      const single = await backend.compile(
        request([file('main.tex', edited)], id, {
          options: { precompilePreamble: false, singlePass: true },
        }),
      );
      expect(single).toMatchObject({ status: 'success', hasPdf: true });
      expect(undefinedRefs(single)).toBeGreaterThan(0);
      // ...and is after the next full compile.
      expect(undefinedRefs(await backend.compile(request([file('main.tex', edited)], id)))).toBe(0);
    });
  });

  it('provides the bibliography of the latest compile', async () => {
    const main = String.raw`\documentclass{article}
\begin{document}
See \cite{knuth}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;
    const refs = '@book{knuth, author = {Donald Knuth}, title = {The TeXbook}, year = {1984}}\n';
    const withBib = request([file('main.tex', main), file('refs.bib', refs)]);
    expect(await backend.readBibliography(withBib.projectId)).toBeNull();
    await backend.compile(withBib);
    const bbl = await backend.readBibliography(withBib.projectId);
    expect(bbl?.path).toBe('main.bbl');
    expect(new TextDecoder().decode(bbl?.content)).toContain('\\bibitem{knuth}');

    const withoutBib = request([file('main.tex', MAIN), file('chapters/one.tex', CHAPTER)]);
    await backend.compile(withoutBib);
    expect(await backend.readBibliography(withoutBib.projectId)).toBeNull();
  });

  it('reports the labels and citations of the latest compile', async () => {
    const main = String.raw`\documentclass{article}
\usepackage{natbib}
\usepackage{cleveref}
\begin{document}
\section{One}\label{sec:one}
See \cref{sec:one}, \cref{sec:two} and \citet{knuth}.
\include{chapter}
\bibliographystyle{plainnat}
\bibliography{refs}
\end{document}
`;
    const chapter = String.raw`\section{Two}\label{sec:two}`;
    const refs = '@book{knuth, author = {Donald Knuth}, title = {The TeXbook}, year = {1984}}\n';
    const req = request([
      file('main.tex', main),
      file('chapter.tex', chapter),
      file('refs.bib', refs),
    ]);
    expect(await backend.readReferences(req.projectId)).toBeNull();
    await backend.compile(req);
    const references = await backend.readReferences(req.projectId);
    expect(references?.labels).toEqual({
      'sec:one': { number: '1', page: '1', type: 'section' },
      // From chapter.aux, read through \@input.
      'sec:two': { number: '2', page: '2', type: 'section' },
    });
    expect(references?.citations).toEqual({
      knuth: { number: '1', year: '1984', authors: 'Knuth' },
    });
  });

  it('has no output before the first compile and after discard', async () => {
    const req = request([file('main.tex', MAIN), file('chapters/one.tex', CHAPTER)]);
    expect(await backend.readPdf(req.projectId)).toBeNull();
    await backend.compile(req);
    await backend.discard(req.projectId);
    expect(await backend.readPdf(req.projectId)).toBeNull();
  });
});
