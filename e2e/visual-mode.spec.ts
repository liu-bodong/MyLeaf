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
