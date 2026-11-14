import { parseProjectPath } from '@myleaf/project';
import { describe, expect, it } from 'vitest';
import { parseTexLog } from './diagnostics.js';

// Excerpt of a real pdfTeX log (TeX Live 2023, -file-line-error, max_print_line=10000).
const LOG = String.raw`
LaTeX Warning: Reference ${'`'}missing' on page 1 undefined on input line 4.


Overfull \hbox (174.82535pt too wide) detected at line 5
\OT1/cmr/m/n/10 This box is much too wide for its declared width
 []

(./chapters/one.tex
./chapters/one.tex:3: Undefined control sequence.
l.3 Bad \undefinedcmd
                      here.
The control sequence at the end of the top line
of your error message was never \def'ed.

LaTeX Font Info:    External font ${'`'}cmex10' loaded for size
(Font)              <14.4> on input line 4.

Package hyperref Warning: Token not allowed in a PDF string (Unicode):
(hyperref)                removing ${'`'}math shift' on input line 4.

/usr/share/texlive/texmf-dist/tex/latex/foo/foo.sty:12: LaTeX Error: Something broke.
! Emergency stop.

Package rerunfilecheck Warning: File ${'`'}main.out' has changed.
(rerunfilecheck)                Rerun to get outlines right
(rerunfilecheck)                or use package ${'`'}bookmark'.
`;

const resolvePath = (raw: string) => (raw.startsWith('./') ? parseProjectPath(raw.slice(2)) : null);

describe('parseTexLog', () => {
  it('extracts errors, warnings and bad boxes in log order', () => {
    expect(parseTexLog(LOG, resolvePath)).toEqual([
      {
        severity: 'warning',
        message: "Reference `missing' on page 1 undefined on input line 4.",
        file: null,
        line: 4,
      },
      {
        severity: 'info',
        message: 'Overfull \\hbox (174.82535pt too wide)',
        file: null,
        line: 5,
      },
      {
        severity: 'error',
        message: 'Undefined control sequence.',
        file: 'chapters/one.tex',
        line: 3,
      },
      {
        severity: 'warning',
        message:
          "Token not allowed in a PDF string (Unicode): removing `math shift' on input line 4.",
        file: null,
        line: 4,
      },
      {
        severity: 'error',
        message: 'LaTeX Error: Something broke.',
        file: null,
        line: null,
      },
      { severity: 'error', message: 'Emergency stop.', file: null, line: null },
      {
        severity: 'warning',
        message:
          "File `main.out' has changed. Rerun to get outlines right or use package `bookmark'.",
        file: null,
        line: null,
      },
    ]);
  });

  it('returns nothing for an empty log', () => {
    expect(parseTexLog('', resolvePath)).toEqual([]);
  });
});
