import { EditorSelection, Facet, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range as DecorationRange } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { macroDefinitions, parseLatex } from '@myleaf/latex-syntax';
import type { LatexDocument, MacroDefinitions } from '@myleaf/latex-syntax';
import { planVisual } from './plan.js';
import type { TextStyle, VisualSpan } from './plan.js';
import { macrosKey, renderMath } from './render-math.js';

/** Macros defined in the project's other files; the document's own definitions win. */
const projectMacros = Facet.define<MacroDefinitions, MacroDefinitions>({
  combine: (values) => Object.assign({}, ...values) as MacroDefinitions,
});

interface Parsed {
  readonly document: LatexDocument;
  readonly macros: MacroDefinitions;
}

const parse = (text: string): Parsed => ({
  document: parseLatex(text),
  macros: macroDefinitions(text),
});

/** The parsed document and its macros, recomputed only when the text changes. */
const parsed = StateField.define<Parsed>({
  create: (state) => parse(state.doc.toString()),
  update: (value, transaction) =>
    transaction.docChanged ? parse(transaction.state.doc.toString()) : value,
});

/** Typeset math; clicks reach the editor, which puts the cursor there and shows the source. */
class MathWidget extends WidgetType {
  readonly #html: string;
  readonly #display: boolean;

  constructor(html: string, display: boolean) {
    super();
    this.#html = html;
    this.#display = display;
  }

  override eq(other: MathWidget): boolean {
    return other.#html === this.#html && other.#display === this.#display;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = this.#display ? 'cm-visual-math cm-visual-math-display' : 'cm-visual-math';
    // KaTeX output (trust: false): escaped markup, no links or scripts.
    element.innerHTML = this.#html;
    return element;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

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

function toDecoration(
  span: VisualSpan,
  macros: MacroDefinitions,
  key: string,
): DecorationRange<Decoration> | null {
  if (span.from >= span.to) return null;
  switch (span.kind) {
    case 'math': {
      const rendering = renderMath(span.tex, span.display, macros, key);
      if (!rendering.ok) {
        // Shown as source, marked; the message is the tooltip.
        return Decoration.mark({
          class: 'cm-visual-math-error',
          attributes: { title: rendering.error },
        }).range(span.from, span.to);
      }
      return Decoration.replace({ widget: new MathWidget(rendering.html, span.display) }).range(
        span.from,
        span.to,
      );
    }
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
  const { document, macros: own } = state.field(parsed);
  const macros = { ...state.facet(projectMacros), ...own };
  const key = macrosKey(macros);
  const spans = planVisual(state.doc.toString(), document, state.selection.ranges);
  return Decoration.set(
    spans.map((span) => toDecoration(span, macros, key)).filter((range) => range !== null),
    true,
  );
}

// Block decorations (the preamble fold) must come from state, not a view plugin.
const decorations = StateField.define<DecorationSet>({
  create: build,
  update: (value, transaction) =>
    transaction.docChanged ||
    transaction.selection !== undefined ||
    transaction.startState.facet(projectMacros) !== transaction.state.facet(projectMacros)
      ? build(transaction.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.baseTheme({
  // Prose in the interface's proportional font, like a rendered document.
  '&.cm-visual .cm-content': {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
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
  '.cm-visual-math': { cursor: 'text' },
  '.cm-visual-math-display': { display: 'block', textAlign: 'center', margin: '4px 0' },
  '.cm-visual-math-display .katex-display': { margin: '0' },
  '.cm-visual-math-error': { textDecoration: 'underline wavy #d33' },
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

export interface VisualModeOptions {
  /** Macros defined elsewhere in the project, for typesetting math. */
  readonly macros?: MacroDefinitions;
}

/**
 * Visual mode (ADR 0016): renders recognised LaTeX in place; the source of a
 * construct appears when the selection touches it. Adding or removing this
 * extension does not change the document. KaTeX's stylesheet
 * (`katex/dist/katex.min.css`) must be loaded by the page.
 */
export function visualMode(options: VisualModeOptions = {}): Extension {
  return [
    projectMacros.of(options.macros ?? {}),
    EditorView.editorAttributes.of({ class: 'cm-visual' }),
    parsed,
    decorations,
    theme,
  ];
}
