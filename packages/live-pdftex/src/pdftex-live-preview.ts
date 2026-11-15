import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Duplex } from 'node:stream';
import { promisify } from 'node:util';
import type {
  LivePreviewBackend,
  LivePreviewEvent,
  LivePreviewRequest,
  LivePreviewSession,
} from '@myleaf/live-preview';
import type { ProjectFile } from '@myleaf/project';
import { pauseOffset } from './pause-offset.js';
import { sanitizeSvg } from './sanitize-svg.js';

const run = promisify(execFile);

/** Kills a process of an engine's chain; it may have exited already. */
const kill = (pid: number) => {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
};

export interface PdftexLivePreviewOptions {
  /** Path of the patched `pdftex` binary (vendor/pdftex/build.sh). */
  readonly command: string;
  /** Directory holding the format and per-session workspaces. */
  readonly workRoot: string;
  /**
   * kpathsea variables that point the patched binary at the installed TeX
   * Live (`kpathseaEnv()`).
   */
  readonly kpathsea: Readonly<Record<string, string>>;
  /** MuPDF's command line tool, which renders PDF pages to SVG. Default: `mutool`. */
  readonly mutool?: string;
}

/**
 * LivePreviewBackend on the patched pdfTeX (vendor/pdftex, levels 2 and 3 in
 * docs/spikes/pdflatex-live-preview.md). Per session, an engine process runs
 * the root file's preamble and pauses before `\begin{document}`; each edit
 * forks a child that typesets the document from there into a PDF, whose
 * pages are rendered to SVG with MuPDF. Output is pdfLaTeX's own. Pages of
 * the visible range are shown as soon as the child ships them out, and a new
 * edit cancels the rest of a run once they are on screen. The child leaves a
 * snapshot after each page; a run resumes from the last one before the edit.
 *
 *   <workRoot>/format/pdflatex.fmt          made with the patched binary
 *   <workRoot>/<project-id>/<session>/src/  source files, kept up to date
 *   <workRoot>/<project-id>/<session>/runs/ one directory per child
 */
export class PdftexLivePreview implements LivePreviewBackend {
  readonly engine = 'pdflatex';
  readonly #options: Required<PdftexLivePreviewOptions>;
  #format: Promise<string> | null = null;

  constructor(options: PdftexLivePreviewOptions) {
    this.#options = { mutool: 'mutool', ...options, workRoot: resolve(options.workRoot) };
  }

