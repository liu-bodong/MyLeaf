import { mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { parseTexLog } from '@myleaf/compile';
import { parseAux } from '@myleaf/latex-syntax';
import type { AuxReferences, CitationReference, LabelReference } from '@myleaf/latex-syntax';
import type {
  CompileBackend,
  CompileRequest,
  CompileResult,
  PdfPoint,
  PdfRect,
  PreambleStatus,
  SourceLocation,
  TexEngine,
} from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectFile, ProjectPath } from '@myleaf/project';
import { withDraftImages } from './draft-images.js';
import { ImageCache } from './image-cache.js';
import { FORMAT_NAME, PreambleFormatStore, extractPreamble, formatKey } from './preamble-format.js';
import { runProcess } from './run-process.js';
import type { ProcessResult } from './run-process.js';
import { parseSynctexRecords } from './synctex-output.js';

export interface TexLiveCompileBackendOptions {
  /** Directory holding per-project build workspaces. */
  readonly workRoot: string;
  /** Maximum duration of one compile. Default: 60 s. */
  readonly timeoutMs?: number;
  readonly latexmkCommand?: string;
  readonly pdflatexCommand?: string;
  readonly synctexCommand?: string;
  /**
   * Converted images for `reuseImages`, which a live preview can share.
   * Default: one in `<workRoot>/.images`.
   */
  readonly imageCache?: ImageCache;
}

const ENGINE_FLAGS: Record<TexEngine, string> = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
};

const STATE_FILE = 'state.json';
const SAFE_ID = /^[\w-]+$/;

interface BuildState {
  /** TeX job name of the latest compile: the root file's name without extension. */
  readonly jobName: string;
}

/** How a compile will use the precompiled preamble. */
interface PreamblePlan {
  readonly status: PreambleStatus;
  /** Set when a valid precompiled preamble exists. */
  readonly useFormat: boolean;
  /** Identifies the preamble; set when it can be precompiled. */
  readonly key: string | null;
}

/**
 * CompileBackend running TeX Live's latexmk, with SyncTeX via the `synctex`
 * command-line tool. Workspace per project:
 *
 *   <workRoot>/<project-id>/src/   copy of the source; unchanged files keep
 *                                  their timestamps so latexmk can skip work
 *   <workRoot>/<project-id>/out/   aux files, log, PDF, SyncTeX data
 *   <workRoot>/<project-id>/out/fmt/  precompiled preamble (pdfLaTeX only)
 *   <workRoot>/.images/            converted images, shared (`ImageCache`)
 *
 * Precompiled preamble (ADR 0011): the part of the root file before
 * `\begin{document}` is dumped into a TeX format with `mylatexformat`, in the
 * background after the compile that first sees it. Later compiles load the
 * format instead of the packages. It is rebuilt when the preamble, a project
 * file it reads (e.g. a local .sty), or the TeX version changes.
 *
 * Images (`reuseImages`, pdfLaTeX only): PNGs that pdfTeX would decode and
 * compress again on every compile (with transparency) are converted to PDFs
 * once, in the background after the compile that first sees them; later
 * compiles copy the converted image instead. `draftImages` turns on
 * graphicx's draft mode in the source copy (`withDraftImages`).
 *
 * Hardening (not a sandbox; see ADR 0010): latexmk ignores rc files (they are
 * Perl code), shell escape is disabled, and TeX may only read and write files
 * inside the workspace and the TeX distribution.
 */
export class TexLiveCompileBackend implements CompileBackend {
  readonly #workRoot: string;
  readonly #timeoutMs: number;
  readonly #latexmk: string;
  readonly #pdflatex: string;
  readonly #synctex: string;
  #texVersion: Promise<string> | null = null;
  readonly #images: ImageCache;
  /** Tail of each project's compile queue. */
  readonly #queues = new Map<ProjectId, Promise<unknown>>();

