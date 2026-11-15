import { spawn } from 'node:child_process';

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

const isWindows = process.platform === 'win32';

/**
 * Runs a command without a shell. On timeout the whole process tree is
 * killed, so child processes (e.g. the TeX engine under latexmk) stop too:
 * through the process group on POSIX, with `taskkill /T` on Windows (where a
 * detached process has no console, which crashes MiKTeX's latexmk).
 */
export function runProcess(command: string, args: readonly string[], options: RunOptions) {
  return new Promise<ProcessResult>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: !isWindows,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) {
        return;
      }
      if (isWindows) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        }).on('error', () => child.kill());
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, timedOut, stdout, stderr });
    });
  });
}
