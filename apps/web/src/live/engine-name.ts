import type { TexEngine } from '@myleaf/compile';

const NAMES: Record<TexEngine, string> = {
  pdflatex: 'pdfLaTeX',
  xelatex: 'XeLaTeX',
  lualatex: 'LuaLaTeX',
};

/** The name of a TeX engine as the UI shows it. */
export function engineName(engine: TexEngine): string {
  return NAMES[engine];
}
