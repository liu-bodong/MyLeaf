import { describe, expect, it } from 'vitest';
import { parseAux } from './aux.js';

describe('parseAux', () => {
  it('reads labels from plain LaTeX, hyperref and cleveref', () => {
    const aux = String.raw`\relax
\newlabel{sec:intro}{{1}{1}}
\newlabel{author info}{{2.3}{2}{}{subsection.2.3}{}}
\newlabel{author info@cref}{{[subsection][3][2]2.3}{[1][2][]2}}
\newlabel{fig:a}{{1}{4}{A caption with {braces}}{figure.caption.1}{}}
\newlabel{fig:a@cref}{{[figure][1][]1}{[1][3][]4}}
`;
    expect(parseAux(aux).labels).toEqual({
      'sec:intro': { number: '1', page: '1', type: null },
      'author info': { number: '2.3', page: '2', type: 'subsection' },
      'fig:a': { number: '1', page: '4', type: 'figure' },
    });
  });

  it('reads plain and natbib citations', () => {
    const aux = String.raw`\bibcite{plain}{3}
\bibcite{DudaHart2nd}{{2}{2000}{{Duda et~al.}}{{Duda, Hart, and Stork}}}
\bibcite{kearns89}{{3}{1989}{{Kearns}}{{}}}
\bibcite{newell}{{4}{1981}{{Newell \& Rosenbloom}}{{}}}`;
    expect(parseAux(aux).citations).toEqual({
      plain: { number: '3', year: null, authors: null },
      DudaHart2nd: { number: '2', year: '2000', authors: 'Duda et al.' },
      kearns89: { number: '3', year: '1989', authors: 'Kearns' },
      newell: { number: '4', year: '1981', authors: 'Newell & Rosenbloom' },
    });
  });

  it('lists the aux files of included chapters', () => {
    expect(parseAux(String.raw`\@input{chapters/intro.aux} \@input{b.aux}`).inputs).toEqual([
      'chapters/intro.aux',
      'b.aux',
    ]);
  });

  it('ignores malformed entries', () => {
    const aux = String.raw`\newlabel{a} \newlabel{b}{{1}{2}} \bibcite{c}{{1`;
    const parsed = parseAux(aux);
    expect(Object.keys(parsed.labels)).toEqual(['b']);
    expect(parsed.citations).toEqual({});
  });
});
