import { describe, expect, it } from 'vitest';
import { includeCandidates, outlineItems, projectOutline } from './outline.js';
import type { OutlineEntry } from './outline.js';

/** Titles nested as `[title, children]`, for compact assertions. */
type Shape = [string, Shape[]];
const shape = (entries: readonly OutlineEntry[]): Shape[] =>
  entries.map((entry) => [entry.title, shape(entry.children)]);

describe('outlineItems', () => {
  it('finds headings and includes in source order, skipping comments and verbatim', () => {
    const text = String.raw`\documentclass{article}
\begin{document}
\section{Intro}
% \section{Commented}
\input{chapters/a}
\begin{verbatim}
\section{Verbatim}
\end{verbatim}
\subsection*{Starred}
\include{b}
\end{document}`;
    expect(
      outlineItems(text).map((item) =>
        item.kind === 'heading'
          ? [item.command, item.title, item.starred]
          : [item.command, item.target],
      ),
    ).toEqual([
      ['section', 'Intro', false],
      ['input', 'chapters/a'],
      ['subsection', 'Starred', true],
      ['include', 'b'],
    ]);
  });

  it('turns titles into plain text', () => {
    const text = String.raw`\section[Short]{A \emph{new} \textbf{bold}~title with $x^2$, \LaTeX{} \& more % note
 here}`;
    const [heading] = outlineItems(text);
    expect(heading).toMatchObject({
      kind: 'heading',
      title: 'A new bold title with $x^2$, LaTeX & more here',
    });
  });

  it('ignores sectioning commands without a title', () => {
    expect(outlineItems(String.raw`\section \input`)).toEqual([]);
  });
});

describe('includeCandidates', () => {
  it('follows TeX: \\include adds .tex, \\input tries .tex first', () => {
    expect(includeCandidates('include', 'ch/one')).toEqual(['ch/one.tex']);
    expect(includeCandidates('input', 'ch/one')).toEqual(['ch/one.tex', 'ch/one']);
    expect(includeCandidates('input', './ch/one.tex')).toEqual(['ch/one.tex']);
  });
});

describe('projectOutline', () => {
  const read = (files: Record<string, string>) => (path: string) => files[path] ?? null;

  it('expands included files in place and nests by depth', () => {
    const files = {
      'main.tex': String.raw`\chapter{One}
\input{one}
\chapter{Two}
\section{Two A}
\include{missing}`,
      'one.tex': String.raw`\section{One A}

\subsection{One A i}
\section{One B}`,
    };
    const outline = projectOutline('main.tex', read(files));
    expect(shape(outline)).toEqual([
      [
        'One',
        [
          ['One A', [['One A i', []]]],
          ['One B', []],
        ],
      ],
      ['Two', [['Two A', []]]],
    ]);
    expect(outline[0]!.children[0]!.children[0]).toMatchObject({ file: 'one.tex', line: 3 });
    expect(outline[1]).toMatchObject({ file: 'main.tex', line: 3 });
  });

  it('puts a heading shallower than the first one at the top level', () => {
    const files = { 'main.tex': String.raw`\subsection{Deep}\section{Shallow}\subsection{Under}` };
    expect(shape(projectOutline('main.tex', read(files)))).toEqual([
      ['Deep', []],
      ['Shallow', [['Under', []]]],
    ]);
  });

  it('skips include cycles and a missing root', () => {
    const files = {
      'main.tex': String.raw`\section{Main}\input{a}`,
      'a.tex': String.raw`\section{A}\input{main}`,
    };
    expect(shape(projectOutline('main.tex', read(files)))).toEqual([
      ['Main', []],
      ['A', []],
    ]);
    expect(projectOutline('none.tex', read(files))).toEqual([]);
  });
});
