# 0016. Visual mode: rendering in place over the LaTeX source

- Status: Accepted
- Date: 2026-11-14
- Refines: ADR 0006 (L2, "shared with visual mode"), ADR 0013 (Code/Visual switch)

## Context

The owner wants a visual mode that reads like rendered LaTeX and edits like
markdown, so writing does not require reading raw commands. The editor
toolbar already has a Code/Visual switch (ADR 0013), disabled.

Constraints from earlier decisions:

- The `.tex` source is what compiles, what comments and suggestions anchor
  to (ADR 0005, 0015) and, later, what several people edit at once (ADR 0004).
- Papers use custom macros, templates and packages that no converter knows.
- Speed matters (ADR 0006).

Two approaches exist:

- **Rich-text editor with conversion** (a ProseMirror-style document,
  converted from and back to LaTeX). Conversion is lossy and unstable on
  unknown macros, rewrites untouched source (diff noise, broken anchors), and
  needs a second document model next to the Yjs text.
- **Rendering in place** (like Obsidian's or Typora's live preview): the
  editor keeps editing the source; recognised constructs are drawn rendered,
  and the source appears where the cursor is.

## Decision

### Approach

Visual mode is rendering in place on the same CodeMirror editor and the same
document. The Code/Visual switch only adds or removes an editor extension:
same text, undo history, cursor and (later) collaboration and annotation
decorations. Nothing is converted or rewritten.

- A recognised construct is rendered unless the selection touches it; then
  its source is shown, editable as usual.
- Anything not recognised stays visible as source (no loss, no guessing).
- Only the visible part of the document is decorated (CodeMirror viewport).

### Parsing

A new pure-TypeScript domain package, `@myleaf/latex-syntax`, parses LaTeX
into a tree of commands, arguments, groups, environments, math and comments,
with source offsets. No dependencies, unit-tested, also usable later by
navigation (outline, labels) and the table editor. It recognises structure
only; it does not expand macros. CodeMirror's `stex` mode only tokenises, so
it cannot provide this.

### Rendering (first version)

