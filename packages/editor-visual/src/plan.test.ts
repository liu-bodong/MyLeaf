import { parseLatex } from '@myleaf/latex-syntax';
import { describe, expect, it } from 'vitest';
import { planVisual } from './plan.js';
import type { VisualSpan, WidgetSpec } from './plan.js';

const widgetText = (widget: WidgetSpec) =>
  widget.type === 'marker'
    ? widget.label
    : widget.type === 'chip'
      ? `${widget.chip}:${widget.text}`
      : `image:${widget.path}`;

/** The text as visual mode shows it: hidden spans removed, folds as `[label]`, math as `⟨tex⟩`. */
function shown(text: string, spans: readonly VisualSpan[]): string {
  let out = '';
  let at = 0;
  for (const span of spans.filter((s) => s.kind !== 'style')) {
    const replacement =
      span.kind === 'fold'
        ? `[${span.label}]`
        : span.kind === 'math'
          ? `⟨${span.tex}⟩`
          : span.kind === 'widget'
            ? `«${widgetText(span.widget)}»`
            : '';
    out += text.slice(at, span.from) + replacement;
    at = span.to;
  }
  return out + text.slice(at);
}

const styled = (text: string, spans: readonly VisualSpan[]) =>
  spans.flatMap((s) => (s.kind === 'style' ? [[s.style, text.slice(s.from, s.to)]] : []));

const plan = (text: string, cursor: number | null = null) =>
  planVisual(text, parseLatex(text), cursor === null ? [] : [{ from: cursor, to: cursor }]);

