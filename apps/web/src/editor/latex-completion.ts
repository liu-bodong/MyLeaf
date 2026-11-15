import { snippet, startCompletion } from '@codemirror/autocomplete';
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import type { BibEntry } from '@myleaf/latex-syntax';
import { bibitemKeys, environmentNames, labelNames } from '@myleaf/latex-syntax';

/** Names from the project's other files; the open document is read live. */
export interface CompletionData {
  readonly labels: readonly string[];
  readonly citations: readonly BibEntry[];
  /** Commands the project defines, with the backslash, e.g. `\R`. */
  readonly commands: readonly string[];
  readonly environments: readonly string[];
}

export const NO_COMPLETION_DATA: CompletionData = {
  labels: [],
  citations: [],
  commands: [],
  environments: [],
};

/**
 * Common commands. `${}` marks where the cursor goes; further `${}` fields
 * are reached with Tab.
 */
const COMMANDS: readonly (readonly [name: string, template: string])[] = [
  ['\\documentclass', '\\documentclass{${}}'],
  ['\\usepackage', '\\usepackage{${}}'],
  ['\\title', '\\title{${}}'],
  ['\\author', '\\author{${}}'],
  ['\\date', '\\date{${}}'],
  ['\\maketitle', '\\maketitle'],
  ['\\tableofcontents', '\\tableofcontents'],
  ['\\part', '\\part{${}}'],
  ['\\chapter', '\\chapter{${}}'],
  ['\\section', '\\section{${}}'],
  ['\\subsection', '\\subsection{${}}'],
  ['\\subsubsection', '\\subsubsection{${}}'],
  ['\\paragraph', '\\paragraph{${}}'],
  ['\\label', '\\label{${}}'],
  ['\\ref', '\\ref{${}}'],
  ['\\eqref', '\\eqref{${}}'],
  ['\\pageref', '\\pageref{${}}'],
  ['\\autoref', '\\autoref{${}}'],
  ['\\cref', '\\cref{${}}'],
  ['\\Cref', '\\Cref{${}}'],
  ['\\cite', '\\cite{${}}'],
  ['\\citep', '\\citep{${}}'],
  ['\\citet', '\\citet{${}}'],
  ['\\footnote', '\\footnote{${}}'],
  ['\\url', '\\url{${}}'],
  ['\\href', '\\href{${}}{${}}'],
  ['\\input', '\\input{${}}'],
  ['\\include', '\\include{${}}'],
  ['\\includegraphics', '\\includegraphics[width=${}\\linewidth]{${}}'],
  ['\\caption', '\\caption{${}}'],
  ['\\centering', '\\centering'],
  ['\\item', '\\item ${}'],
  ['\\textbf', '\\textbf{${}}'],
  ['\\textit', '\\textit{${}}'],
  ['\\texttt', '\\texttt{${}}'],
  ['\\textsc', '\\textsc{${}}'],
  ['\\emph', '\\emph{${}}'],
  ['\\underline', '\\underline{${}}'],
  ['\\newcommand', '\\newcommand{${}}{${}}'],
  ['\\renewcommand', '\\renewcommand{${}}{${}}'],
  ['\\newenvironment', '\\newenvironment{${}}{${}}{${}}'],
  ['\\bibliography', '\\bibliography{${}}'],
  ['\\bibliographystyle', '\\bibliographystyle{${}}'],
  ['\\printbibliography', '\\printbibliography'],
  ['\\addbibresource', '\\addbibresource{${}}'],
  ['\\newpage', '\\newpage'],
  ['\\clearpage', '\\clearpage'],
  ['\\noindent', '\\noindent'],
  ['\\vspace', '\\vspace{${}}'],
  ['\\hspace', '\\hspace{${}}'],
  ['\\frac', '\\frac{${}}{${}}'],
  ['\\dfrac', '\\dfrac{${}}{${}}'],
  ['\\sqrt', '\\sqrt{${}}'],
  ['\\sum', '\\sum_{${}}^{${}}'],
  ['\\prod', '\\prod_{${}}^{${}}'],
  ['\\int', '\\int_{${}}^{${}}'],
  ['\\lim', '\\lim_{${}}'],
  ['\\left', '\\left'],
  ['\\right', '\\right'],
  ['\\mathbb', '\\mathbb{${}}'],
  ['\\mathcal', '\\mathcal{${}}'],
  ['\\mathrm', '\\mathrm{${}}'],
  ['\\mathbf', '\\mathbf{${}}'],
  ['\\text', '\\text{${}}'],
  ['\\operatorname', '\\operatorname{${}}'],
  ['\\cdot', '\\cdot'],
  ['\\cdots', '\\cdots'],
  ['\\ldots', '\\ldots'],
  ['\\times', '\\times'],
  ['\\infty', '\\infty'],
  ['\\partial', '\\partial'],
  ['\\nabla', '\\nabla'],
  ['\\leq', '\\leq'],
  ['\\geq', '\\geq'],
  ['\\neq', '\\neq'],
  ['\\approx', '\\approx'],
  ['\\in', '\\in'],
  ['\\subseteq', '\\subseteq'],
  ['\\rightarrow', '\\rightarrow'],
  ['\\Rightarrow', '\\Rightarrow'],
  ['\\alpha', '\\alpha'],
  ['\\beta', '\\beta'],
  ['\\gamma', '\\gamma'],
  ['\\delta', '\\delta'],
  ['\\epsilon', '\\epsilon'],
  ['\\varepsilon', '\\varepsilon'],
  ['\\theta', '\\theta'],
  ['\\lambda', '\\lambda'],
  ['\\mu', '\\mu'],
  ['\\pi', '\\pi'],
  ['\\sigma', '\\sigma'],
  ['\\phi', '\\phi'],
  ['\\omega', '\\omega'],
  ['\\Delta', '\\Delta'],
  ['\\Sigma', '\\Sigma'],
  ['\\Omega', '\\Omega'],
];