| Construct                                                                     | Rendered as                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Preamble (before `\begin{document}`)                                          | Folded into one line, expandable                                       |
| `\section` … `\subparagraph`, starred                                         | Heading styles; the command hidden                                     |
| `\textbf`, `\textit`, `\emph`, `\underline`, `\texttt`                        | Styled text; command and braces hidden, the text stays editable        |
| Inline math `$…$`, `\(…\)`                                                    | Typeset math (KaTeX)                                                   |
| Display math `\[…\]`, `equation`, `align`, `gather`, `multline` (and starred) | Typeset block (KaTeX); `\label` shown as a chip                        |
| `itemize`, `enumerate` with `\item`                                           | Bullets and numbers                                                    |
| `\cite…`, `\ref`, `\eqref`, `\cref`, `\label`                                 | Chips showing the keys (numbers later, from the last compile's `.aux`) |
| `figure` with `\includegraphics`                                              | The image (PNG, JPEG; PDF images later), with the caption              |
| `%` comments                                                                  | Dimmed                                                                 |
| Tables, TikZ, unknown environments and commands                               | Source (tables get their own editor, Phase 6)                          |

Math uses KaTeX: synchronous and fast, so typing is not delayed. Macros
defined with `\newcommand` / `\renewcommand` / `\DeclareMathOperator` in the
project are passed to KaTeX. Math KaTeX cannot typeset stays as source, with
a marker.

### Code location

- `packages/latex-syntax`: parser (domain layer).
- `packages/editor-visual`: the CodeMirror extension (decorations, widgets,
  KaTeX); browser-only.
- `apps/web/src/editor`: wiring only (the extension on or off; the switch).
  This folder belongs to the UI work (ADR 0013); the wiring change is
  announced there.

### Milestones

1. Parser; headings, text styles, comments, preamble folding; the switch.
2. Math (inline and display) with project macros.
3. Lists; reference and citation chips; figures.
4. Numbers for references and citations from the last compile; PDF images.

## Owner's answers

1. **Math engine:** KaTeX.
2. **Editing rendered math:** the source in place.
3. **Remembering the mode:** per browser, with the other layout settings.
4. **Default:** Code mode.

## Implementation notes

- A newly opened document has its cursor at offset 0, inside the preamble.
  The preamble fold therefore opens only for a selection beyond offset 0;
  clicking the fold puts the cursor at the end of the preamble.
- Math (milestone 2): KaTeX 0.19 with `throwOnError`; math it cannot
  render stays as source with a wavy underline and KaTeX's message as the
  tooltip. Numbered environments are typeset unnumbered (KaTeX would number
  every formula (1)) until milestone 4 brings the compile's numbers.
  `\label` is removed before typesetting. KaTeX's hidden MathML copy is
  kept for screen readers.
- Macros: the open file's definitions are read live; other `.tex`/`.sty`
  files of the project are read as saved, when visual mode is on and when
  the file list or the open file changes. Definitions with an optional
  argument default are skipped.
- Visual mode shows prose in the interface's proportional font; Code mode
  keeps the monospace font.
- Lists, chips and figures (milestone 3): list markers follow LaTeX's
  defaults, with itemize and enumerate depths counted separately; a line
  holding only `\begin{…}`, `\end{…}` (lists, `figure`, `center`) or
  `\centering` is hidden whole. Options right after `\begin{name}` (e.g.
  `figure[t]`) belong to the `\begin`. Chips show keys until milestone 4.
  `\includegraphics` paths resolve like pdfLaTeX (relative to the project
  root, graphicx's extension order, so a PDF wins over a PNG of the same
  name); PNG, JPEG, GIF and WebP are shown, other formats as their path.
  Images load outside the editor state and arrive as a transaction with
  their natural size, so the editor measures the new line height (a size
  change inside a drawn widget left the line numbers misaligned).
- Numbers (milestone 4a): `CompileBackend.readReferences` returns the
  labels and citations of the latest compile from its `.aux` files
  (`\newlabel` incl. hyperref and cleveref types, `\bibcite` plain and
  natbib, `\@input` for `\include`d chapters); null before the first
  compile, when chips show keys. `GET /api/projects/:id/references`; the web
  app refetches after each compile. References show `\ref`'s number,
  `\pageref`'s page, `(n)` for `\eqref` and cleveref's default names for
  `\cref`/`\Cref` (e.g. "section 2.3", "Fig. 1"); citations natbib's
  author-year form when recorded, else numbers; `\cite` in parentheses
  (ICML's and numeric styles; natbib's own `\cite` is textual). Unknown keys
  show `??`/`?`, marked. Labelled display equations show their number
  through KaTeX's `\tag`; unlabelled ones stay unnumbered. Numbers are those
  of the last compile, so they lag behind edits until the next one.
- Clean visual mode (owner's request, 2026-11-15): a "Clean" toggle next
  to the Code/Visual switch, usable in Visual mode and remembered with the
  layout. In clean mode:
  - Hidden, and skipped by the cursor (atomic ranges): the preamble, `%`
    comments (a comment-only line whole, a trailing comment with the spaces
    before it), `\label`, and the spacing commands `\vskip`, `\vspace`,
    `\hspace` (with their length), `\newpage`, `\clearpage`, `\maketitle`,
    `\centering`, `\noindent`, `\bigskip`, `\medskip`, `\smallskip`. Runs of
    blank lines show as one, except lines the selection touches.
  - A command visual mode does not render (any letter-named command other
    than text styles, headings, `\item`, citations, references,
    `\includegraphics`) that stands on its own line(s) is replaced by a block
    with its name, together with the `[…]` and `{…}` right after it (unknown
    commands have no signature, so those are their arguments), e.g.
    `\twocolumn[…]`. Inside a line it stays source. Control symbols (`\%`,
    `\\`) are left as they are.
  - An environment visual mode does not render (not math, lists, `figure`,
    `center` or `document`) is replaced by a block with its name.
  - Like math, a block shows its source when the selection touches it.
  - Typing at the end of a trailing hidden comment goes before it; Backspace
    there deletes the character before it; other typing or deleting inside
    a hidden part is dropped, so hidden parts are never changed unseen. Undo
    and programmatic changes are not affected.

## Consequences

- No second document model: visual mode works with comments, suggestions,
  real-time editing and live preview without extra synchronisation.
- What it shows is an approximation of the PDF (no page layout, no macro
  expansion); the PDF and live preview stay the reference.
- Unrecognised constructs show as source, so coverage grows construct by
  construct; each needs parser and rendering tests.
- New dependency: KaTeX (MIT).
