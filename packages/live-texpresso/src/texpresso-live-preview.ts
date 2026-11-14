import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  LivePreviewBackend,
  LivePreviewEvent,
  LivePreviewRequest,
  LivePreviewSession,
} from '@myleaf/live-preview';
import type { ProjectFile } from '@myleaf/project';
import { sanitizeSvg } from './sanitize-svg.js';

export interface TexpressoLivePreviewOptions {
  /** Path of the patched `texpresso` binary (vendor/texpresso/build.sh). */
  readonly command: string;
  /** Directory holding per-session workspaces. */
  readonly workRoot: string;
  /**
   * Process whose exit stops every session, also when it dies without closing
   * them (crash, SIGKILL). Default: this process.
   */
  readonly ownerPid?: number;
}

/** Exit statuses of sh for a command that is not executable (126) or missing (127). */
const NOT_RUNNABLE: ReadonlySet<number | null> = new Set([126, 127]);

/** Time allowed for a graceful shutdown before the process group is killed. */
const STOP_GRACE_MS = 2_000;

/**
 * Runs `$@` (TeXpresso) and, beside it, a watcher that stops the whole
 * process group once the owner process `$1` is gone, polling once a second.
 * POSIX sh, so it works on Linux and macOS. The watcher ignores SIGTERM, so
 * it can follow up with SIGKILL; the shell's own exit status is TeXpresso's.
 * Stdin goes through fd 3: a background command's stdin is /dev/null.
 */
const SUPERVISOR = `
owner=$1; shift
exec 3<&0
"$@" <&3 3<&- &
exec 3<&-
child=$!
(
  trap '' TERM
  while kill -0 "$owner" 2>/dev/null; do sleep 1; done
  kill -TERM 0; sleep ${STOP_GRACE_MS / 1000}; kill -KILL 0
) </dev/null >/dev/null 2>&1 &
watcher=$!
wait "$child"; status=$?
kill "$watcher" 2>/dev/null
exit "$status"
`;

/**
 * LivePreviewBackend running one patched TeXpresso process per session
 * (ADR 0012). Workspace per session:
 *
 *   <workRoot>/<project-id>/<session>/src/    source files at session start
 *   <workRoot>/<project-id>/<session>/pages/  SVG pages exported by TeXpresso
 *
 * Later edits go to TeXpresso's in-memory file system (`open-base64`); it
 * rolls back to its latest snapshot before the first changed byte.
 */
export class TexpressoLivePreview implements LivePreviewBackend {
  readonly #command: string;
  readonly #workRoot: string;
  readonly #ownerPid: number;

  constructor(options: TexpressoLivePreviewOptions) {
    this.#command = options.command;
    this.#workRoot = resolve(options.workRoot);
    this.#ownerPid = options.ownerPid ?? process.pid;
  }

