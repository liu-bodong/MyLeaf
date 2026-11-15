import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { delimiter } from 'node:path';

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
 * Removes PATH entries that are files (e.g. `...\bin\tool.exe` instead of
 * `...\bin`): MiKTeX scans PATH and fails on them ("cannot retrieve
 * attributes for the directory"). Windows only; the variable is `Path` there.
 */
export function withoutFilePathEntries(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isWindows) {
    return env;
  }
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
  const value = key === undefined ? undefined : env[key];
  if (key === undefined || value === undefined) {
    return env;
  }
  const entries = value.split(delimiter);
  const kept = entries.filter((entry) => {
    try {
      return !statSync(entry.replace(/[\\/]+$/, '')).isFile();
    } catch {
      return true;
    }
  });
  return kept.length === entries.length ? env : { ...env, [key]: kept.join(delimiter) };
}

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
      env: withoutFilePathEntries(options.env),
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
