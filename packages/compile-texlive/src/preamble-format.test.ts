import { describe, expect, it } from 'vitest';
import { extractPreamble, readRecordedInputs } from './preamble-format.js';

describe('extractPreamble', () => {
  it('returns the text before \\begin{document}', () => {
    expect(extractPreamble('\\documentclass{article}\n\\begin{document}\nx\n\\end{document}')).toBe(
      '\\documentclass{article}\n',
    );
    expect(extractPreamble('\\documentclass{article}\\begin{document}x')).toBe(
      '\\documentclass{article}',
    );
  });

  it('ignores commented-out \\begin{document}', () => {
    const source = '% \\begin{document}\n\\usepackage{x} % \\begin{document}\n\\begin{document}';
    expect(extractPreamble(source)).toBe(
      '% \\begin{document}\n\\usepackage{x} % \\begin{document}\n',
    );
  });

  it('treats \\% as text, not a comment', () => {
    expect(extractPreamble('50\\% \\begin{document}')).toBe('50\\% ');
  });

  it('handles CRLF line endings', () => {
    expect(extractPreamble('\\documentclass{article}\r\n\\begin{document}\r\nx')).toBe(
      '\\documentclass{article}\r\n',
    );
  });

  it('returns null without \\begin{document}', () => {
    expect(extractPreamble('\\documentclass{article}\n% \\begin{document}')).toBeNull();
  });
});

describe('readRecordedInputs', () => {
  it('keeps inputs inside the source directory, relative to it', () => {
    const recorded = [
      'PWD /work/src',
      'INPUT /usr/share/texlive/texmf-dist/tex/latex/base/article.cls',
      'INPUT ./sty/mine.sty',
      'INPUT sty/mine.sty',
      'INPUT /work/src/main.tex',
      'INPUT /work/other/secret.tex',
      'OUTPUT /work/out/preamble.fmt',
    ].join('\n');
    expect([...readRecordedInputs(recorded, '/work/src')].sort()).toEqual([
      'main.tex',
      'sty/mine.sty',
    ]);
  });
});
