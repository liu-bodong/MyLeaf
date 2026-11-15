import { EditorSelection, Facet, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range as DecorationRange } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { macroDefinitions, parseLatex } from '@myleaf/latex-syntax';
import type { AuxReferences, LatexDocument, MacroDefinitions } from '@myleaf/latex-syntax';
import { planVisual } from './plan.js';
import type { TextStyle, VisualSpan, WidgetSpec } from './plan.js';
import { macrosKey, renderMath } from './render-math.js';

/** Macros defined in the project's other files; the document's own definitions win. */
const projectMacros = Facet.define<MacroDefinitions, MacroDefinitions>({
  combine: (values) => Object.assign({}, ...values) as MacroDefinitions,
});

/** Loads an `\includegraphics` path; resolves to a URL to show, or null. */
export type ImageLoader = (path: string) => Promise<string | null>;

const imageLoader = Facet.define<ImageLoader, ImageLoader | null>({
  combine: (values) => values.at(-1) ?? null,
});

/** Numbers from the last compile, for reference and citation chips. */
const compiledReferences = Facet.define<AuxReferences, AuxReferences | null>({
  combine: (values) => values.at(-1) ?? null,
});

/** Clean visual mode (`VisualOptions.clean`). */
const cleanMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
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

/** List markers and reference chips: text in place of a command. */
class LabelWidget extends WidgetType {
  readonly #text: string;
  readonly #className: string;

  constructor(text: string, className: string) {
    super();
    this.#text = text;
    this.#className = className;
  }

