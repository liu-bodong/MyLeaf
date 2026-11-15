/** What a compile recorded about a `\label`. */
export interface LabelReference {
  /** As LaTeX prints it with `\ref`, e.g. `2.3`. */
  readonly number: string;
  readonly page: string;
  /** The counter, e.g. `subsection` or `figure`, when cleveref recorded it. */
  readonly type: string | null;
}

/** What a compile recorded about a bibliography entry (`\bibcite`). */
export interface CitationReference {
  readonly number: string;
  /** natbib's author-year data, when present. */
  readonly year: string | null;
  readonly authors: string | null;
}

export interface AuxReferences {
  readonly labels: Readonly<Record<string, LabelReference>>;
  readonly citations: Readonly<Record<string, CitationReference>>;
}

export interface AuxFile extends AuxReferences {
  /** Other aux files it reads (`\@input`, from `\include`), as written. */
  readonly inputs: readonly string[];
}

/**
 * Reads the references a LaTeX run wrote to an `.aux` file: `\newlabel`
 * (plain, hyperref, and cleveref's `@cref` entries for the counter type),
 * `\bibcite` (plain numbers and natbib's author-year data), and `\@input`.
 */
export function parseAux(text: string): AuxFile {
  const labels: Record<string, LabelReference> = {};
  const types: Record<string, string> = {};
  const citations: Record<string, CitationReference> = {};
  const inputs: string[] = [];
  const command = /\\(newlabel|bibcite|@input)\s*/g;
  let match: RegExpExecArray | null;
  while ((match = command.exec(text)) !== null) {
    const key = group(text, command.lastIndex);
    if (key === null) continue;
    if (match[1] === '@input') {
      inputs.push(key.content);
      command.lastIndex = key.end;
      continue;
    }
    const value = group(text, key.end);
    if (value === null) continue;
    command.lastIndex = value.end;
    const fields = groups(value.content);
    if (match[1] === 'bibcite') {
      citations[key.content] =
        fields.length === 0
          ? { number: plain(value.content), year: null, authors: null }
          : {
              number: plain(fields[0] ?? ''),
              year: fields[1] === undefined ? null : plain(fields[1]),
              authors: fields[2] === undefined ? null : plain(fields[2]),
            };
    } else if (key.content.endsWith('@cref')) {
      const type = /^\[([^\]]*)\]/.exec(fields[0] ?? '');
      if (type?.[1] !== undefined) types[key.content.slice(0, -'@cref'.length)] = type[1];
    } else {
      labels[key.content] = {
        number: plain(fields[0] ?? ''),
        page: plain(fields[1] ?? ''),
        type: null,
      };
    }
  }
  for (const [key, type] of Object.entries(types)) {
    const label = labels[key];
    if (label !== undefined) labels[key] = { ...label, type };
  }
  return { labels, citations, inputs };
}

/** The `{…}` group at `at` (after optional spaces), braces balanced. */
function group(text: string, at: number): { content: string; end: number } | null {
  while (text[at] === ' ' || text[at] === '\n') at++;
  if (text[at] !== '{') return null;
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') i++;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return { content: text.slice(at + 1, i), end: i + 1 };
  }
  return null;
}

/** The top-level `{…}` groups of `text`; empty if it does not start with one. */
function groups(text: string): string[] {
  const found: string[] = [];
  let at = 0;
  for (;;) {
    const next = group(text, at);
    if (next === null) return found;
    found.push(next.content);
    at = next.end;
  }
}

/** Text as printed, roughly: ties as spaces, escaped characters unescaped, braces and `\relax` removed. */
function plain(value: string): string {
  return value
    .replace(/\\relax\s*/g, '')
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .trim();
}
