/** A half-open range of source offsets (UTF-16 code units). */
export interface Range {
  readonly from: number;
  readonly to: number;
}

export type LatexNode = CommandNode | GroupNode | EnvironmentNode | MathNode | CommentNode;

/** `\name`, with the arguments its signature declares. `to` is after the last argument. */
export interface CommandNode extends Range {
  readonly kind: 'command';
  /** Without the backslash; a single character for control symbols (`\%`, `\\`). */
  readonly name: string;
  readonly starred: boolean;
  readonly args: readonly ArgumentNode[];
}

/** `{…}` or `[…]` read as an argument. `contentFrom`/`contentTo` exclude the brackets. */
export interface ArgumentNode extends Range {
  readonly kind: 'argument';
  readonly optional: boolean;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly children: readonly LatexNode[];
  /** False if the closing bracket is missing (the argument runs to the end of its parent). */
  readonly closed: boolean;
}

/** A `{…}` group that is not an argument. */
export interface GroupNode extends Range {
  readonly kind: 'group';
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly children: readonly LatexNode[];
  readonly closed: boolean;
}

/** `\begin{name}…\end{name}`. Raw environments (math, verbatim) have no children. */
export interface EnvironmentNode extends Range {
  readonly kind: 'environment';
  readonly name: string;
  readonly begin: CommandNode;
  /** Null if the environment is not closed. */
  readonly end: CommandNode | null;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly raw: boolean;
  readonly math: boolean;
  readonly children: readonly LatexNode[];
}

/** `$…$`, `$$…$$`, `\(…\)` or `\[…\]`; the content is not parsed. */
export interface MathNode extends Range {
  readonly kind: 'math';
  readonly display: boolean;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly closed: boolean;
}

/** `%` to the end of the line (excluding the line break). */
export interface CommentNode extends Range {
  readonly kind: 'comment';
}

export interface LatexDocument {
  readonly nodes: readonly LatexNode[];
  /** Offset of `\begin{document}` at the top level, or null. */
  readonly documentBegin: number | null;
}

/**
 * Argument signatures, xparse style: `s` an optional star, `o` an optional
 * `[…]` argument, `m` a mandatory argument. Commands without a signature
 * take no arguments; groups after them are parsed as groups.
 */
export type Signatures = Readonly<Record<string, string>>;

const SECTION = 's o m';
export const DEFAULT_SIGNATURES: Signatures = {
  part: SECTION,
  chapter: SECTION,
  section: SECTION,
  subsection: SECTION,
  subsubsection: SECTION,
  paragraph: SECTION,
  subparagraph: SECTION,
  textbf: 'm',
  textit: 'm',
  textsl: 'm',
  emph: 'm',
  underline: 'm',
  texttt: 'm',
  textsc: 'm',
  textsf: 'm',
  textrm: 'm',
  label: 'm',
  ref: 'm',
  eqref: 'm',
  pageref: 'm',
  autoref: 'm',
  cref: 'm',
  Cref: 'm',
  cite: 's o o m',
  citep: 's o o m',
  citet: 's o o m',
  citealp: 's o o m',
  citeauthor: 's m',
  citeyear: 'm',
  nocite: 'm',
  includegraphics: 's o m',
  caption: 'o m',
  footnote: 'o m',
  item: 'o',
  url: 'm',
  href: 'm m',
  input: 'm',
  include: 'm',
};

const MATH_ENVIRONMENTS = new Set(
  [
    'equation',
    'align',
    'alignat',
    'gather',
    'multline',
    'flalign',
    'eqnarray',
    'displaymath',
    'math',
  ].flatMap((name) => [name, `${name}*`]),
);
const VERBATIM_ENVIRONMENTS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment']);

const isLetter = (code: number) =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 64; // A-Z a-z @

/** Parses LaTeX structure. Never throws: malformed input yields unclosed nodes. */
export function parseLatex(
  text: string,
  signatures: Signatures = DEFAULT_SIGNATURES,
): LatexDocument {
  const parser = new Parser(text, signatures);
  const nodes = parser.sequence(null);
  const begin = nodes.find(
    (node): node is EnvironmentNode => node.kind === 'environment' && node.name === 'document',
  );
  return { nodes, documentBegin: begin?.from ?? null };
}

/** What ends a sequence: a closing bracket, or `\end` inside an environment. */
type Stop = '}' | ']' | 'end' | null;

class Parser {
  readonly #text: string;
  readonly #signatures: Signatures;
  #pos = 0;

  constructor(text: string, signatures: Signatures) {
    this.#text = text;
    this.#signatures = signatures;
  }