  async open(
    request: LivePreviewRequest,
    onEvent: (event: LivePreviewEvent) => void,
  ): Promise<LivePreviewSession> {
    const dir = join(this.#options.workRoot, request.projectId, randomUUID());
    await mkdir(join(dir, 'runs'), { recursive: true });
    const session = new PdftexSession(this.#options, request, dir, onEvent);
    for (const file of request.files) await session.writeSource(file);
    try {
      session.start(await this.#formatFile());
    } catch (error) {
      onEvent({ type: 'stopped', reason: `pdfTeX could not be started: ${String(error)}` });
    }
    return session;
  }

  /** Builds the `pdflatex` format with the patched binary, once per backend. */
  #formatFile(): Promise<string> {
    this.#format ??= (async () => {
      const dir = join(this.#options.workRoot, 'format');
      await mkdir(dir, { recursive: true });
      await run(
        this.#options.command,
        ['-ini', '-jobname=pdflatex', '-progname=pdflatex', '-etex', 'pdflatex.ini'],
        { cwd: dir, env: { ...process.env, ...this.#options.kpathsea } },
      );
      return join(dir, 'pdflatex.fmt');
    })();
    this.#format.catch(() => {
      this.#format = null; // Retried by the next session.
    });
    return this.#format;
  }
}

interface Engine {
  readonly process: ChildProcess;
  /** Output directory of the engine process itself (its log and `.aux` until the pause). */
  readonly dir: string;
  /** The `.aux` it read at `\begin{document}`, or `null` without one. */
  readonly aux: Buffer | null;
  readonly control: Duplex;
  /** Root-file bytes before the pause. */
  readonly preamble: Buffer;
  /** Project files the engine read before the pause. */
  readonly inputs: Set<string>;
  readonly ready: Promise<boolean>;
  isReady: boolean;
  readonly waiting: Map<string, (status: number | null) => void>;
  /** Per run: called when a page of the visible range is ready in a finisher's directory. */
  readonly pages: Map<string, (page: number, dir: string) => void>;
  /** A file it read before the pause changed: start a new engine. */
  stale: boolean;
  /**
   * Its paused processes form a chain: the engine, then snapshots in
   * document order. `reader` is the one that reads commands (the last one,
   * once a run's child exited); `null` while a run's child is running.
   */
  reader: number | null;
  readonly snapshots: Snapshot[];
  /** The running child of the current run, to cancel it. */
  leaf: number | null;
  /** Per run: the sources it typeset, which its snapshots record. */
  readonly runs: Map<string, { readonly root: Buffer; readonly version: number }>;
  /** Called when a process of the chain reads commands again (`resumed`). */
  readonly resumed: Map<number, (resumed: boolean) => void>;
}

/** A paused copy of a run's child, after a page was shipped out (level 3). */
interface Snapshot {
  readonly pid: number;
  /** Pages shipped out before it. */
  readonly page: number;
  /** Bytes of the root file read before it: a run with the same bytes can resume there. */
  readonly pos: number;
  readonly root: Buffer;
  /** `#version` when its run started: other files must not have changed since. */
  readonly version: number;
}

/** Most runs in a row without an edit to bring references up to date. */
const MAX_SETTLE_RUNS = 3;

/** A run of an engine's child that has not finished yet. */
interface InFlightRun {
  readonly engine: Engine;
  readonly id: string;
  /** The last page of the visible range was shown from this run. */
  shown: boolean;
}

class PdftexSession implements LivePreviewSession {
  readonly #options: Required<PdftexLivePreviewOptions>;
  readonly #rootFile: string;
  readonly #job: string;
  readonly #dir: string;
  readonly #srcDir: string;
  readonly #onEvent: (event: LivePreviewEvent) => void;
  readonly #files = new Map<string, Uint8Array>();
  #format = '';
  #engine: Engine | null = null;
  /** An engine starting in the background with a newer `.aux`, to replace `#engine`. */
  #next: Engine | null = null;
  #engines = 0;
  /** Runs started without an edit, to settle references; reset by an edit. */
  #settleRuns = 0;
  #closing = false;
  /** Runs one at a time; edits during a run are coalesced into one more. */
  #running = false;
  #pending = false;
  #runs = 0;
  /** File writes, in order; a run starts after those queued before it. */
  #writes: Promise<void> = Promise.resolve();
  /** The run loop, while one is going. */
  #loop: Promise<void> = Promise.resolve();
  /** Page renders, in order. */
  #renders: Promise<void> = Promise.resolve();
  #range: readonly [number, number] = [1, 1];
  #pdf: { readonly path: string; readonly pages: number; readonly run: number } | null = null;
  readonly #emitted = new Map<number, string>();
  /** The run whose content each emitted page shows: an older run's page never replaces it. */
  readonly #pageRuns = new Map<number, number>();
  #inFlight: InFlightRun | null = null;
  /** Counts changes to files other than the root file, which invalidate snapshots. */
  #version = 0;

  constructor(
    options: Required<PdftexLivePreviewOptions>,
    request: LivePreviewRequest,
    dir: string,
    onEvent: (event: LivePreviewEvent) => void,
  ) {
    this.#options = options;
    this.#rootFile = request.rootFile;
    this.#job = basename(request.rootFile).replace(/\.tex$/, '');
    this.#dir = dir;
    this.#srcDir = join(dir, 'src');
    this.#onEvent = onEvent;
  }

