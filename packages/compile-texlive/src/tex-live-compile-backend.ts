import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseTexLog } from '@myleaf/compile';
import type {
  CompileBackend,
  CompileRequest,
  CompileResult,
  PdfPoint,
  PdfRect,
  SourceLocation,
  TexEngine,
} from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectFile, ProjectPath } from '@myleaf/project';
import { runProcess } from './run-process.js';
import { parseSynctexRecords } from './synctex-output.js';

export interface TexLiveCompileBackendOptions {
  /** Directory holding per-project build workspaces. */
  readonly workRoot: string;
  /** Maximum duration of one compile. Default: 60 s. */
  readonly timeoutMs?: number;
  readonly latexmkCommand?: string;
  readonly synctexCommand?: string;
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

/**
 * CompileBackend running TeX Live's latexmk, with SyncTeX via the `synctex`
 * command-line tool. Workspace per project:
 *
 *   <workRoot>/<project-id>/src/   copy of the source; unchanged files keep
 *                                  their timestamps so latexmk can skip work
 *   <workRoot>/<project-id>/out/   aux files, log, PDF, SyncTeX data
 *
 * Hardening (not a sandbox; see ADR 0010): latexmk ignores rc files (they are
 * Perl code), shell escape is disabled, and TeX may only read and write files
 * inside the workspace and the TeX distribution.
 */
export class TexLiveCompileBackend implements CompileBackend {
  readonly #workRoot: string;
  readonly #timeoutMs: number;
  readonly #latexmk: string;
  readonly #synctex: string;
  /** Tail of each project's compile queue. */
  readonly #queues = new Map<ProjectId, Promise<unknown>>();

  constructor(options: TexLiveCompileBackendOptions) {
    this.#workRoot = resolve(options.workRoot);
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#latexmk = options.latexmkCommand ?? 'latexmk';
    this.#synctex = options.synctexCommand ?? 'synctex';
  }

  compile(request: CompileRequest): Promise<CompileResult> {
    return this.#serialize(request.projectId, () => this.#compile(request));
  }

  async readPdf(projectId: ProjectId): Promise<Uint8Array | null> {
    const state = await this.#readState(projectId);
    if (state === null) {
      return null;
    }
    return readOptional(join(this.#outDir(projectId), `${state.jobName}.pdf`));
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
    const file = this.#toProjectPath(projectId, record?.get('Input') ?? '');
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

  async #compile(request: CompileRequest): Promise<CompileResult> {
    const started = performance.now();
    const { projectId, rootFile } = request;
    const srcDir = this.#srcDir(projectId);
    const outDir = this.#outDir(projectId);
    await mkdir(outDir, { recursive: true });
    await syncDirectory(srcDir, request.files);

    const jobName = rootFile.slice(rootFile.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
    const state: BuildState = { jobName };
    await writeFile(join(this.#projectDir(projectId), STATE_FILE), JSON.stringify(state));

    const run = await runProcess(
      this.#latexmk,
      [
        '-norc',
        ENGINE_FLAGS[request.engine],
        '-synctex=1',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-no-shell-escape',
        `-outdir=${outDir}`,
        rootFile,
      ],
      { cwd: srcDir, env: this.#texEnv(outDir), timeoutMs: this.#timeoutMs },
    );

    const log = (await readOptional(join(outDir, `${jobName}.log`))) ?? new Uint8Array();
    const logText = new TextDecoder().decode(log);
    const pdf = await readOptional(join(outDir, `${jobName}.pdf`));
    return {
      status: run.timedOut ? 'timeout' : run.exitCode === 0 ? 'success' : 'failure',
      hasPdf: pdf !== null,
      durationMs: Math.round(performance.now() - started),
      log: logText,
      diagnostics: parseTexLog(logText, (raw) => this.#toProjectPath(projectId, raw)),
    };
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
  #toProjectPath(projectId: ProjectId, raw: string): ProjectPath | null {
    if (raw === '') {
      return null;
    }
    const srcDir = this.#srcDir(projectId);
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
async function syncDirectory(dir: string, files: readonly ProjectFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const wanted = new Map(files.map((file) => [join(dir, ...file.path.split('/')), file.content]));

  const existing = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of existing.filter((e) => e.isFile())) {
    const path = join(entry.parentPath, entry.name);
    if (!wanted.has(path)) {
      await rm(path);
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
    }
  }
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
