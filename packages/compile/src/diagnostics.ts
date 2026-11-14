import type { ProjectPath } from '@myleaf/project';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Project file the message refers to, if known. */
  readonly file: ProjectPath | null;
  /** 1-based line, if known. */
  readonly line: number | null;
}

/**
 * Maps a file name as printed in the log (e.g. `./chapters/one.tex`) to a
 * project path, or `null` for files outside the project (e.g. packages).
 */
export type LogPathResolver = (rawPath: string) => ProjectPath | null;

// `file:line: message`, printed for errors when the engine runs with -file-line-error.
const FILE_LINE_ERROR = /^(.+?):(\d+): (.+)$/;
// `! message`, printed for errors that have no file/line context.
const BANG_ERROR = /^! (.+)$/;
// `LaTeX Warning: ...` and `Package foo Warning: ...`, with an optional `on input line N`.
const WARNING = /^(?:LaTeX|Package [\w.-]+|Class [\w.-]+) Warning: (.+)$/;
const INPUT_LINE = /on input line (\d+)\.?$/;
// `Overfull \hbox (12.0pt too wide) in paragraph at lines 10--12`
const BAD_BOX =
  /^((?:Over|Under)full \\[hv]box .*?)(?: (?:in paragraph|in alignment|detected) at lines? (\d+)(?:--\d+)?)?$/;
// Continuation lines of package warnings start with `(package-name)` and spaces.
const CONTINUATION = /^\([\w.-]+\)\s+(.*)$/;

/**
 * Extracts diagnostics from a TeX log. Assumes lines are not wrapped (run the
 * engine with a large `max_print_line`) and that `-file-line-error` was used.
 */
export function parseTexLog(log: string, resolvePath: LogPathResolver): Diagnostic[] {
  const lines = log.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const fileLine = FILE_LINE_ERROR.exec(line);
    if (fileLine?.[1] !== undefined && fileLine[2] !== undefined && fileLine[3] !== undefined) {
      const file = resolvePath(fileLine[1]);
      diagnostics.push({
        severity: 'error',
        message: fileLine[3],
        file,
        line: file === null ? null : Number(fileLine[2]),
      });
      continue;
    }

    const bang = BANG_ERROR.exec(line);
    if (bang?.[1] !== undefined) {
      diagnostics.push({ severity: 'error', message: bang[1], file: null, line: null });
      continue;
    }

    const warning = WARNING.exec(line);
    if (warning?.[1] !== undefined) {
      let message = warning[1];
      while (i + 1 < lines.length) {
        const continuation = CONTINUATION.exec(lines[i + 1] ?? '');
        if (continuation?.[1] === undefined) break;
        message += ` ${continuation[1]}`;
        i++;
      }
      const inputLine = INPUT_LINE.exec(message);
      diagnostics.push({
        severity: 'warning',
        message,
        file: null,
        line: inputLine?.[1] === undefined ? null : Number(inputLine[1]),
      });
      continue;
    }

    const badBox = BAD_BOX.exec(line);
    if (badBox?.[1] !== undefined) {
      diagnostics.push({
        severity: 'info',
        message: badBox[1],
        file: null,
        line: badBox[2] === undefined ? null : Number(badBox[2]),
      });
    }
  }

  return diagnostics;
}
