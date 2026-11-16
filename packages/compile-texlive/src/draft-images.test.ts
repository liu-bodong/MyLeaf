import { describe, expect, it } from 'vitest';
import { DRAFT_IMAGES_CODE, withDraftImages } from './draft-images.js';

const draft = (source: string) =>
  new TextDecoder().decode(withDraftImages(new TextEncoder().encode(source)));

describe('withDraftImages', () => {
  it('turns on draft mode right after \\begin{document}, on the same line', () => {
    const source = '\\documentclass{article}\n\\begin{document} % body\nText\n\\end{document}\n';
    const result = draft(source);
    expect(result).toBe(
      `\\documentclass{article}\n\\begin{document}${DRAFT_IMAGES_CODE} % body\nText\n\\end{document}\n`,
    );
    expect(result.split('\n')).toHaveLength(source.split('\n').length);
  });

  it('skips commented-out \\begin{document} and keeps escaped percent signs', () => {
    expect(draft('% \\begin{document}\n50\\% \\begin{document}\n')).toBe(
      `% \\begin{document}\n50\\% \\begin{document}${DRAFT_IMAGES_CODE}\n`,
    );
  });

  it('leaves a file without \\begin{document} unchanged', () => {
    expect(draft('\\section{Chapter}\n')).toBe('\\section{Chapter}\n');
  });
});