const ENVIRONMENTS: readonly string[] = [
  'document',
  'abstract',
  'itemize',
  'enumerate',
  'description',
  'figure',
  'figure*',
  'table',
  'table*',
  'tabular',
  'center',
  'flushleft',
  'flushright',
  'quote',
  'quotation',
  'verbatim',
  'minipage',
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'split',
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'array',
  'theorem',
  'lemma',
  'proof',
  'definition',
  'thebibliography',
];

/** Lists that take one entry per line. */
const ITEM_ENVIRONMENTS = new Set(['itemize', 'enumerate', 'description']);

const LABEL_ARGUMENT = /\\(?:[A-Za-z]*ref|labelcref)\*?\{[^{}]*$/;
const CITE_ARGUMENT = /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{[^{}]*$/i;
const ENVIRONMENT_ARGUMENT = /\\(begin|end)\{[^{}\s]*$/;
const COMMAND = /\\[A-Za-z@]*$/;

/**
 * Completion for LaTeX: commands after `\`, environments in `\begin{…}` and
 * `\end{…}`, labels in `\ref`-style arguments, and bibliography keys in
 * `\cite`-style arguments (comma-separated lists included).
 */
export function latexCompletion(data: () => CompletionData): CompletionSource {
  return (context) =>
    keyArgument(context, data) ?? environmentArgument(context, data) ?? command(context, data);
}

function keyArgument(
  context: CompletionContext,
  data: () => CompletionData,
): CompletionResult | null {
  const before = textBefore(context);
  const isLabel = LABEL_ARGUMENT.test(before);
  if (!isLabel && !CITE_ARGUMENT.test(before)) return null;
  // The key being typed starts after `{` or the last comma.
  const typed = /[^{,\s]*$/.exec(before)![0];
  const from = context.pos - typed.length;
  const text = context.state.doc.toString();
  const options: Completion[] = isLabel
    ? merge(labelNames(text), data().labels).map((label) => ({ label, type: 'variable' }))
    : citations(text, data().citations);
  return { from, options, validFor: /^[^{},\s]*$/ };
}

function citations(text: string, entries: readonly BibEntry[]): Completion[] {
  const options: Completion[] = entries.map((entry) => ({
    label: entry.key,
    type: 'text',
    detail: entry.type,
    ...(entry.title === null ? {} : { info: entry.title }),
  }));
  const known = new Set(entries.map((entry) => entry.key));
  for (const key of bibitemKeys(text)) {
    if (!known.has(key)) options.push({ label: key, type: 'text', detail: 'bibitem' });
  }
  return options;
}

function environmentArgument(
  context: CompletionContext,
  data: () => CompletionData,
): CompletionResult | null {
  const match = ENVIRONMENT_ARGUMENT.exec(textBefore(context));
  if (match === null) return null;
  const isBegin = match[1] === 'begin';
  const commandFrom = context.pos - match[0].length;
  const from = commandFrom + match[0].indexOf('{') + 1;
  const names = merge(
    ENVIRONMENTS,
    environmentNames(context.state.doc.toString()),
    data().environments,
  );
  const options = names.map((name): Completion => ({
    label: name,
    type: 'type',
    apply: isBegin
      ? (view, completion, _from, to) => {
          const end = view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
          const body = ITEM_ENVIRONMENTS.has(name) ? '\\item ${}' : '${}';
          snippet(`\\begin{${name}}\n\t${body}\n\\end{${name}}`)(
            view,
            completion,
            commandFrom,
            end,
          );
        }
      : context.state.sliceDoc(context.pos, context.pos + 1) === '}'
        ? name
        : `${name}}`,
  }));
  return { from, options, validFor: /^[^{}\s]*$/ };
}

function command(context: CompletionContext, data: () => CompletionData): CompletionResult | null {
  const match = context.matchBefore(COMMAND);
  if (match === null) return null;
  // `\\` is a line break, not the start of a command.
  if (match.from > 0 && context.state.sliceDoc(match.from - 1, match.from) === '\\') return null;
  const builtin = new Set(COMMANDS.map(([name]) => name));
  const options: Completion[] = [
    {
      label: '\\begin',
      type: 'keyword',
      detail: '{environment}',
      boost: 1,
      apply: (view, _completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: '\\begin{' },
          selection: { anchor: from + '\\begin{'.length },
        });
        startCompletion(view);
      },
    },
    ...COMMANDS.map(([label, template]): Completion => ({
      label,
      type: 'function',
      apply: template === label ? label : snippet(template),
    })),
    ...data()
      .commands.filter((name) => !builtin.has(name))
      .map((label): Completion => ({ label, type: 'function', detail: 'project' })),
  ];
  return { from: match.from, options, validFor: /^\\[A-Za-z@]*$/ };
}

/** The current line up to the cursor. */
function textBefore(context: CompletionContext): string {
  const line = context.state.doc.lineAt(context.pos);
  return context.state.sliceDoc(line.from, context.pos);
}

function merge(...lists: (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}