  override eq(other: LabelWidget): boolean {
    return other.#text === this.#text && other.#className === this.#className;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = this.#className;
    element.textContent = this.#text;
    return element;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** A loaded image, with its natural size so its line has the right height when drawn. */
interface LoadedImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** Records the outcome of loading an image path; null if it cannot be shown. */
const imageLoaded = StateEffect.define<{ path: string; image: LoadedImage | null }>();

/**
 * Loaded images by `\includegraphics` path. Loading happens outside the state;
 * the result arrives as an `imageLoaded` effect, which redraws the line, so
 * the editor measures its new height (a height change inside an existing
 * widget would leave the line numbers out of place).
 */
const loadedImages = StateField.define<ReadonlyMap<string, LoadedImage | null>>({
  create: () => new Map(),
  update: (value, transaction) => {
    if (transaction.startState.facet(imageLoader) !== transaction.state.facet(imageLoader)) {
      value = new Map();
    }
    for (const effect of transaction.effects) {
      if (effect.is(imageLoaded)) value = new Map(value).set(effect.value.path, effect.value.image);
    }
    return value;
  },
});

/** Loads and decodes an image, so its natural size is known. */
async function loadImage(load: ImageLoader, path: string): Promise<LoadedImage | null> {
  const url = await load(path);
  if (url === null) return null;
  const image = new Image();
  image.src = url;
  await image.decode();
  return { url, width: image.naturalWidth, height: image.naturalHeight };
}

/** `\includegraphics`: the image, "Loading image…", or its path when it cannot be shown. */
class ImageWidget extends WidgetType {
  readonly #path: string;
  /** Undefined while not loaded yet. */
  readonly #image: LoadedImage | null | undefined;
  readonly #load: ImageLoader | null;

  constructor(path: string, image: LoadedImage | null | undefined, load: ImageLoader | null) {
    super();
    this.#path = path;
    this.#image = image;
    this.#load = load;
  }

  override eq(other: ImageWidget): boolean {
    return other.#path === this.#path && other.#image === this.#image && other.#load === this.#load;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-visual-image';
    const image = this.#image;
    const load = this.#load;
    if (image !== undefined && image !== null) {
      const img = document.createElement('img');
      img.src = image.url;
      img.alt = this.#path;
      img.width = image.width;
      img.height = image.height;
      element.append(img);
    } else if (image === null || load === null) {
      element.className = 'cm-visual-image cm-visual-chip';
      element.textContent = `🖼 ${this.#path}`;
    } else {
      element.textContent = 'Loading image…';
      const path = this.#path;
      const done = (result: LoadedImage | null) => {
        if (view.dom.isConnected)
          view.dispatch({ effects: imageLoaded.of({ path, image: result }) });
      };
      loadImage(load, path).then(done, () => done(null));
    }
    return element;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function widgetFor(
  spec: WidgetSpec,
  load: ImageLoader | null,
  images: ReadonlyMap<string, LoadedImage | null>,
): WidgetType {
  switch (spec.type) {
    case 'marker':
      return new LabelWidget(spec.label, spec.term ? 'cm-visual-term' : 'cm-visual-marker');
    case 'chip':
      return new LabelWidget(
        spec.text,
        `cm-visual-chip cm-visual-chip-${spec.chip}${spec.missing ? ' cm-visual-chip-missing' : ''}`,
      );
    case 'image':
      return new ImageWidget(spec.path, images.get(spec.path), load);
    case 'command':
      return new LabelWidget(`\\${spec.name}`, 'cm-visual-chip cm-visual-command');
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
  load: ImageLoader | null,
  images: ReadonlyMap<string, LoadedImage | null>,
): DecorationRange<Decoration> | null {
  if (span.from >= span.to) return null;
  switch (span.kind) {
    case 'widget':
      return Decoration.replace({ widget: widgetFor(span.widget, load, images) }).range(
        span.from,
        span.to,
      );
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
  const load = state.facet(imageLoader);
  const images = state.field(loadedImages);
  const spans = planVisual(
    state.doc.toString(),
    document,
    state.selection.ranges,
    state.facet(compiledReferences),
    { clean: state.facet(cleanMode) },
  );
  return Decoration.set(
    spans
      .map((span) => toDecoration(span, macros, key, load, images))
      .filter((range) => range !== null),
    true,
  );
}

// Block decorations (the preamble fold) must come from state, not a view plugin.
const decorations = StateField.define<DecorationSet>({
  create: build,
  update: (value, transaction) =>
    transaction.docChanged ||
    transaction.selection !== undefined ||
    transaction.startState.facet(projectMacros) !== transaction.state.facet(projectMacros) ||
    transaction.startState.facet(imageLoader) !== transaction.state.facet(imageLoader) ||
    transaction.startState.facet(compiledReferences) !==
      transaction.state.facet(compiledReferences) ||
    transaction.effects.some((effect) => effect.is(imageLoaded))
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
  '.cm-visual-caption': { fontStyle: 'italic', opacity: '0.85' },
  '.cm-visual-term': { fontWeight: 'bold', marginRight: '0.4em' },
  '.cm-visual-marker': {
    display: 'inline-block',
    minWidth: '1.6em',
    paddingRight: '0.3em',
    textAlign: 'right',
    opacity: '0.75',
  },
  '.cm-visual-chip': {
    fontSize: '0.85em',
    padding: '0 0.35em',
    borderRadius: '4px',
    border: '1px solid rgba(127, 127, 127, 0.4)',
    background: 'rgba(127, 127, 127, 0.1)',
    whiteSpace: 'nowrap',
  },
  '.cm-visual-chip-cite': { color: '#2a7d4f' },
  '.cm-visual-chip-ref': { color: '#2b5fa8' },
  '.cm-visual-chip-label': { opacity: '0.6' },
  '.cm-visual-command': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', cursor: 'text' },
  '.cm-visual-chip-missing': { color: '#c0392b', borderColor: '#c0392b' },
  '.cm-visual-image img': {
    display: 'block',
    width: 'auto',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '320px',
    margin: '4px auto',
  },
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
  /** Loads `\includegraphics` images; without it, figures show their path. */
  readonly images?: ImageLoader;
  /** Numbers from the last compile; without them, chips show keys. */
  readonly references?: AuxReferences;
  /** Clean visual mode: commands visual mode does not render are shown as blocks with their name. */
  readonly clean?: boolean;
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
    ...(options.images === undefined ? [] : [imageLoader.of(options.images)]),
    ...(options.references === undefined ? [] : [compiledReferences.of(options.references)]),
    cleanMode.of(options.clean === true),
    EditorView.editorAttributes.of({ class: 'cm-visual' }),
    parsed,
    loadedImages,
    decorations,
    theme,
  ];
}