  constructor(options: TexLiveCompileBackendOptions) {
    this.#workRoot = resolve(options.workRoot);
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#latexmk = options.latexmkCommand ?? 'latexmk';
    this.#pdflatex = options.pdflatexCommand ?? 'pdflatex';
    this.#synctex = options.synctexCommand ?? 'synctex';
    this.#images =
      options.imageCache ??
      new ImageCache({ dir: join(this.#workRoot, '.images'), timeoutMs: this.#timeoutMs });
  }

  async compile(request: CompileRequest): Promise<CompileResult> {
    const { result, key, images } = await this.#serialize(request.projectId, () =>
      this.#compile(request),
    );
    // Not awaited; not queued either, as it does not touch the project's workspace.
    if (images.length > 0) void this.#images.convertPending(images);
    if (result.preamble === 'building' && key !== null) {
      // Queued behind this compile and ahead of the next one; not awaited.
      void this.#serialize(request.projectId, () => this.#buildFormat(request, key));
    }
    return result;
  }

  /** Resolves once images being converted for `reuseImages` are converted (benchmarks, tests). */
  imagesConverted(): Promise<void> {
    return this.#images.idle();
  }

  async readPdf(projectId: ProjectId): Promise<Uint8Array | null> {
    const state = await this.#readState(projectId);
    if (state === null) {
      return null;
    }
    return readOptional(join(this.#outDir(projectId), `${state.jobName}.pdf`));
  }

  async readBibliography(projectId: ProjectId): Promise<ProjectFile | null> {
    const state = await this.#readState(projectId);
    if (state === null) {
      return null;
    }
    const name = `${state.jobName}.bbl`;
    const content = await readOptional(join(this.#outDir(projectId), name));
    // TeX reads \jobname.bbl from its working directory: the project root.
    return content === null ? null : { path: parseProjectPath(name), content };
  }

  async readReferences(projectId: ProjectId): Promise<AuxReferences | null> {
    const labels: Record<string, LabelReference> = {};
    const citations: Record<string, CitationReference> = {};
    const state = await this.#readState(projectId);
    if (state === null) return null;
    const outDir = this.#outDir(projectId);
    // The root's .aux and those it reads (\include'd chapters), at most 200.
    const pending = [`${state.jobName}.aux`];
    const seen = new Set<string>();
    while (pending.length > 0 && seen.size < 200) {
      const name = pending.shift()!;
      const path = resolve(outDir, name);
      if (seen.has(path) || !path.startsWith(outDir + sep)) continue;
      seen.add(path);
      const content = await readOptional(path);
      if (content === null) continue;
      const aux = parseAux(new TextDecoder().decode(content));
      Object.assign(labels, aux.labels);
      Object.assign(citations, aux.citations);
      pending.push(...aux.inputs);
    }
    return { labels, citations };
  }

  async forwardSearch(projectId: ProjectId, location: SourceLocation): Promise<readonly PdfRect[]> {
    const pdf = await this.#pdfPath(projectId);
    if (pdf === null) {
      return [];
    }
    const input = join(this.#srcDir(projectId), ...location.file.split('/'));
    const result = await this.#runSynctex(projectId, [
      'view',
      '-i',
      `${location.line}:${location.column ?? 0}:${input}`,
      '-o',
      pdf,
    ]);
    return parseSynctexRecords(result, 'Page').flatMap((record) => {
      const value = (key: string) => Number(record.get(key));
      const [page, h, v, width, height] = [
        value('Page'),
        value('h'),
        value('v'),
        value('W'),
        value('H'),
      ];
      if (![page, h, v, width, height].every(Number.isFinite)) {
        return [];
      }
      // `v` is the baseline; the box extends `H` above it.
      return [{ page, x: h, y: v - height, width, height }];
    });
  }

  async inverseSearch(projectId: ProjectId, point: PdfPoint): Promise<SourceLocation | null> {
    const pdf = await this.#pdfPath(projectId);
    if (pdf === null) {
      return null;
    }
    const result = await this.#runSynctex(projectId, [
      'edit',
      '-o',
      `${point.page}:${point.x}:${point.y}:${pdf}`,
    ]);
    const record = parseSynctexRecords(result, 'Output')[0];
    // SyncTeX records the directory TeX ran in with symlinks resolved
    // (e.g. /private/var/... for /var/... on macOS), or as is (Windows, with
    // 8.3 short names and junctions): compare both with links resolved.
    const srcDir = await realpath(this.#srcDir(projectId));
    const input = record?.get('Input') ?? '';
    const inputPath = input === '' ? '' : await realpath(resolve(srcDir, input)).catch(() => input);
    const file = this.#toProjectPath(projectId, inputPath, srcDir);
    const line = Number(record?.get('Line'));
    const column = Number(record?.get('Column'));
    if (file === null || !Number.isInteger(line) || line < 1) {
      return null;
    }
    return { file, line, column: Number.isInteger(column) && column >= 1 ? column : null };
  }

  discard(projectId: ProjectId): Promise<void> {
    return this.#serialize(projectId, () =>
      rm(this.#projectDir(projectId), { recursive: true, force: true }),
    );
  }

  async #compile(request: CompileRequest): Promise<{
    result: CompileResult;
    key: string | null;
    /** Images to convert for later compiles. */
    images: readonly ProjectFile[];
  }> {
    const started = performance.now();
    const { projectId, rootFile } = request;
    const outDir = this.#outDir(projectId);
    await mkdir(outDir, { recursive: true });
    const { files, images } = await this.#prepareFiles(request);
    const changed = await syncDirectory(this.#srcDir(projectId), files);

    const jobName = rootFile.slice(rootFile.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
    // A single pass needs the previous compile's .aux of the same root file.
    // Without changes, latexmk is faster: it finds nothing to do.
    const singlePass =
      request.options.singlePass === true &&
      changed &&
      request.engine === 'pdflatex' &&
      (await this.#readState(projectId))?.jobName === jobName &&
      (await readOptional(join(outDir, `${jobName}.aux`))) !== null;
    const state: BuildState = { jobName };
    await writeFile(join(this.#projectDir(projectId), STATE_FILE), JSON.stringify(state));

    const plan = await this.#planPreamble(request);
    let preamble = plan.status;
    const runEngine = (useFormat: boolean) =>
      singlePass ? this.#runPdflatexOnce(request, useFormat) : this.#runLatexmk(request, useFormat);
    let run = await runEngine(plan.useFormat);
    let output = await this.#readOutput(projectId, jobName);

    // A failure without a PDF and without errors in project files may be
    // caused by the format: retry without it, and stop using it if that helps.
    if (plan.useFormat && plan.key !== null && output.pdf === null && run.exitCode !== 0) {
      if (!output.diagnostics.some((d) => d.severity === 'error' && d.file !== null)) {
        run = await runEngine(false);
        output = await this.#readOutput(projectId, jobName);
        if (output.pdf !== null) {
          await this.#formats(projectId).markFailed(plan.key);
          preamble = 'unavailable';
        }
      }
    }

    return {
      key: plan.key,
      images,
      result: {
        status: run.timedOut ? 'timeout' : run.exitCode === 0 ? 'success' : 'failure',
        hasPdf: output.pdf !== null,
        durationMs: Math.round(performance.now() - started),
        log: output.log,
        diagnostics: output.diagnostics,
        preamble,
      },
    };
  }

  /** The files to compile: with converted images (`reuseImages`) or draft mode (`draftImages`). */
  async #prepareFiles(
    request: CompileRequest,
  ): Promise<{ files: readonly ProjectFile[]; images: readonly ProjectFile[] }> {
    const { options, rootFile } = request;
    if (options.draftImages === true) {
      // Images are not embedded: nothing to convert.
      const files = request.files.map((file) =>
        file.path === rootFile ? { path: file.path, content: withDraftImages(file.content) } : file,
      );
      return { files, images: [] };
    }
    if (options.reuseImages === true && request.engine === 'pdflatex') {
      const applied = await this.#images.apply(request.files);
      return { files: applied.files, images: applied.pending };
    }
    return { files: request.files, images: [] };
  }

  async #planPreamble(request: CompileRequest): Promise<PreamblePlan> {
    if (!request.options.precompilePreamble) {
      return { status: 'disabled', useFormat: false, key: null };
    }
    const root = request.files.find((file) => file.path === request.rootFile);
    const preamble =
      request.engine === 'pdflatex' && root !== undefined
        ? extractPreamble(new TextDecoder().decode(root.content))
        : null;
    if (preamble === null) {
      return { status: 'unavailable', useFormat: false, key: null };
    }
    const key = formatKey(await this.#getTexVersion(), request.rootFile, preamble);
    switch (await this.#formats(request.projectId).state(key, request.files)) {
      case 'ready':
        return { status: 'reused', useFormat: true, key };
      case 'failed':
        return { status: 'unavailable', useFormat: false, key };
      case 'missing':
        return { status: 'building', useFormat: false, key };
    }
  }

  /**
   * How pdfTeX finds the precompiled preamble: by name through TEXFORMATS on
   * TeX Live (an absolute -fmt path breaks pdfTeX's -recorder file name when
   * -output-directory is set), by absolute path on MiKTeX (no TEXFORMATS).
   */
  async #formatLookup(projectId: ProjectId) {
    const dir = this.#formats(projectId).dir;
    return (await this.#getTexVersion()).includes('MiKTeX')
      ? { fmt: join(dir, `${FORMAT_NAME}.fmt`), env: {} }
      : { fmt: FORMAT_NAME, env: { TEXFORMATS: `${dir}${delimiter}` } };
  }

  async #runLatexmk(request: CompileRequest, useFormat: boolean): Promise<ProcessResult> {
    const outDir = this.#outDir(request.projectId);
    const format = useFormat ? await this.#formatLookup(request.projectId) : null;
    return runProcess(
      this.#latexmk,
      [
        '-norc',
        ENGINE_FLAGS[request.engine],
        ...(format ? [`-pdflatex=${this.#pdflatex} "-fmt=${format.fmt}" %O %S`] : []),
        '-synctex=1',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-no-shell-escape',
        `-outdir=${outDir}`,
        request.rootFile,
      ],
      {
        cwd: this.#srcDir(request.projectId),
        env: { ...this.#texEnv(outDir), ...format?.env },
        timeoutMs: this.#timeoutMs,
      },
    );
  }

  /** One pdfLaTeX run with latexmk's flags, without latexmk's rerun logic (~100 ms less). */
  async #runPdflatexOnce(request: CompileRequest, useFormat: boolean): Promise<ProcessResult> {
    const outDir = this.#outDir(request.projectId);
    const format = useFormat ? await this.#formatLookup(request.projectId) : null;
    return runProcess(
      this.#pdflatex,
      [
        ...(format ? [`-fmt=${format.fmt}`] : []),
        '-synctex=1',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-no-shell-escape',
        // Keeps latexmk's dependency list current for the next full compile.
        '-recorder',
        `-output-directory=${outDir}`,
        request.rootFile,
      ],
      {
        cwd: this.#srcDir(request.projectId),
        env: { ...this.#texEnv(outDir), ...format?.env },
        timeoutMs: this.#timeoutMs,
      },
    );
  }

  async #readOutput(projectId: ProjectId, jobName: string) {
    const outDir = this.#outDir(projectId);
    const log = new TextDecoder().decode(
      (await readOptional(join(outDir, `${jobName}.log`))) ?? new Uint8Array(),
    );
    return {
      log,
      pdf: await readOptional(join(outDir, `${jobName}.pdf`)),
      diagnostics: parseTexLog(log, (raw) => this.#toProjectPath(projectId, raw)),
    };
  }

  /** Dumps the preamble of `request.rootFile` into a format with mylatexformat. */
  async #buildFormat(request: CompileRequest, key: string): Promise<void> {
    const { projectId, rootFile } = request;
    const formats = this.#formats(projectId);
    if ((await formats.state(key, request.files)) !== 'missing') {
      return;
    }
    const buildDir = join(this.#outDir(projectId), 'fmt-build');
    await rm(buildDir, { recursive: true, force: true });
    await mkdir(buildDir, { recursive: true });
    try {
      const run = await runProcess(
        this.#pdflatex,
        [
          '-ini',
          '-interaction=nonstopmode',
          '-halt-on-error',
          '-no-shell-escape',
          '-recorder',
          `-output-directory=${buildDir}`,
          `-jobname=${FORMAT_NAME}`,
          '&pdflatex',
          'mylatexformat.ltx',
          rootFile,
        ],
        { cwd: this.#srcDir(projectId), env: this.#texEnv(buildDir), timeoutMs: this.#timeoutMs },
      );
      const built =
        run.exitCode === 0 && (await readOptional(join(buildDir, `${FORMAT_NAME}.fmt`))) !== null;
      if (built) {
        await formats.commit(key, buildDir, this.#srcDir(projectId), rootFile, request.files);
      } else {
        await formats.markFailed(key);
      }
    } catch (error) {
      // A rejected run (e.g. `pdflatex` missing) still counts as a failed
      // build, so it is not retried on every compile.
      await formats.markFailed(key);
      console.error('Precompiling the preamble failed:', error);
    } finally {
      await rm(buildDir, { recursive: true, force: true });
    }
  }

  #getTexVersion(): Promise<string> {
    this.#texVersion ??= runProcess(this.#pdflatex, ['--version'], {
      cwd: this.#workRoot,
      env: process.env,
      timeoutMs: 10_000,
    }).then((result) => result.stdout.split('\n')[0] ?? '');
    return this.#texVersion;
  }

  #formats(projectId: ProjectId): PreambleFormatStore {
    return new PreambleFormatStore(join(this.#outDir(projectId), 'fmt'));
  }

  #texEnv(outDir: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      // Paranoid: no absolute paths outside TEXMFOUTPUT, no parent directories, no dot files.
      openin_any: 'p',
      openout_any: 'p',
      TEXMFOUTPUT: outDir,
      // Unwrapped log lines, so diagnostics can be parsed.
      max_print_line: '10000',
    };
  }

  /** Maps a path printed by TeX or SyncTeX (relative to src, or absolute) to a project path. */
  #toProjectPath(
    projectId: ProjectId,
    raw: string,
    srcDir = this.#srcDir(projectId),
  ): ProjectPath | null {
    if (raw === '') {
      return null;
    }
    const relativePath = relative(srcDir, resolve(srcDir, raw));
    if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      return null;
    }
    try {
      return parseProjectPath(relativePath.split(sep).join('/'));
    } catch {
      return null;
    }
  }

  async #runSynctex(projectId: ProjectId, args: readonly string[]): Promise<string> {
    const result = await runProcess(this.#synctex, args, {
      cwd: this.#outDir(projectId),
      env: process.env,
      timeoutMs: 10_000,
    });
    return result.stdout;
  }

  async #pdfPath(projectId: ProjectId): Promise<string | null> {
    const state = await this.#readState(projectId);
    if (state === null) {
      return null;
    }
    const pdf = join(this.#outDir(projectId), `${state.jobName}.pdf`);
    return (await readOptional(pdf)) === null ? null : pdf;
  }

  async #readState(projectId: ProjectId): Promise<BuildState | null> {
    const raw = await readOptional(join(this.#projectDir(projectId), STATE_FILE));
    return raw === null ? null : (JSON.parse(new TextDecoder().decode(raw)) as BuildState);
  }

  #serialize<T>(projectId: ProjectId, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(projectId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    this.#queues.set(projectId, tail);
    void tail.then(() => {
      if (this.#queues.get(projectId) === tail) {
        this.#queues.delete(projectId);
      }
    });
    return next;
  }

  #projectDir(projectId: ProjectId): string {
    if (!SAFE_ID.test(projectId)) {
      throw new Error(`Unsafe project id for a directory name: ${projectId}`);
    }
    return join(this.#workRoot, projectId);
  }

  #srcDir(projectId: ProjectId): string {
    return join(this.#projectDir(projectId), 'src');
  }

  #outDir(projectId: ProjectId): string {
    return join(this.#projectDir(projectId), 'out');
  }
}

/**
 * Makes `dir` contain exactly `files`. Files whose content is unchanged are
 * not rewritten, so their modification times stay the same.
 */
/** Makes `dir` hold exactly `files`; returns whether anything changed. */
async function syncDirectory(dir: string, files: readonly ProjectFile[]): Promise<boolean> {
  let changed = false;
  await mkdir(dir, { recursive: true });
  const wanted = new Map(files.map((file) => [join(dir, ...file.path.split('/')), file.content]));

  const existing = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of existing.filter((e) => e.isFile())) {
    const path = join(entry.parentPath, entry.name);
    if (!wanted.has(path)) {
      await rm(path);
      changed = true;
    }
  }
  // Deepest first, so parents empty out before they are visited.
  const directories = existing
    .filter((e) => e.isDirectory())
    .map((e) => join(e.parentPath, e.name))
    .sort((a, b) => b.length - a.length);
  for (const directory of directories) {
    await rmdir(directory).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY')) {
        throw error;
      }
    });
  }

  for (const [path, content] of wanted) {
    const current = await readOptional(path);
    if (current === null || !Buffer.from(current).equals(content)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      changed = true;
    }
  }
  return changed;
}

async function readOptional(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
