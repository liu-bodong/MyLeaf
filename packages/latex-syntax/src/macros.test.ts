import { describe, expect, it } from 'vitest';
import { macroDefinitions } from './macros.js';

describe('macroDefinitions', () => {
  it('reads \\newcommand, \\renewcommand, \\providecommand and \\def', () => {
    const text = String.raw`
\newcommand{\R}{\mathbb{R}}
\renewcommand*\vec[1]{\mathbf{#1}}
\providecommand{\norm}[1]{\left\| #1 \right\|}
\def\inner#1#2{\langle #1, #2 \rangle}
\newcommand{\set}[1]{\{ #1 \}}
`;
    expect(macroDefinitions(text)).toEqual({
      '\\R': String.raw`\mathbb{R}`,
      '\\vec': String.raw`\mathbf{#1}`,
      '\\norm': String.raw`\left\| #1 \right\|`,
      '\\inner': String.raw`\langle #1, #2 \rangle`,
      '\\set': String.raw`\{ #1 \}`,
    });
  });

  it('turns \\DeclareMathOperator into \\operatorname', () => {
    expect(
      macroDefinitions(
        String.raw`\DeclareMathOperator{\argmax}{arg\,max} \DeclareMathOperator*{\E}{E}`,
      ),
    ).toEqual({
      '\\argmax': String.raw`\operatorname{arg\,max}`,
      '\\E': String.raw`\operatorname*{E}`,
    });
  });

  it('ignores comments, escaped characters and unfinished definitions', () => {
    const text = String.raw`% \newcommand{\hidden}{x}
50\% \newcommand{\ok}{y} \newcommand{\broken}{z`;
    expect(macroDefinitions(text)).toEqual({ '\\ok': 'y' });
  });

  it('skips definitions with an optional-argument default', () => {
    const text = String.raw`\newcommand{\opt}[2][a]{#1 #2}\newcommand{\after}{b}`;
    expect(macroDefinitions(text)).toEqual({ '\\after': 'b' });
  });

  it('lets later definitions replace earlier ones', () => {
    expect(macroDefinitions(String.raw`\newcommand{\x}{1}\renewcommand{\x}{2}`)).toEqual({
      '\\x': '2',
    });
  });
});