  async writeSource(file: ProjectFile): Promise<void> {
    this.#files.set(file.path, file.content);
    const path = join(this.#srcDir, ...file.path.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }

  start(format: string): void {
    this.#format = format;
    this.#schedule();
  }

  updateFile(file: ProjectFile): void {
    if (this.#closing) return;
    for (const engine of [this.#engine, this.#next]) {
      if (engine?.inputs.has(file.path) && file.path !== this.#rootFile) engine.stale = true;
    }
    if (file.path !== this.#rootFile) this.#version++;
    this.#files.set(file.path, file.content);
    this.#settleRuns = 0;
    this.#writes = this.#writes.then(() => this.writeSource(file)).catch(() => {});
    this.#schedule();
  }

  showPages(first: number, last: number): void {
    const from = Math.max(1, Math.floor(first));
    this.#range = [from, Math.max(from, Math.floor(last))];
    void this.#render();
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    this.#stopEngine(this.#engine);
    this.#stopEngine(this.#next);
    await Promise.all([this.#writes, this.#loop, this.#renders]);
    await rm(this.#dir, { recursive: true, force: true });
  }

  #schedule(): void {
    if (!this.#format || this.#closing) return;
    if (this.#running) {
      this.#pending = true;
      // The visible pages are on screen: the rest of the run is not worth waiting for.
      if (this.#inFlight?.shown) this.#cancel(this.#inFlight);
      return;
    }
    this.#running = true;
    this.#loop = (async () => {
      do {
        this.#pending = false;
        await this.#writes;
        await this.#runOnce().catch(() => {});
      } while (this.#pending && !this.#closing);
      this.#running = false;
    })();
  }

  /** Typesets the current sources once and shows the result. */
  async #runOnce(): Promise<void> {
    const root = Buffer.from(this.#files.get(this.#rootFile) ?? new Uint8Array());
    const offset = pauseOffset(root);
    let engine: Engine | null = null;
    if (offset !== null) {
      const preamble = root.subarray(0, offset);
      const fits = (candidate: Engine | null): candidate is Engine =>
        candidate !== null && !candidate.stale && candidate.preamble.equals(preamble);
      if (fits(this.#next) && (this.#next.isReady || !fits(this.#engine))) {
        // The background engine has the newer .aux: use it once it is ready.
        if (await this.#next.ready) this.#promoteNext();
      }
      if (!fits(this.#engine)) {
        this.#stopEngine(this.#engine);
        this.#stopEngine(this.#next);
        this.#next = null;
        this.#engine = await this.#startEngine(Buffer.from(preamble));
      }
      engine = this.#engine && (await this.#engine.ready) ? this.#engine : null;
    }
    if (this.#closing) return;

    const id = String(++this.#runs);
    const out = join(this.#dir, 'runs', id);
    await mkdir(out);
    // The child reads the root file from a copy, so later edits cannot change it mid-run.
    const main = `${out}.tex`;
    let status: number | null;
    if (engine) await writeFile(main, root);
    if (this.#closing) return;
    // The engine may have been stopped during the writes above (close()
    // ends its control connection): writing to it then would throw.
    // Level 3: the run resumes from the last snapshot before the edit.
    if (engine && !(await this.#resume(engine, root))) engine = null;
    if (this.#closing) return;
    if (engine && !engine.control.writableEnded) {
      // Pages of the visible range are shown as soon as the child ships them
      // out (level 3): a finisher closes the PDF there.
      const [first, last] = this.#range;
      const inFlight: InFlightRun = { engine, id, shown: false };
      this.#inFlight = inFlight;
      engine.runs.set(id, { root, version: this.#version });
      engine.reader = null;
      status = await new Promise<number | null>((resolveRun) => {
        engine.waiting.set(id, resolveRun);
        engine.pages.set(id, (page, pageDir) => {
          void this.#renderFinished(inFlight, page, join(pageDir, `${this.#job}.pdf`));
        });
        engine.control.write(`run\t${id}\t${main}\t${out}\t${first}\t${last}\n`);
      });
      this.#inFlight = null;
    } else {
      // No \begin{document} in the root file, or the engine failed: a full run.
      status = await this.#fullRun(out);
    }
    if (this.#closing) return;
    // References: the .aux is read at \begin{document}, which the engine has
    // already passed. When a run writes a different .aux, an engine that reads
    // it starts in the background and replaces the current one when ready.
    if (status === 0) {
      const aux = await readFile(join(out, `${this.#job}.aux`)).catch(() => null);
      if (aux && !(engine?.aux?.equals(aux) ?? false)) {
        await writeFile(join(this.#srcDir, `${this.#job}.aux`), aux);
        if (engine && !(this.#next?.aux?.equals(aux) ?? false)) {
          this.#stopEngine(this.#next);
          const next = await this.#startEngine(engine.preamble);
          this.#next = next;
          void next.ready.then((ready) => {
            if (!ready || this.#next !== next || this.#closing) return;
            if (!this.#running) this.#promoteNext();
            // Run once more on the new .aux so references settle without an
            // edit, as latexmk reruns; bounded in case the .aux never settles.
            if (this.#settleRuns < MAX_SETTLE_RUNS) {
              this.#settleRuns++;
              this.#schedule();
            }
          });
        }
      }
    }
    const log = await readFile(join(out, `${this.#job}.log`), 'latin1').catch(() => '');
    const pages = /Output written on .*?\((\d+) pages?/s.exec(log);
    // Without a PDF (fatal error, or no pages), the last one stays on screen.
    const previous = pages ? this.#pdf : { path: join(out, `${this.#job}.pdf`), pages: 0 };
    if (pages) {
      this.#pdf = { path: join(out, `${this.#job}.pdf`), pages: Number(pages[1]), run: Number(id) };
      this.#onEvent({ type: 'page-count', count: this.#pdf.pages, final: true });
      await this.#render();
    }
    if (previous) {
      const previousOut = dirname(previous.path);
      await rm(previousOut, { recursive: true, force: true });
      await rm(`${previousOut}.tex`, { force: true });
    }
  }

  /** Emits the pages of the visible range whose rendering changed. */
  #render(): Promise<void> {
    this.#renders = this.#renders.then(() => this.#renderNow()).catch(() => {});
    return this.#renders;
  }

  async #renderNow(): Promise<void> {
    const pdf = this.#pdf;
    if (!pdf || this.#closing) return;
    const first = Math.min(this.#range[0], pdf.pages);
    const last = Math.min(this.#range[1], pdf.pages);
    const pattern = join(dirname(pdf.path), 'page-%d.svg');
    await run(this.#options.mutool, [
      'draw',
      '-q',
      '-F',
      'svg',
      '-o',
      pattern,
      pdf.path,
      `${first}-${last}`,
    ]);
    for (let page = first; page <= last; page++) {
      const raw = await readFile(join(dirname(pdf.path), `page-${page}.svg`), 'utf8');
      if (this.#closing || this.#pdf !== pdf) return;
      this.#emitPage(page, pdf.run, raw);
    }
  }

  /** Emits a page rendered from run `run`, unless it is unchanged or a newer run's is shown. */
  #emitPage(page: number, run: number, raw: string): void {
    if ((this.#pageRuns.get(page) ?? 0) > run) return;
    this.#pageRuns.set(page, run);
    const svg = sanitizeSvg(raw);
    const hash = createHash('sha1').update(svg).digest('base64');
    if (this.#emitted.get(page) === hash) return;
    this.#emitted.set(page, hash);
    this.#onEvent({ type: 'page', page, svg });
  }

  /** Shows page `page` of a running child from its finisher's PDF (pages 1 to `page`). */
  #renderFinished(inFlight: InFlightRun, page: number, pdf: string): Promise<void> {
    this.#renders = this.#renders
      .then(async () => {
        const id = Number(inFlight.id);
        if (this.#closing || (this.#pageRuns.get(page) ?? 0) >= id) return;
        const pattern = join(dirname(pdf), 'page-%d.svg');
        await run(this.#options.mutool, [
          'draw',
          '-q',
          '-F',
          'svg',
          '-o',
          pattern,
          pdf,
          String(page),
        ]);
        const raw = await readFile(join(dirname(pdf), `page-${page}.svg`), 'utf8');
        if (this.#closing) return;
        this.#emitPage(page, id, raw);
        this.#onEvent({ type: 'page-count', count: page, final: false });
        if (page >= this.#range[1] && this.#inFlight === inFlight) {
          inFlight.shown = true;
          if (this.#pending) this.#cancel(inFlight);
        }
      })
      .catch(() => {});
    return this.#renders;
  }

  /** Kills the running child: its parent in the chain then reads commands again. */
  #cancel(run: InFlightRun): void {
    if (run.engine.leaf !== null) kill(run.engine.leaf);
  }

  /**
   * Makes the last snapshot whose state still holds for `root` (or the engine
   * itself) read commands: kills the processes after it in the chain and
   * waits for its `resumed`. Returns false if the engine exited.
   */
  async #resume(engine: Engine, root: Buffer): Promise<boolean> {
    const holds = (snapshot: Snapshot) =>
      snapshot.version === this.#version &&
      snapshot.pos <= root.length &&
      snapshot.root.subarray(0, snapshot.pos).equals(root.subarray(0, snapshot.pos));
    let kept = 0;
    while (kept < engine.snapshots.length && holds(engine.snapshots[kept]!)) kept++;
    const target = kept > 0 ? engine.snapshots[kept - 1]!.pid : engine.process.pid;
    if (target === undefined) return false;
    if (engine.reader === target) return true;
    const resumed = new Promise<boolean>((resolveResumed) => {
      engine.resumed.set(target, resolveResumed);
    });
    // In chain order, so none of them reads commands before it dies.
    for (const snapshot of engine.snapshots.splice(kept)) kill(snapshot.pid);
    if (engine.leaf !== null) kill(engine.leaf);
    return resumed;
  }

  #env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { ...process.env, ...this.#options.kpathsea, ...extra };
  }

  #args(): string[] {
    return [
      `-fmt=${this.#format}`,
      '-progname=pdflatex',
      '-interaction=nonstopmode',
      this.#rootFile,
    ];
  }

  /** Makes the background engine the current one. */
  #promoteNext(): void {
    if (!this.#next) return;
    this.#stopEngine(this.#engine);
    this.#engine = this.#next;
    this.#next = null;
  }

  async #startEngine(preamble: Buffer): Promise<Engine> {
    const dir = join(this.#dir, 'engines', String(++this.#engines));
    await mkdir(dir, { recursive: true });
    const aux = await readFile(join(this.#srcDir, `${this.#job}.aux`)).catch(() => null);
    // Its own output directory: the engine opens the .aux for writing at
    // \begin{document}, which must not truncate the one in src/.
    const child = spawn(this.#options.command, [`-output-directory=${dir}`, ...this.#args()], {
      cwd: this.#srcDir,
      env: this.#env({
        MYLEAF_PDFTEX_HOOKS: '1',
        MYLEAF_PDFTEX_PAUSE_OFFSET: String(preamble.length),
        MYLEAF_PDFTEX_CONTROL_FD: '3',
        MYLEAF_PDFTEX_SNAPSHOTS: '1',
      }),
      // fd 3 is a socket pair: the engine's control connection.
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
      // Own process group with its children, so close() can stop them all.
      detached: true,
    });
    const control = child.stdio[3] as Duplex;
    control.on('error', () => {}); // The exit is handled below.
    const inputs = new Set<string>();
    const waiting = new Map<string, (status: number | null) => void>();
    const pages = new Map<string, (page: number, dir: string) => void>();
    let markReady: (ready: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolveReady) => (markReady = resolveReady));
    const engine: Engine = {
      process: child,
      dir,
      aux,
      control,
      preamble,
      inputs,
      ready,
      isReady: false,
      waiting,
      pages,
      stale: false,
      reader: null,
      snapshots: [],
      leaf: null,
      runs: new Map(),
      resumed: new Map(),
    };
    createInterface({ input: control }).on('line', (line) => {
      const fields = line.split('\t');
      const [kind, first, second, third] = fields;
      if (kind === 'input' && first !== undefined) {
        const path = this.#projectPath(first);
        if (path !== null) inputs.add(path);
      } else if (kind === 'ready') {
        engine.isReady = true;
        engine.reader = child.pid ?? null;
        markReady(true);
      } else if (kind === 'page' && first !== undefined && third !== undefined) {
        pages.get(first)?.(Number(second), third);
      } else if (kind === 'started' && second !== undefined) {
        engine.leaf = Number(second);
      } else if (kind === 'snapshot' && first !== undefined && fields.length === 6) {
        const run = engine.runs.get(first);
        if (run) {
          const [page, pos, pid, leaf] = fields.slice(2).map(Number) as [
            number,
            number,
            number,
            number,
          ];
          engine.snapshots.push({ pid, page, pos, root: run.root, version: run.version });
          engine.leaf = leaf;
        }
      } else if (kind === 'resumed' && first !== undefined) {
        const pid = Number(first);
        // The processes after it in the chain are gone; a `resumed` from one
        // that was killed since is stale.
        const index = engine.snapshots.findIndex((snapshot) => snapshot.pid === pid);
        if (index === -1 && pid !== child.pid) return;
        engine.snapshots.length = index + 1;
        engine.reader = pid;
        engine.leaf = null;
        engine.resumed.get(pid)?.(true);
        engine.resumed.delete(pid);
      } else if (kind === 'done' && first !== undefined) {
        // Later `page` lines of this run are covered by its whole PDF.
        pages.delete(first);
        engine.runs.delete(first);
        waiting.get(first)?.(Number(second));
        waiting.delete(first);
      }
    });
    child.on('error', (error) => {
      markReady(false);
      if (!this.#closing && child.pid === undefined) {
        this.#closing = true;
        this.#onEvent({ type: 'stopped', reason: `pdfTeX could not be started: ${error.message}` });
      }
    });
    child.on('exit', () => {
      markReady(false);
      for (const resolveRun of waiting.values()) resolveRun(null);
      waiting.clear();
      pages.clear();
      for (const resolveResumed of engine.resumed.values()) resolveResumed(false);
      engine.resumed.clear();
      if (this.#engine === engine) this.#engine = null;
      if (this.#next === engine) this.#next = null;
    });
    return engine;
  }

  /** The project path of a file the engine read, or `null` outside the project. */
  #projectPath(path: string): string | null {
    const rel = relative(this.#srcDir, isAbsolute(path) ? path : join(this.#srcDir, path));
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    return rel.split(sep).join('/');
  }

  async #fullRun(out: string): Promise<number | null> {
    const child = spawn(this.#options.command, [`-output-directory=${out}`, ...this.#args()], {
      cwd: this.#srcDir,
      env: this.#env(),
      stdio: 'ignore',
    });
    const [code] = (await once(child, 'exit')) as [number | null];
    return code;
  }

  #stopEngine(engine: Engine | null): void {
    if (!engine) return;
    if (this.#engine === engine) this.#engine = null;
    if (this.#next === engine) this.#next = null;
    void rm(engine.dir, { recursive: true, force: true });
    if (!engine.process.pid) return;
    // Closing the control connection ends a paused engine and its children;
    // the group kill also ends one that is still in the preamble.
    engine.control.end();
    try {
      process.kill(-engine.process.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}
