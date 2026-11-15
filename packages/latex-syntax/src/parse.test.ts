import { describe, expect, it } from 'vitest';
import { parseLatex } from './parse.js';
import type { CommandNode, EnvironmentNode, LatexNode, MathNode } from './parse.js';

const slice = (text: string, node: { from: number; to: number }) => text.slice(node.from, node.to);
const only = <T extends LatexNode>(nodes: readonly LatexNode[], kind: T['kind']) =>
  nodes.filter((node): node is T => node.kind === kind);

describe('parseLatex', () => {
  it('reads commands with their declared arguments', () => {
    const text = String.raw`\section*[Short]{A \emph{new} title} after`;
    const [section] = only<CommandNode>(parseLatex(text).nodes, 'command');
    expect(section).toMatchObject({ name: 'section', starred: true });
    expect(slice(text, section!)).toBe(String.raw`\section*[Short]{A \emph{new} title}`);
    const [short, title] = section!.args;
    expect(short).toMatchObject({ optional: true, closed: true });
    expect(text.slice(title!.contentFrom, title!.contentTo)).toBe(String.raw`A \emph{new} title`);
    const [emph] = only<CommandNode>(title!.children, 'command');
    expect(slice(text, emph!)).toBe(String.raw`\emph{new}`);
  });

  it('gives unknown commands no arguments and keeps groups after them', () => {
    const { nodes } = parseLatex(String.raw`\foo{bar} \textbf
{bold}`);
    expect(nodes.map((n) => n.kind)).toEqual(['command', 'group', 'command']);
    expect(nodes[2]).toMatchObject({ name: 'textbf', args: [{ optional: false }] });
  });

  it('does not read arguments across a blank line', () => {
    const { nodes } = parseLatex('\\textbf\n\n{x}');
    expect(nodes.map((n) => n.kind)).toEqual(['command', 'group']);
  });

  it('reads control symbols, escaped characters and comments', () => {
    const text = '50\\% done % a comment\n\\\\ next';
    const { nodes } = parseLatex(text);
    expect(nodes.map((n) => (n.kind === 'command' ? n.name : n.kind))).toEqual([
      '%',
      'comment',
      '\\',
    ]);
    expect(slice(text, nodes[1]!)).toBe('% a comment');
  });

  it('reads all four kinds of math without parsing their content', () => {
    const text = String.raw`$a \} b$ and $$c$$ and \(d\) and \[e\] and $\$5$`;
    const math = only<MathNode>(parseLatex(text).nodes, 'math');
    expect(math.map((m) => [text.slice(m.contentFrom, m.contentTo), m.display])).toEqual([
      [String.raw`a \} b`, false],
      ['c', true],
      ['d', false],
      ['e', true],
      [String.raw`\$5`, false],
    ]);
  });

  it('ends unclosed inline math at a blank line', () => {
    const text = '$x + y\n\nNext paragraph $z$';
    const math = only<MathNode>(parseLatex(text).nodes, 'math');
    expect(math.map((m) => [m.closed, text.slice(m.contentFrom, m.contentTo)])).toEqual([
      [false, 'x + y'],
      [true, 'z'],
    ]);
  });

  it('nests environments and finds \\begin{document}', () => {
    const text = String.raw`\documentclass{article}
\begin{document}
\begin{itemize}\item One \item[b] Two\end{itemize}
\end{document}`;
    const parsed = parseLatex(text);
    expect(parsed.documentBegin).toBe(text.indexOf('\\begin{document}'));
    const [document] = only<EnvironmentNode>(parsed.nodes, 'environment');
    expect(document).toMatchObject({ name: 'document', end: { name: 'end' }, to: text.length });
    const [itemize] = only<EnvironmentNode>(document!.children, 'environment');
    expect(itemize!.name).toBe('itemize');
    const items = only<CommandNode>(itemize!.children, 'command');
    expect(items.map((item) => item.args.length)).toEqual([0, 1]);
  });

  it('keeps math and verbatim environments raw', () => {
    const text = String.raw`\begin{align*}a &= \textbf{b} \\ c\end{align*}\begin{verbatim}\end{x} %\end{verbatim}`;
    const [align, verbatim] = only<EnvironmentNode>(parseLatex(text).nodes, 'environment');
    expect(align).toMatchObject({ name: 'align*', math: true, raw: true, children: [] });
    expect(text.slice(align!.contentFrom, align!.contentTo)).toBe(String.raw`a &= \textbf{b} \\ c`);
    expect(verbatim).toMatchObject({ name: 'verbatim', raw: true, math: false });
    expect(text.slice(verbatim!.contentFrom, verbatim!.contentTo)).toBe(String.raw`\end{x} %`);
  });

  it('recovers from unclosed and mismatched input', () => {
    const text = String.raw`\begin{a}\begin{b} x \end{a} } \textbf{open`;
    const { nodes } = parseLatex(text);
    const [a] = only<EnvironmentNode>(nodes, 'environment');
    expect(a).toMatchObject({ name: 'a', end: { name: 'end' } });
    const [b] = only<EnvironmentNode>(a!.children, 'environment');
    expect(b).toMatchObject({ name: 'b', end: null });
    const bold = nodes.at(-1) as CommandNode;
    expect(bold.args[0]).toMatchObject({ closed: false, to: text.length });
  });

  it('parses a 100 kB document quickly', () => {
    const paragraph = String.raw`Text with \emph{emphasis}, $x^2$ and \cite{key}. % note
`;
    const text = `\\begin{document}\n${paragraph.repeat(1900)}\\end{document}`;
    expect(text.length).toBeGreaterThan(100_000);
    const started = performance.now();
    parseLatex(text);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
