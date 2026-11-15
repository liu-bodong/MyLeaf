import katex from 'katex';
import type { MacroDefinitions } from '@myleaf/latex-syntax';

export type MathRendering =
  { readonly ok: true; readonly html: string } | { readonly ok: false; readonly error: string };

/** Rendered formulas by macros, display mode and source; bounded, oldest dropped first. */
const cache = new Map<string, MathRendering>();
const CACHE_LIMIT = 2_000;

/** A stable key for a set of macros, so equal sets share cache entries. */
export function macrosKey(macros: MacroDefinitions): string {
  return JSON.stringify(Object.entries(macros).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Typesets `tex` with KaTeX (ADR 0016). Errors are returned, not thrown, so
 * the caller can keep the source visible. `key` identifies `macros`
 * (see `macrosKey`).
 */
export function renderMath(
  tex: string,
  display: boolean,
  macros: MacroDefinitions,
  key: string = macrosKey(macros),
): MathRendering {
  const id = `${display ? 'D' : 'I'}${key}\u0000${tex}`;
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  let result: MathRendering;
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      // KaTeX adds \gdef definitions to the object it is given.
      macros: { ...macros },
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    });
    result = { ok: true, html };
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(id, result);
  return result;
}
