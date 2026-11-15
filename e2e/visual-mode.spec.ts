import { expect, test } from '@playwright/test';

const MAIN = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
\section{Introduction}
Some \textbf{bold} text. % a note
\end{document}
`;

test('visual mode renders LaTeX in place and shows the source at the cursor', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Visual');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(MAIN);
  // Put the cursor at the start, where a newly opened document has it.
  await page.keyboard.press('ControlOrMeta+Home');

  const editor = page.locator('.cm-content');
  await page.getByRole('radio', { name: 'Visual' }).click();
  await expect(page.getByRole('radio', { name: 'Visual' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.cm-visual-fold')).toHaveText(/Preamble · 2 lines/);
  await expect(page.locator('.cm-visual-heading-2')).toHaveText('Introduction');
  await expect(page.locator('.cm-visual-bold')).toHaveText('bold');
  await expect(editor).not.toContainText('\\section');
  await expect(editor).not.toContainText('\\textbf');

  // Clicking into the heading shows its source; the rest stays rendered.
  await page.locator('.cm-visual-heading-2').click();
  await expect(editor).toContainText('\\section{Introduction}');
  await expect(editor).not.toContainText('\\textbf');

  // Clicking the folded preamble opens it.
  await page.locator('.cm-visual-fold').click();
  await expect(editor).toContainText('\\usepackage{amsmath}');

  // The mode is remembered in this browser; Code shows the source again.
  await expect(page.getByTestId('save-state')).toHaveText('saved');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Visual' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Code' }).click();
  await expect(editor).toContainText('\\textbf{bold}');
  await expect(page.locator('.cm-visual-fold')).toHaveCount(0);
});

test('visual mode typesets math with project macros and marks what KaTeX cannot render', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Visual math');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  // A macro defined in another file of the project.
  const projectId = new URL(page.url()).hash.split('/').at(-1)!;
  const put = await page.request.put(`/api/projects/${projectId}/files/macros.tex`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: String.raw`\newcommand{\reals}{\mathbb{R}}`,
  });
  expect(put.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(
    [
      String.raw`\newcommand{\myvec}[1]{\mathbf{#1}}`,
      String.raw`Let $\myvec{v} \in \reals^n$ and $\frac{1}{$ here.`,
      String.raw`\begin{align}a &= b \label{eq:ab}\\ c &= d\end{align}`,
      'End.',
    ].join('\n'),
  );
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('radio', { name: 'Visual' }).click();

  const editor = page.locator('.cm-content');
  // Visible source text: typeset math left out (KaTeX keeps the TeX in hidden MathML).
  const source = () =>
    editor.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement;
      for (const math of copy.querySelectorAll('.katex')) math.remove();
      return copy.textContent ?? '';
    });
  // Inline math with both macros, and the align environment, are typeset.
  await expect(page.locator('.cm-visual-math')).toHaveCount(2);
  await expect(page.locator('.cm-visual-math-display .katex-display')).toHaveCount(1);
  expect(await source()).not.toContain('\\myvec{v}');
  expect(await source()).not.toContain('\\begin{align}');
  // Math KaTeX cannot parse stays as source, marked.
  await expect(page.locator('.cm-visual-math-error')).toHaveText(String.raw`$\frac{1}{$`);

  // Clicking typeset math shows its source in place.
  await page.locator('.cm-visual-math').first().click();
  await expect(editor).toContainText(String.raw`$\myvec{v} \in \reals^n$`);
});

/** A 2×1 PNG (one red, one blue pixel). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==',
  'base64',
);

test('visual mode shows lists, reference chips and figures', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Visual figures');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  const projectId = new URL(page.url()).hash.split('/').at(-1)!;
  const put = await page.request.put(`/api/projects/${projectId}/files/figs/dots.png`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: PNG,
  });
  expect(put.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(
    [
      String.raw`\begin{itemize}`,
      String.raw`  \item See \cref{fig:dots} and \citep{knuth84,lamport94}.`,
      String.raw`  \item Second`,
      String.raw`\end{itemize}`,
      String.raw`\begin{figure}[t]`,
      String.raw`  \centering`,
      String.raw`  \includegraphics[width=2cm]{figs/dots}`,
      String.raw`  \caption{Two dots.}\label{fig:dots}`,
      String.raw`\end{figure}`,
      'End.',
    ].join('\n'),
  );
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('radio', { name: 'Visual' }).click();

  await expect(page.locator('.cm-visual-marker')).toHaveText(['•', '•']);
  await expect(page.locator('.cm-visual-chip-ref')).toHaveText('fig:dots');
  await expect(page.locator('.cm-visual-chip-cite')).toHaveText('[knuth84, lamport94]');
  await expect(page.locator('.cm-visual-chip-label')).toHaveText('fig:dots');
  await expect(page.locator('.cm-visual-caption')).toHaveText('Two dots.');
  // The image is shown at its natural size (scaled to fit).
  const image = page.locator('.cm-visual-image img');
  await expect(image).toHaveAttribute('width', '2');
  await expect(image).toHaveAttribute('height', '1');
  const editor = page.locator('.cm-content');
  await expect(editor).not.toContainText('\\begin{figure}');
  await expect(editor).not.toContainText('\\centering');

  // Clicking a chip shows the command's source.
  await page.locator('.cm-visual-chip-cite').click();
  await expect(editor).toContainText(String.raw`\citep{knuth84,lamport94}`);
});

test('visual mode shows the numbers of the last compile', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Visual numbers');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(
    [
      String.raw`\documentclass{article}`,
      String.raw`\usepackage{amsmath,cleveref}`,
      String.raw`\begin{document}`,
      String.raw`\section{A}\label{sec:a}`,
      String.raw`\section{B}\label{sec:b}`,
      String.raw`See \cref{sec:b}, \eqref{eq:e} and \ref{missing}.`,
      String.raw`\begin{equation}x = 1\label{eq:e}\end{equation}`,
      String.raw`\end{document}`,
    ].join('\n'),
  );
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('radio', { name: 'Visual' }).click();
  // Before a compile, chips show keys.
  await expect(page.locator('.cm-visual-chip-ref').first()).toHaveText('sec:b');

  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  await expect(page.locator('.cm-visual-chip-ref')).toHaveText(['section 2', '(1)', '??']);
  await expect(page.locator('.cm-visual-chip-missing')).toHaveText('??');
  // The labelled equation shows its compiled number.
  await expect(page.locator('.cm-visual-math-display .katex-tag')).toContainText('(1)');
});
