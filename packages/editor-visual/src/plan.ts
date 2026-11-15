import type {
  ArgumentNode,
  CommandNode,
  LatexDocument,
  LatexNode,
  Range,
} from '@myleaf/latex-syntax';

export type TextStyle =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'mono'
  | 'smallcaps'
  | 'sans'
  | 'comment'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5';

/** What visual mode does to a range of the source. */
export type VisualSpan =
  /** Not shown (command names, braces). */
  | { readonly kind: 'hide'; readonly from: number; readonly to: number }
  /** Shown with a style. */
  | {
      readonly kind: 'style';
      readonly from: number;
      readonly to: number;
      readonly style: TextStyle;
    }
  /** Whole lines replaced by one line with a label (the preamble); `to` reveals it. */
  | {
      readonly kind: 'fold';
      readonly from: number;
      readonly to: number;
      readonly label: string;
    }
  /** Math to typeset in place of its source; `tex` is what the renderer receives. */
  | {
      readonly kind: 'math';
      readonly from: number;
      readonly to: number;
      readonly tex: string;
      readonly display: boolean;
    };

const TEXT_STYLES: Readonly<Record<string, TextStyle>> = {
  textbf: 'bold',
  textit: 'italic',
  textsl: 'italic',
  emph: 'italic',
  underline: 'underline',
  texttt: 'mono',
  textsc: 'smallcaps',
  textsf: 'sans',
  textrm: 'sans',
};

const HEADINGS: Readonly<Record<string, TextStyle>> = {
  part: 'heading-1',
  chapter: 'heading-1',
  section: 'heading-2',
  subsection: 'heading-3',
  subsubsection: 'heading-4',
  paragraph: 'heading-5',
  subparagraph: 'heading-5',
};

/** Whether any selection range touches `node` (ends included). */
const touches = (node: Range, selection: readonly Range[]) =>
  selection.some((range) => range.from <= node.to && range.to >= node.from);

/**
 * Decides how visual mode shows `text` (ADR 0016). A construct the selection
 * touches is shown as source; constructs not recognised are always source.
 * Spans are sorted by `from`; `hide`, `fold` and `math` spans never overlap.
 */
export function planVisual(
  text: string,
  document: LatexDocument,
  selection: readonly Range[],
): VisualSpan[] {
  const spans: VisualSpan[] = [];
  const fold = preambleFold(text, document, selection);
  if (fold !== null) spans.push(fold);

  const visit = (nodes: readonly LatexNode[]) => {
    for (const node of nodes) {
      if (fold !== null && node.from < fold.to) continue;
      switch (node.kind) {
        case 'comment':
          spans.push({ kind: 'style', from: node.from, to: node.to, style: 'comment' });
          break;
        case 'command': {
          const style = TEXT_STYLES[node.name] ?? HEADINGS[node.name];
          const content = lastMandatory(node);
          if (style !== undefined && content !== undefined) {
            styleCommand(node, content, style, selection, spans);
          }
          for (const arg of node.args) visit(arg.children);
          break;
        }
        case 'group':
          visit(node.children);
          break;
        case 'environment':
          if (node.math) {
            if (node.end !== null && !touches(node, selection)) {
              // The whole environment, so KaTeX lays out align, gather, etc.
              const tex = unnumbered(withoutLabels(text.slice(node.from, node.to)));
              spans.push({ kind: 'math', from: node.from, to: node.to, tex, display: true });
            }
          } else {
            visit(node.children);
          }
          break;
        case 'math':
          if (node.closed && !touches(node, selection)) {
            const tex = withoutLabels(text.slice(node.contentFrom, node.contentTo));
            if (tex.trim() !== '') {
              spans.push({
                kind: 'math',
                from: node.from,
                to: node.to,
                tex,
                display: node.display,
              });
            }
          }
          break;
      }
    }
  };
  visit(document.nodes);
  return spans.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * KaTeX numbers each formula on its own, so every equation would be (1).
 * Until numbers come from the last compile (ADR 0016, milestone 4), numbered
 * environments are typeset unnumbered.
 */
function unnumbered(tex: string): string {
  return tex.replace(
    /\\(begin|end)\{(equation|align|alignat|gather|multline|flalign|eqnarray)\}/g,
    '\\$1{$2*}',
  );
}

/** KaTeX does not support `\label`; labels are not part of the typeset math. */
function withoutLabels(tex: string): string {
  return tex.replace(/\\label\s*\{[^{}]*\}/g, '');
}

function lastMandatory(command: CommandNode): ArgumentNode | undefined {
  return command.args.findLast((arg) => !arg.optional);
}

/** `\cmd[…]{content}`: hides everything but the content, which gets `style`. */
function styleCommand(
  command: CommandNode,
  content: ArgumentNode,
  style: TextStyle,
  selection: readonly Range[],
  spans: VisualSpan[],
): void {
  if (!content.closed || touches(command, selection)) {
    if (style.startsWith('heading')) {
      // Keep the heading's look while its source is edited.
      spans.push({ kind: 'style', from: command.from, to: command.to, style });
    }
    return;
  }
  spans.push({ kind: 'hide', from: command.from, to: content.contentFrom });
  if (content.contentTo > content.contentFrom) {
    spans.push({ kind: 'style', from: content.contentFrom, to: content.contentTo, style });
  }
  spans.push({ kind: 'hide', from: content.contentTo, to: command.to });
}

/** Folds the lines before `\begin{document}` unless the selection is in them. */
function preambleFold(
  text: string,
  document: LatexDocument,
  selection: readonly Range[],
): VisualSpan | null {
  const begin = document.documentBegin;
  // Only whole lines can be folded: `\begin{document}` must start its line.
  if (begin === null || begin === 0 || text[begin - 1] !== '\n') return null;
  const fold = { from: 0, to: begin - 1 };
  // A cursor at the very start (where a newly opened document puts it) does
  // not count: the fold opens only for a selection inside the preamble.
  if (selection.some((range) => range.from <= fold.to && range.to > 0)) return null;
  const lines = text.slice(0, fold.to).split('\n').length;
  return { kind: 'fold', ...fold, label: `Preamble · ${lines} ${lines === 1 ? 'line' : 'lines'}` };
}
