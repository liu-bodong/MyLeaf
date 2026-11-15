import type { AuxReferences } from '@myleaf/latex-syntax';

/** What a chip shows, and whether a key was missing from the last compile. */
export interface ChipText {
  readonly text: string;
  readonly missing: boolean;
}

/** cleveref's default names (lower case for `\cref`, capitalised for `\Cref`). */
const NAMES: Readonly<Record<string, readonly [string, string]>> = {
  equation: ['eq.', 'Eq.'],
  figure: ['fig.', 'Fig.'],
  table: ['table', 'Table'],
  part: ['part', 'Part'],
  chapter: ['chapter', 'Chapter'],
  section: ['section', 'Section'],
  subsection: ['section', 'Section'],
  subsubsection: ['section', 'Section'],
  appendix: ['appendix', 'Appendix'],
  subappendix: ['appendix', 'Appendix'],
  enumi: ['item', 'Item'],
  footnote: ['footnote', 'Footnote'],
  theorem: ['theorem', 'Theorem'],
  lemma: ['lemma', 'Lemma'],
  corollary: ['corollary', 'Corollary'],
  proposition: ['proposition', 'Proposition'],
  definition: ['definition', 'Definition'],
  algorithm: ['algorithm', 'Algorithm'],
  line: ['line', 'Line'],
};

const keysOf = (argument: string) =>
  argument
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

/**
 * `\ref`-like commands as the PDF shows them, from the last compile's
 * numbers; `??` for keys it did not record, as LaTeX prints them. Without a
 * compile, the keys.
 */
export function referenceText(
  command: string,
  argument: string,
  references: AuxReferences | null,
): ChipText {
  const keys = keysOf(argument);
  if (references === null) {
    const text = keys.join(', ');
    return { text: command === 'eqref' ? `(${text})` : text, missing: false };
  }
  const labels = keys.map((key) => references.labels[key]);
  const missing = labels.some((label) => label === undefined);
  const numbers = labels.map((label) =>
    label === undefined ? '??' : command === 'pageref' ? label.page : label.number,
  );
  const joined = numbers.join(', ');
  switch (command) {
    case 'eqref':
      return { text: `(${joined})`, missing };
    case 'cref':
    case 'Cref':
    case 'autoref': {
      const type = labels.find((label) => label?.type !== null && label?.type !== undefined)?.type;
      if (type === undefined || type === null) return { text: joined, missing };
      const names = NAMES[type] ?? [type, type.charAt(0).toUpperCase() + type.slice(1)];
      const name = command === 'cref' ? names[0] : names[1];
      return { text: type === 'equation' ? `${name} (${joined})` : `${name} ${joined}`, missing };
    }
    default:
      return { text: joined, missing };
  }
}

/**
 * Citations as the PDF roughly shows them: natbib's author-year form when the
 * last compile recorded authors and years, otherwise numbers; `?` for keys
 * it did not record. `\cite` is shown in parentheses (as ICML's and numeric
 * styles print it). Without a compile, the keys.
 */
export function citationText(
  command: string,
  argument: string,
  references: AuxReferences | null,
): ChipText {
  const keys = keysOf(argument);
  if (references === null) return { text: `[${keys.join(', ')}]`, missing: false };
  const entries = keys.map((key) => references.citations[key]);
  const missing = entries.some((entry) => entry === undefined);
  const known = entries.filter((entry) => entry !== undefined);
  const authorYear =
    known.length > 0 && known.every((entry) => entry.authors !== null && entry.year !== null);
  if (!authorYear) {
    return { text: `[${entries.map((entry) => entry?.number ?? '?').join(', ')}]`, missing };
  }
  const parts = entries.map((entry) =>
    entry === undefined
      ? { authors: '?', year: '?' }
      : { authors: entry.authors!, year: entry.year! },
  );
  switch (command) {
    case 'citet':
      return { text: parts.map((p) => `${p.authors} (${p.year})`).join(', '), missing };
    case 'citeauthor':
      return { text: parts.map((p) => p.authors).join(', '), missing };
    case 'citeyear':
      return { text: parts.map((p) => p.year).join(', '), missing };
    case 'citealp':
      return { text: parts.map((p) => `${p.authors}, ${p.year}`).join('; '), missing };
    default:
      return { text: `(${parts.map((p) => `${p.authors}, ${p.year}`).join('; ')})`, missing };
  }
}

/**
 * Display math with its `\label`s: each label the last compile numbered
 * becomes `\tag{number}` (KaTeX cannot number across formulas); others are
 * removed.
 */
export function tagLabels(tex: string, references: AuxReferences | null): string {
  return tex.replace(/\\label\s*\{([^{}]*)\}/g, (_, key: string) => {
    const label = references?.labels[key.trim()];
    return label === undefined ? '' : `\\tag{${label.number}}`;
  });
}
