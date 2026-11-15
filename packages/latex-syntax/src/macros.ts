/**
 * Macro definitions found in LaTeX source, as `\name` → replacement text
 * with `#1`…`#9` parameters (the form KaTeX's `macros` option takes).
 */
export type MacroDefinitions = Readonly<Record<string, string>>;

const NAME = String.raw`\\([A-Za-z@]+)`;
/** `\newcommand{\name}[2]{…}`, `\renewcommand*\name{…}`, `\providecommand`. */
const NEWCOMMAND = new RegExp(
  String.raw`\\(?:renew|provide|new)command\*?\s*(?:\{\s*${NAME}\s*\}|${NAME})\s*(\[\s*\d\s*\])?\s*(\[)?`,
  'y',
);
/** `\DeclareMathOperator{\name}{text}` and its starred form. */
const OPERATOR = new RegExp(String.raw`\\DeclareMathOperator(\*?)\s*\{\s*${NAME}\s*\}\s*`, 'y');
/** `\def\name#1#2{…}`. */
const DEF = new RegExp(String.raw`\\def\s*${NAME}((?:#\d)*)\s*`, 'y');

/**
 * Finds `\newcommand`, `\renewcommand`, `\providecommand`, `\def` and
 * `\DeclareMathOperator` definitions outside comments. Definitions with an
 * optional-argument default are skipped (KaTeX has no equivalent). Later
 * definitions replace earlier ones.
 */
export function macroDefinitions(text: string): MacroDefinitions {
  const macros: Record<string, string> = {};
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === '%') {
      const newline = text.indexOf('\n', at);
      at = newline === -1 ? text.length : newline;
      continue;
    }
    if (char !== '\\') {
      at++;
      continue;
    }
    const found = readDefinition(text, at);
    if (found === null) {
      at += 2; // skip the backslash and the next character (e.g. `\%`)
      continue;
    }
    if (found.name !== null) macros[`\\${found.name}`] = found.body;
    at = found.end;
  }
  return macros;
}

interface Definition {
  /** Null for a definition that is recognised but skipped. */
  readonly name: string | null;
  readonly body: string;
  readonly end: number;
}

function readDefinition(text: string, at: number): Definition | null {
  for (const pattern of [NEWCOMMAND, OPERATOR, DEF]) {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (match === null) continue;
    let after = pattern.lastIndex;
    if (pattern === NEWCOMMAND && match[4] === '[') {
      // An optional argument's default: skip it and the definition.
      const close = text.indexOf(']', after);
      if (close === -1) return null;
      const body = braced(text, skipSpaces(text, close + 1));
      return body === null ? null : { name: null, body: '', end: body.end };
    }
    const body = braced(text, skipSpaces(text, after));
    if (body === null) return null;
    after = body.end;
    if (pattern === OPERATOR) {
      const operator = match[1] === '*' ? '\\operatorname*' : '\\operatorname';
      return { name: match[2]!, body: `${operator}{${body.content}}`, end: after };
    }
    const name = pattern === NEWCOMMAND ? (match[1] ?? match[2])! : match[1]!;
    return { name, body: body.content, end: after };
  }
  return null;
}

function skipSpaces(text: string, at: number): number {
  while (at < text.length && /\s/.test(text[at]!)) at++;
  return at;
}

/** The content of the `{…}` group starting at `at`, braces balanced, escapes skipped. */
function braced(text: string, at: number): { content: string; end: number } | null {
  if (text[at] !== '{') return null;
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      i++;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && --depth === 0) {
      return { content: text.slice(at + 1, i), end: i + 1 };
    }
  }
  return null;
}