describe('planVisual', () => {
  it('shows headings and text styles without their commands', () => {
    const text = String.raw`\section*{Intro} A \textbf{bold \emph{and} more} word.`;
    const spans = plan(text);
    expect(shown(text, spans)).toBe('Intro A bold and more word.');
    expect(styled(text, spans)).toEqual([
      ['heading-2', 'Intro'],
      ['bold', String.raw`bold \emph{and} more`],
      ['italic', 'and'],
    ]);
  });

  it('shows the source of a construct the cursor touches', () => {
    const text = String.raw`A \textbf{bold} and \emph{it}.`;
    const atBold = text.indexOf('bold');
    expect(shown(text, plan(text, atBold))).toBe(String.raw`A \textbf{bold} and it.`);
    // Next to the closing brace still counts as touching.
    expect(shown(text, plan(text, text.indexOf('}') + 1))).toBe(
      String.raw`A \textbf{bold} and it.`,
    );
  });

  it('keeps heading styles while the heading source is edited', () => {
    const text = String.raw`\subsection[Short]{Long title}`;
    const spans = plan(text, 3);
    expect(shown(text, spans)).toBe(text);
    expect(styled(text, spans)).toEqual([['heading-3', text]]);
  });

  it('leaves unknown commands and unclosed arguments as source', () => {
    const text = String.raw`\foo{x} \textbf{open $a$`;
    expect(shown(text, plan(text))).toBe(String.raw`\foo{x} \textbf{open ⟨a⟩`);
  });

  it('typesets math unless the cursor touches it', () => {
    const text = String.raw`Let $x^2$ and \(y\) be \[z\label{eq}\] or $$w$$.`;
    expect(shown(text, plan(text))).toBe('Let ⟨x^2⟩ and ⟨y⟩ be ⟨z⟩ or ⟨w⟩.');
    expect(plan(text).flatMap((s) => (s.kind === 'math' ? [s.display] : []))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // Right after the closing $ counts as touching.
    expect(shown(text, plan(text, text.indexOf(' and')))).toBe('Let $x^2$ and ⟨y⟩ be ⟨z⟩ or ⟨w⟩.');
  });

  it('typesets whole math environments and leaves unclosed or empty math as source', () => {
    const text = String.raw`\begin{align*}a &= b \label{x}\end{align*} $ $ $open`;
    expect(shown(text, plan(text))).toBe(String.raw`⟨\begin{align*}a &= b \end{align*}⟩ $ $ $open`);
    const numbered = String.raw`\begin{equation}x\end{equation}`;
    expect(shown(numbered, plan(numbered))).toBe(String.raw`⟨\begin{equation*}x\end{equation*}⟩`);
    const unclosed = String.raw`\begin{equation}a`;
    expect(shown(unclosed, plan(unclosed))).toBe(unclosed);
  });

  it('typesets math inside styled text and headings', () => {
    const text = String.raw`\section{On $\alpha$} \textbf{a $b$}`;
    expect(shown(text, plan(text))).toBe('On ⟨\\alpha⟩ a ⟨b⟩');
  });

  it('dims comments but keeps them', () => {
    const text = 'Text % note\nMore 50\\% done';
    const spans = plan(text);
    expect(shown(text, spans)).toBe(text);
    expect(styled(text, spans)).toEqual([['comment', '% note']]);
  });

  it('folds the preamble unless the cursor is in it', () => {
    const text =
      '\\documentclass{article}\n% setup\n\\usepackage{x}\n\\begin{document}\nHi\n\\end{document}';
    expect(shown(text, plan(text))).toBe(
      '[Preamble · 3 lines]\n\\begin{document}\nHi\n\\end{document}',
    );
    expect(shown(text, plan(text, 5))).toBe(text);
    // The end of the preamble is inside it; the start of the document is not.
    expect(shown(text, plan(text, text.indexOf('\\begin') - 1))).toBe(text);
    expect(shown(text, plan(text, 0))).toContain('[Preamble');
    // Nothing inside the fold is decorated separately.
    expect(plan(text).filter((s) => s.from < text.indexOf('\\begin'))).toHaveLength(1);
  });

  it('does not fold when \\begin{document} does not start a line', () => {
    const text = '\\documentclass{article} \\begin{document}x\\end{document}';
    expect(plan(text).some((s) => s.kind === 'fold')).toBe(false);
  });

  it('returns sorted spans whose hidden parts do not overlap', () => {
    const text = String.raw`\section{A \textbf{\emph{b}}} \textit{c} % d`;
    const spans = plan(text);
    expect(spans.map((s) => s.from)).toEqual([...spans.map((s) => s.from)].sort((a, b) => a - b));
    const hidden = spans.filter((s) => s.kind === 'hide');
    for (let i = 1; i < hidden.length; i++) {
      expect(hidden[i]!.from).toBeGreaterThanOrEqual(hidden[i - 1]!.to);
    }
    expect(shown(text, spans)).toBe('A b c % d');
  });

  it('shows list items as markers and hides lines holding only begin or end', () => {
    const text = [
      String.raw`\begin{enumerate}`,
      String.raw`  \item One`,
      String.raw`  \begin{itemize}`,
      String.raw`    \item Nested`,
      String.raw`  \end{itemize}`,
      String.raw`  \item[*] Two`,
      String.raw`\end{enumerate}`,
      'After',
    ].join('\n');
    expect(shown(text, plan(text, text.length))).toBe(
      '  «1.» One\n    «•» Nested\n  «*» Two\nAfter',
    );
    // The cursor on a hidden line shows it.
    const atNested = text.indexOf('\\begin{itemize}');
    expect(shown(text, plan(text, atNested))).toContain('  \\begin{itemize}\n');
  });

  it('numbers enumerate items by depth and bolds description terms', () => {
    const text = String.raw`\begin{enumerate}\item a \begin{enumerate}\item b \item c\end{enumerate}\end{enumerate} \begin{description}\item[Term] text\end{description}`;
    expect(shown(text, plan(text))).toBe('«1.» a «(a)» b «(b)» c «Term» text');
    expect(
      plan(text).flatMap((s) =>
        s.kind === 'widget' && s.widget.type === 'marker' ? [s.widget.term] : [],
      ),
    ).toEqual([false, false, false, true]);
  });

  it('shows references, citations and labels as chips', () => {
    const text = String.raw`See \cref{sec:a}, \eqref{eq:b} and \citep[p.~3]{smith20, li21}.\label{sec:c} \ref{}`;
    expect(shown(text, plan(text))).toBe(
      'See «ref:sec:a», «ref:(eq:b)» and «cite:[smith20, li21]».«label:sec:c» \\ref{}',
    );
    expect(shown(text, plan(text, text.indexOf('smith')))).toContain(
      String.raw`\citep[p.~3]{smith20, li21}`,
    );
  });

  it('shows figures as their image and caption, without layout commands', () => {
    const text = [
      String.raw`\begin{figure}[t]`,
      String.raw`  \centering`,
      String.raw`  \includegraphics[width=\linewidth]{figs/plot}`,
      String.raw`  \caption{Results \emph{so far}.}\label{fig:plot}`,
      String.raw`\end{figure}`,
    ].join('\n');
    expect(shown(text, plan(text, text.length + 1))).toBe(
      '  «image:figs/plot»\n  Results so far.«label:fig:plot»\n',
    );
    expect(styled(text, plan(text, text.length + 1))).toContainEqual([
      'caption',
      String.raw`Results \emph{so far}.`,
    ]);
  });
});
