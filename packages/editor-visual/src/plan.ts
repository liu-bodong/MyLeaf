import type {
  ArgumentNode,
  AuxReferences,
  CommandNode,
  LatexDocument,
  LatexNode,
  Range,
} from '@myleaf/latex-syntax';
import { citationText, referenceText, tagLabels } from './references.js';

export type TextStyle =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'mono'
  | 'smallcaps'
  | 'sans'
  | 'comment'
  | 'caption'
  | 'term'
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
  /** A widget in place of the source: list markers, reference chips, images. */
  | {
      readonly kind: 'widget';
      readonly from: number;
      readonly to: number;
      readonly widget: WidgetSpec;
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
  caption: 'caption',
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

export type WidgetSpec =
  /** A list item's marker: `•`, `1.`, or a description term (`term: true`). */
  | { readonly type: 'marker'; readonly label: string; readonly term: boolean }
  /** A reference, citation or label, showing its keys (numbers come later). */
  | {
      readonly type: 'chip';
      readonly chip: 'cite' | 'ref' | 'label';
      readonly text: string;
      /** A key the last compile did not record (shown as `??` or `?`). */
      readonly missing: boolean;
    }
  /** `\includegraphics`: the image at `path`, as written in the source. */
  | { readonly type: 'image'; readonly path: string }
  /** Clean visual mode: a command visual mode does not render, shown by its name. */
  | { readonly type: 'command'; readonly name: string };

const CITATIONS = new Set([
  'cite',
  'citep',
  'citet',
  'citealp',
  'citeauthor',
  'citeyear',
  'nocite',
]);
const REFERENCES = new Set(['ref', 'autoref', 'cref', 'Cref', 'eqref', 'pageref']);
const LISTS = new Set(['itemize', 'enumerate', 'description']);
/** Environments whose \begin and \end lines are hidden; their content is shown. */
const FRAMES = new Set([...LISTS, 'figure', 'figure*', 'center']);
/** Commands that only affect layout, hidden outside the cursor. */
const LAYOUT_COMMANDS = new Set(['centering']);
/** Commands `command()` renders (besides text styles and headings). */
const RENDERED_COMMANDS = new Set([
  ...CITATIONS,
  ...REFERENCES,
  ...LAYOUT_COMMANDS,
  'item',
  'label',
  'includegraphics',
  // Parsed as part of environments; a stray one stays source.
  'begin',
  'end',
]);

/** Whether clean visual mode shows `name` as a command block: not rendered, not a control symbol. */
const isUnrendered = (name: string) =>
  /^[A-Za-z@]+$/.test(name) &&
  !RENDERED_COMMANDS.has(name) &&
  TEXT_STYLES[name] === undefined &&
  HEADINGS[name] === undefined;

export interface VisualOptions {
  /**
   * Clean visual mode: commands visual mode does not render are replaced by a
   * block with their name, together with the `{…}` groups right after them.
   */
  readonly clean?: boolean;
}
const BULLETS = ['•', '◦', '▪'];
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

interface ListContext {
  readonly kind: string;
  /** Nesting depth per list kind: LaTeX counts itemize and enumerate levels separately. */
  readonly depths: Readonly<Record<string, number>>;
  count: number;
}

/** LaTeX's default markers by list kind, depth and position. */
function marker(list: ListContext): string {
  const depth = list.depths[list.kind] ?? 1;
  if (list.kind === 'itemize') return BULLETS[(depth - 1) % BULLETS.length]!;
  const n = list.count;
  switch ((depth - 1) % 3) {
    case 0:
      return `${n}.`;
    case 1:
      return `(${ALPHA[(n - 1) % ALPHA.length]})`;
    default:
      return `${ROMAN[(n - 1) % ROMAN.length]}.`;
  }
}

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
 * Spans are sorted by `from`; `hide`, `fold`, `math` and `widget` spans never overlap.
 */
export function planVisual(
  text: string,
  document: LatexDocument,
  selection: readonly Range[],
  /** Numbers from the last compile; null shows keys. */
  references: AuxReferences | null = null,
  options: VisualOptions = {},
): VisualSpan[] {
  const spans: VisualSpan[] = [];
  const fold = preambleFold(text, document, selection);
  if (fold !== null) spans.push(fold);

  const visit = (nodes: readonly LatexNode[], list: ListContext | null) => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]!;
      if (fold !== null && node.from < fold.to) continue;
      switch (node.kind) {
        case 'comment':
          spans.push({ kind: 'style', from: node.from, to: node.to, style: 'comment' });
          break;
        case 'command': {
          if (options.clean === true && isUnrendered(node.name)) {
            // Groups right after a command without a known signature are its arguments.
            let last = index;
            let to = node.to;
            while (nodes[last + 1]?.kind === 'group' && nodes[last + 1]!.from === to) {
              last++;
              to = nodes[last]!.to;
            }
            const block = { from: node.from, to };
            if (!touches(block, selection)) {
              const widget: WidgetSpec = { type: 'command', name: node.name };
              spans.push({ kind: 'widget', ...block, widget });
              index = last;
              break;
            }
          }
          if (!command(text, node, list, selection, references, spans)) {
            for (const arg of node.args) visit(arg.children, list);
          }
          break;
        }
        case 'group':
          visit(node.children, list);
          break;
        case 'environment':
          if (FRAMES.has(node.name) && node.end !== null) {
            hideLine(text, node.begin, selection, spans);
            hideLine(text, node.end, selection, spans);
          }
          if (LISTS.has(node.name)) {
            const depths = { ...list?.depths };
            depths[node.name] = (depths[node.name] ?? 0) + 1;
            visit(node.children, { kind: node.name, depths, count: 0 });
          } else if (node.math) {
            if (node.end !== null && !touches(node, selection)) {
              // The whole environment, so KaTeX lays out align, gather, etc.
              const tex = tagLabels(unnumbered(text.slice(node.from, node.to)), references);
              spans.push({ kind: 'math', from: node.from, to: node.to, tex, display: true });
            }
          } else {
            visit(node.children, list);
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
  visit(document.nodes, null);
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

/**
 * Plans a command. Returns true if it replaced the whole command (so its
 * arguments are not visited).
 */
function command(
  text: string,
  node: CommandNode,
  list: ListContext | null,
  selection: readonly Range[],
  references: AuxReferences | null,
  spans: VisualSpan[],
): boolean {
  const style = TEXT_STYLES[node.name] ?? HEADINGS[node.name];
  const content = lastMandatory(node);
  if (style !== undefined && content !== undefined) {
    styleCommand(node, content, style, selection, spans);
    return false;
  }
  if (node.name === 'item' && list !== null) {
    list.count++;
    if (touches(node, selection)) return true;
    const label = node.args[0];
    const custom = label?.closed === true ? text.slice(label.contentFrom, label.contentTo) : null;
    const widget: WidgetSpec =
      custom !== null
        ? { type: 'marker', label: custom, term: list.kind === 'description' }
        : { type: 'marker', label: marker(list), term: false };
    spans.push({ kind: 'widget', from: node.from, to: node.to, widget });
    return true;
  }
  if (LAYOUT_COMMANDS.has(node.name)) {
    hideLine(text, node, selection, spans);
    return true;
  }
  const keys = content?.closed === true ? text.slice(content.contentFrom, content.contentTo) : null;
  let widget: WidgetSpec | null = null;
  if (keys === null || keys.trim() === '') {
    widget = null;
  } else if (CITATIONS.has(node.name)) {
    widget = { type: 'chip', chip: 'cite', ...citationText(node.name, keys, references) };
  } else if (REFERENCES.has(node.name)) {
    widget = { type: 'chip', chip: 'ref', ...referenceText(node.name, keys, references) };
  } else if (node.name === 'label') {
    widget = { type: 'chip', chip: 'label', text: keys.trim(), missing: false };
  } else if (node.name === 'includegraphics') {
    widget = { type: 'image', path: keys.trim() };
  }
  if (widget === null) return false;
  if (!touches(node, selection))
    spans.push({ kind: 'widget', from: node.from, to: node.to, widget });
  return true;
}

/**
 * Hides a command; if nothing else is on its line, hides the whole line
 * (including its line break), so no empty line is left.
 */
function hideLine(
  text: string,
  node: Range,
  selection: readonly Range[],
  spans: VisualSpan[],
): void {
  const lineStart = text.lastIndexOf('\n', node.from - 1) + 1;
  const newline = text.indexOf('\n', node.to);
  const lineEnd = newline === -1 ? text.length : newline;
  const alone =
    text.slice(lineStart, node.from).trim() === '' && text.slice(node.to, lineEnd).trim() === '';
  const range = alone
    ? { from: lineStart, to: newline === -1 ? lineEnd : lineEnd + 1 }
    : { from: node.from, to: node.to };
  // The cursor anywhere on a hidden line shows it (to: lineEnd, not past the break).
  if (touches(alone ? { from: lineStart, to: lineEnd } : node, selection)) return;
  spans.push({ kind: 'hide', ...range });
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