  sequence(stop: Stop): LatexNode[] {
    const text = this.#text;
    const nodes: LatexNode[] = [];
    while (this.#pos < text.length) {
      const char = text[this.#pos];
      // A stray `}` inside an environment or at the top level is skipped.
      if (char === '}' && (stop === '}' || stop === ']')) return nodes;
      if (char === ']' && stop === ']') return nodes;
      if (char === '%') {
        nodes.push(this.#comment());
      } else if (char === '{') {
        nodes.push(this.#group());
      } else if (char === '$') {
        nodes.push(this.#dollarMath());
      } else if (char === '\\') {
        if (stop === 'end' && this.#startsWith('\\end') && !isLetter(this.#code(this.#pos + 4))) {
          return nodes;
        }
        nodes.push(this.#backslash());
      } else {
        this.#pos++;
      }
    }
    return nodes;
  }

  #code(at: number): number {
    return this.#text.charCodeAt(at);
  }

  #startsWith(prefix: string): boolean {
    return this.#text.startsWith(prefix, this.#pos);
  }

  #comment(): CommentNode {
    const from = this.#pos;
    const newline = this.#text.indexOf('\n', from);
    this.#pos = newline === -1 ? this.#text.length : newline;
    return { kind: 'comment', from, to: this.#pos };
  }

  #group(): GroupNode {
    const from = this.#pos;
    this.#pos++;
    const children = this.sequence('}');
    const contentTo = this.#pos;
    const closed = this.#text[this.#pos] === '}';
    if (closed) this.#pos++;
    return {
      kind: 'group',
      from,
      to: this.#pos,
      contentFrom: from + 1,
      contentTo,
      children,
      closed,
    };
  }

  #dollarMath(): MathNode {
    const from = this.#pos;
    const display = this.#text[from + 1] === '$';
    const delimiter = display ? '$$' : '$';
    this.#pos += delimiter.length;
    return this.#mathUntil(from, delimiter, display);
  }

  /** Reads math content until `closing` (skipping escaped characters). */
  #mathUntil(from: number, closing: string, display: boolean): MathNode {
    const text = this.#text;
    const contentFrom = this.#pos;
    while (this.#pos < text.length) {
      if (text.startsWith(closing, this.#pos)) {
        const contentTo = this.#pos;
        this.#pos += closing.length;
        return { kind: 'math', display, from, to: this.#pos, contentFrom, contentTo, closed: true };
      }
      // A blank line ends unclosed inline math, like TeX's error recovery.
      if (!display && text.startsWith('\n\n', this.#pos)) break;
      this.#pos += text[this.#pos] === '\\' ? 2 : 1;
    }
    this.#pos = Math.min(this.#pos, text.length);
    return {
      kind: 'math',
      display,
      from,
      to: this.#pos,
      contentFrom,
      contentTo: this.#pos,
      closed: false,
    };
  }

  #backslash(): LatexNode {
    const from = this.#pos;
    const next = this.#text[from + 1];
    if (next === '(' || next === '[') {
      this.#pos += 2;
      return this.#mathUntil(from, next === '(' ? '\\)' : '\\]', next === '[');
    }
    const command = this.#command();
    if (command.name === 'begin') return this.#environment(command);
    return command;
  }

  #command(): CommandNode {
    const text = this.#text;
    const from = this.#pos;
    this.#pos++;
    if (this.#pos < text.length && isLetter(this.#code(this.#pos))) {
      while (this.#pos < text.length && isLetter(this.#code(this.#pos))) this.#pos++;
    } else if (this.#pos < text.length) {
      this.#pos++; // control symbol
    }
    const name = text.slice(from + 1, this.#pos);
    const signature = name === 'begin' || name === 'end' ? 'm' : (this.#signatures[name] ?? '');
    let starred = false;
    const args: ArgumentNode[] = [];
    for (const spec of signature.split(' ').filter(Boolean)) {
      if (spec === 's') {
        if (text[this.#pos] === '*') {
          starred = true;
          this.#pos++;
        }
        continue;
      }
      const resume = this.#pos;
      this.#skipSpaces();
      const open = text[this.#pos];
      if (spec === 'o' && open === '[') {
        args.push(this.#argument(true));
      } else if (spec === 'm' && open === '{') {
        args.push(this.#argument(false));
      } else {
        this.#pos = resume;
        if (spec === 'm') break; // a missing mandatory argument ends the signature
      }
    }
    return { kind: 'command', name, starred, args, from, to: this.#pos };
  }

  /** Skips spaces and at most one line break (a blank line ends the arguments). */
  #skipSpaces(): void {
    const text = this.#text;
    let breaks = 0;
    while (this.#pos < text.length) {
      const char = text[this.#pos];
      if (char === '\n') {
        if (++breaks > 1) return;
      } else if (char !== ' ' && char !== '\t' && char !== '\r') {
        return;
      }
      this.#pos++;
    }
  }

  #argument(optional: boolean): ArgumentNode {
    const from = this.#pos;
    const close = optional ? ']' : '}';
    this.#pos++;
    const children = this.sequence(close);
    const contentTo = this.#pos;
    const closed = this.#text[this.#pos] === close;
    if (closed) this.#pos++;
    return {
      kind: 'argument',
      optional,
      from,
      to: this.#pos,
      contentFrom: from + 1,
      contentTo,
      children,
      closed,
    };
  }

  #environment(begin: CommandNode): LatexNode {
    const nameArg = begin.args[0];
    if (nameArg === undefined) return begin;
    const name = this.#text.slice(nameArg.contentFrom, nameArg.contentTo).trim();
    const math = MATH_ENVIRONMENTS.has(name);
    const raw = math || VERBATIM_ENVIRONMENTS.has(name);
    const contentFrom = this.#pos;
    let children: LatexNode[] = [];
    let contentTo: number;
    let end: CommandNode | null = null;

    if (raw) {
      const closing = `\\end{${name}}`;
      const at = this.#text.indexOf(closing, this.#pos);
      contentTo = at === -1 ? this.#text.length : at;
      this.#pos = contentTo;
      if (at !== -1) end = this.#command();
    } else {
      children = this.sequence('end');
      contentTo = this.#pos;
      if (this.#startsWith('\\end')) {
        const resume = this.#pos;
        const candidate = this.#command();
        const endArg = candidate.args[0];
        const endName =
          endArg === undefined ? '' : this.#text.slice(endArg.contentFrom, endArg.contentTo).trim();
        // A mismatched \end belongs to an enclosing environment.
        if (endName === name) end = candidate;
        else this.#pos = resume;
      }
    }
    return {
      kind: 'environment',
      name,
      begin,
      end,
      from: begin.from,
      to: end?.to ?? contentTo,
      contentFrom,
      contentTo,
      raw,
      math,
      children,
    };
  }
}
