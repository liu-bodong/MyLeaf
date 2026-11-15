import { EditorSelection, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range as DecorationRange } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { parseLatex } from '@myleaf/latex-syntax';
import type { LatexDocument } from '@myleaf/latex-syntax';
import { planVisual } from './plan.js';
import type { TextStyle, VisualSpan } from './plan.js';

/** The parsed document, reparsed only when the text changes. */
const parsed = StateField.define<LatexDocument>({
  create: (state) => parseLatex(state.doc.toString()),
  update: (value, transaction) =>
    transaction.docChanged ? parseLatex(transaction.state.doc.toString()) : value,
});

/** Replaces the folded preamble; clicking it moves the cursor into it, which shows it. */
class FoldWidget extends WidgetType {
  readonly #label: string;
  /** Where the cursor goes: the end of the preamble. */
  readonly #reveal: number;

  constructor(label: string, reveal: number) {
    super();
    this.#label = label;
    this.#reveal = reveal;
  }

  override eq(other: FoldWidget): boolean {
    return other.#label === this.#label && other.#reveal === this.#reveal;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-visual-fold';
    button.textContent = `${this.#label} ▸`;
    button.title = 'Show the preamble';
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.#reveal), scrollIntoView: true });
      view.focus();
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

const marks = new Map<TextStyle, Decoration>();
const markFor = (style: TextStyle) => {
  let mark = marks.get(style);
  if (mark === undefined) {
    mark = Decoration.mark({ class: `cm-visual-${style}` });
    marks.set(style, mark);
  }
  return mark;
};
const hidden = Decoration.replace({});

function toDecoration(span: VisualSpan): DecorationRange<Decoration> | null {
  if (span.from >= span.to) return null;
  switch (span.kind) {
    case 'hide':
      return hidden.range(span.from, span.to);
    case 'style':
      return markFor(span.style).range(span.from, span.to);
    case 'fold':
      return Decoration.replace({ widget: new FoldWidget(span.label, span.to), block: true }).range(
        span.from,
        span.to,
      );
  }
}

function build(state: EditorState): DecorationSet {
  const spans = planVisual(state.doc.toString(), state.field(parsed), state.selection.ranges);
  return Decoration.set(
    spans.map(toDecoration).filter((range) => range !== null),
    true,
  );
}

// Block decorations (the preamble fold) must come from state, not a view plugin.
const decorations = StateField.define<DecorationSet>({
  create: build,
  update: (value, transaction) =>
    transaction.docChanged || transaction.selection !== undefined
      ? build(transaction.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.baseTheme({
  '.cm-visual-bold': { fontWeight: 'bold' },
  '.cm-visual-italic': { fontStyle: 'italic' },
  '.cm-visual-underline': { textDecoration: 'underline' },
  '.cm-visual-mono': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
  '.cm-visual-smallcaps': { fontVariant: 'small-caps' },
  '.cm-visual-sans': { fontFamily: 'system-ui, sans-serif' },
  '.cm-visual-comment': { opacity: '0.55' },
  '.cm-visual-heading-1': { fontSize: '1.6em', fontWeight: 'bold' },
  '.cm-visual-heading-2': { fontSize: '1.4em', fontWeight: 'bold' },
  '.cm-visual-heading-3': { fontSize: '1.2em', fontWeight: 'bold' },
  '.cm-visual-heading-4': { fontSize: '1.05em', fontWeight: 'bold' },
  '.cm-visual-heading-5': { fontWeight: 'bold' },
  '.cm-visual-fold': {
    font: 'inherit',
    fontSize: '0.85em',
    margin: '2px 0',
    padding: '1px 8px',
    border: '1px solid currentColor',
    borderRadius: '4px',
    background: 'transparent',
    color: 'inherit',
    opacity: '0.6',
    cursor: 'pointer',
  },
});

/**
 * Visual mode (ADR 0016): renders recognised LaTeX in place; the source of a
 * construct appears when the selection touches it. Adding or removing this
 * extension does not change the document.
 */
export function visualMode(): Extension {
  return [parsed, decorations, theme];
}
