import { CompletionContext } from '@codemirror/autocomplete';
import type { CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NO_COMPLETION_DATA, latexCompletion } from './latex-completion.js';
import type { CompletionData } from './latex-completion.js';

/** Completes at `|` in `text`. */
function complete(text: string, data: CompletionData = NO_COMPLETION_DATA) {
  const pos = text.indexOf('|');
  const state = EditorState.create({ doc: text.slice(0, pos) + text.slice(pos + 1) });
  return latexCompletion(() => data)(
    new CompletionContext(state, pos, false),
  ) as CompletionResult | null;
}

const labels = (result: CompletionResult | null) => result?.options.map((option) => option.label);

const DATA: CompletionData = {
  labels: ['fig:other'],
  citations: [{ key: 'knuth84', type: 'article', title: 'Literate Programming' }],
  commands: ['\\R', '\\section'],
  environments: ['claim'],
};

describe('latexCompletion', () => {
  it('offers commands after a backslash, with project commands once', () => {
    const result = complete('text \\sec|', DATA);
    expect(result?.from).toBe(5);
    const names = labels(result)!;
    expect(names).toContain('\\section');
    expect(names).toContain('\\R');
    expect(names.filter((name) => name === '\\section')).toHaveLength(1);
  });

  it('does not treat a line break as a command', () => {
    expect(complete('a \\\\|')).toBeNull();
    expect(complete('a \\\\b|')).toBeNull();
  });

  it('offers labels from the document and the project in ref arguments', () => {
    const result = complete('\\label{sec:a} see \\cref{sec:a,s|}', DATA);
    expect(labels(result)).toEqual(['sec:a', 'fig:other']);
    expect(result?.from).toBe('\\label{sec:a} see \\cref{sec:a,'.length);
  });

  it('offers bibliography keys in cite arguments, after optional arguments', () => {
    const result = complete('\\bibitem{local}\\citep[see][p.~2]{|', DATA);
    expect(labels(result)).toEqual(['knuth84', 'local']);
    expect(result?.options[0]?.info).toBe('Literate Programming');
  });

  it('offers environments in begin and end, including defined ones', () => {
    const begin = labels(complete('\\newenvironment{note}{}{}\n\\begin{al|', DATA))!;
    expect(begin).toEqual(expect.arrayContaining(['align', 'note', 'claim']));
    expect(complete('\\end{|')?.from).toBe('\\end{'.length);
  });

  it('offers nothing in plain text', () => {
    expect(complete('plain text|')).toBeNull();
  });
});
