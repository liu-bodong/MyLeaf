/**
 * Names a LaTeX source defines that other places refer to: labels for `\ref`,
 * bibliography keys for `\cite`, and environment names for `\begin`. Used by
 * the editor's completion.
 */

/** Removes `%` comments (an escaped `\%` is kept), keeping line breaks. */
export function stripComments(text: string): string {
  return text.replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, '$1$2');
}

/** Keys of `\label{…}` outside comments, in order of appearance, without duplicates. */
export function labelNames(text: string): string[] {
  return unique(matches(stripComments(text), /\\label\s*\{([^{}]+)\}/g));
}

/** Keys of `\bibitem[…]{…}` outside comments (a `thebibliography` list). */
export function bibitemKeys(text: string): string[] {
  return unique(matches(stripComments(text), /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g));
}

/** Names in `\newenvironment{…}`, `\renewenvironment{…}` and `\newtheorem{…}`. */
export function environmentNames(text: string): string[] {
  return unique(
    matches(
      stripComments(text),
      /\\(?:(?:re)?newenvironment|newtheorem|NewDocumentEnvironment)\*?\s*\{([^{}]+)\}/g,
    ),
  );
}

/** A BibTeX entry, for `\cite` completion. */
export interface BibEntry {
  readonly key: string;
  /** Lowercased entry type, e.g. `article`. */
  readonly type: string;
  /** The `title` field with outer braces or quotes removed, when present. */
  readonly title: string | null;
}

const NOT_ENTRIES = new Set(['comment', 'string', 'preamble']);

/** Entries of a `.bib` file, skipping `@comment`, `@string` and `@preamble`. */
export function bibEntries(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const seen = new Set<string>();
  const entry = /@\s*([A-Za-z]+)\s*[{(]\s*([^\s,{}()]+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(text)) !== null) {
    const type = match[1]!.toLowerCase();
    const key = match[2]!;
    if (NOT_ENTRIES.has(type) || seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, type, title: fieldValue(text, entry.lastIndex, 'title') });
  }
  return entries;
}

/** The value of `field` in the entry body starting at `at`, before the next entry. */
function fieldValue(text: string, at: number, field: string): string | null {
  const next = text.indexOf('@', at);
  const body = text.slice(at, next === -1 ? text.length : next);
  const start = new RegExp(String.raw`(?:^|[,\s])${field}\s*=\s*`, 'i').exec(body);
  if (start === null) return null;
  let i = start.index + start[0].length;
  const open = body[i];
  if (open === '"') {
    const close = body.indexOf('"', i + 1);
    return close === -1 ? null : clean(body.slice(i + 1, close));
  }
  if (open !== '{') return null;
  let depth = 0;
  for (const from = i; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) return clean(body.slice(from + 1, i));
  }
  return null;
}

function clean(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]!.trim()).filter((key) => key !== '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