  async open(
    request: LivePreviewRequest,
    onEvent: (event: LivePreviewEvent) => void,
  ): Promise<LivePreviewSession> {
    const dir = join(this.#workRoot, request.projectId, randomUUID());
    const srcDir = join(dir, 'src');
    const pagesDir = join(dir, 'pages');
    await mkdir(pagesDir, { recursive: true });
    for (const file of request.files) {
      const path = join(srcDir, ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }

    const child = spawn(
      '/bin/sh',
      [
        '-c',
        SUPERVISOR,
        'texpresso-supervisor',
        String(this.#ownerPid),
        this.#command,
        '-json',
        '-texlive',
        request.rootFile,
      ],
      {
        cwd: srcDir,
        env: { ...process.env, SDL_VIDEODRIVER: 'dummy', TEXPRESSO_EXPORT_DIR: pagesDir },
        stdio: ['pipe', 'pipe', 'ignore'],
        // Own process group, so the engine processes it forks can be stopped together.
        detached: true,
      },
    );
    const session = new TexpressoSession(child, dir, onEvent);
    // Rerun with the previous pass's .aux once edits pause, so \ref, \pageref
    // and the table of contents resolve (at most 5 passes, upstream default).
    session.enableReruns();
    return session;
  }
}

class TexpressoSession implements LivePreviewSession {
  readonly #child: ChildProcess;
  readonly #dir: string;
  readonly #onEvent: (event: LivePreviewEvent) => void;
  readonly #exited: Promise<void>;
  #closing = false;
  /** Hash of the SVG last emitted per page, to skip re-exports with unchanged content. */
  readonly #emitted = new Map<number, string>();
  /** Serializes page reads so events are emitted in export order. */
  #reads: Promise<void> = Promise.resolve();

  constructor(child: ChildProcess, dir: string, onEvent: (event: LivePreviewEvent) => void) {
    this.#child = child;
    this.#dir = dir;
    this.#onEvent = onEvent;
    this.#exited = new Promise((resolveExit) => {
      child.on('exit', (code, signal) => {
        resolveExit();
        if (!this.#closing) {
          onEvent({
            type: 'stopped',
            reason: NOT_RUNNABLE.has(code)
              ? 'TeXpresso could not be started (not found or not executable)'
              : `TeXpresso exited (${signal ?? `code ${code}`})`,
          });
          void rm(dir, { recursive: true, force: true });
        }
      });
      child.on('error', (error) => {
        // A process that failed to start emits no 'exit'.
        if (child.pid === undefined) resolveExit();
        if (!this.#closing) onEvent({ type: 'stopped', reason: error.message });
      });
    });

    // Writes after TeXpresso exited fail with EPIPE; the exit is reported
    // through 'exit' above, so the write error itself is not needed.
    child.stdin?.on('error', () => {});

    let buffer = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        this.#handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
  }

  enableReruns(): void {
    this.#send(['rerun', true]);
  }

  updateFile(file: ProjectFile): void {
    this.#send(['open-base64', file.path, Buffer.from(file.content).toString('base64')]);
  }

  showPages(first: number, last: number): void {
    const from = Math.max(1, Math.floor(first));
    this.#send(['export-pages', from, Math.max(from, Math.floor(last))]);
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    // Forked engine processes may outlive TeXpresso itself: wait for the whole group.
    this.#signal('SIGTERM');
    if (!(await this.#groupExited(STOP_GRACE_MS))) {
      this.#signal('SIGKILL');
      await this.#groupExited(STOP_GRACE_MS);
    }
    await this.#exited;
    await rm(this.#dir, { recursive: true, force: true });
  }

  /** Waits until no process of the session's group is left, up to `timeoutMs`. */
  async #groupExited(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.#signal(0)) {
      if (Date.now() > deadline) return false;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    return true;
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;
    if (message[0] === 'page-count') {
      const [, count, final] = message as [string, number, boolean];
      // Queued behind page reads, so events keep TeXpresso's order.
      this.#reads = this.#reads.then(() => {
        if (!this.#closing) this.#onEvent({ type: 'page-count', count, final });
      });
      return;
    }
    if (message[0] !== 'page-exported') return;
    const [, page, path] = message as [string, number, string];
    this.#reads = this.#reads.then(async () => {
      const raw = await readFile(path, 'utf8').catch(() => null);
      if (raw === null || this.#closing) return;
      const svg = sanitizeSvg(raw);
      const hash = createHash('sha1').update(svg).digest('base64');
      if (this.#emitted.get(page) === hash) return;
      this.#emitted.set(page, hash);
      this.#onEvent({ type: 'page', page, svg });
    });
  }

  #send(command: readonly unknown[]): void {
    if (!this.#closing && this.#child.stdin?.writable) {
      this.#child.stdin.write(`${JSON.stringify(command)}\n`);
    }
  }

  /** Signals the session's process group; `0` only tests for existence. */
  #signal(signal: NodeJS.Signals | 0): boolean {
    if (this.#child.pid === undefined) return false;
    try {
      process.kill(-this.#child.pid, signal);
      return true;
    } catch {
      return false; // No process left in the group.
    }
  }
}
