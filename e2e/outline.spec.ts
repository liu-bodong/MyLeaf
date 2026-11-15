import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
\input{chapters/intro}
\section{Results}
Text.
\subsection{Main \emph{result}}
More text.
\end{document}
`;

async function replaceEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

test('outline lists headings of the main and included files and goes to them in the PDF', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept('chapters/intro.tex'));
  await page.goto('/');
  await page.getByLabel('New project name').fill('Outline');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await replaceEditorText(page, MAIN);
  await page.getByRole('button', { name: 'New file' }).click();
  await expect(page.locator('.file-row.active')).toContainText('intro.tex');
  await replaceEditorText(page, '\\subsection{Background}\nChapter text.\n');
  await page.locator('.file-name', { hasText: 'main.tex' }).click();
  await expect(page.locator('.file-row.active')).toContainText('main.tex');

  // The outline starts hidden; the rail button shows it.
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline).toBeHidden();
  await page.getByRole('button', { name: 'Show outline' }).click();
  const titles = outline.locator('.outline-title');
  await expect(titles).toHaveText(['Introduction', 'Background', 'Results', 'Main result']);
  // Without a PDF there is nowhere to go.
  await expect(titles.first()).toBeDisabled();

  // The outline follows edits of the open document.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.insertText('\\section{Discussion}\n');
  await expect(titles).toHaveText([
    'Introduction',
    'Background',
    'Results',
    'Main result',
    'Discussion',
  ]);

  // Collapsing a heading hides the headings below it.
  await outline.getByRole('button', { name: 'Collapse Results' }).click();
  await expect(titles).toHaveText(['Introduction', 'Background', 'Results', 'Discussion']);
  await outline.getByRole('button', { name: 'Expand Results' }).click();

  // After a compile, selecting a heading highlights it in the PDF.
  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  await expect(page.locator('.diagnostics .status')).toHaveText('success');
  await expect(titles.first()).toBeEnabled();
  await outline.getByRole('button', { name: 'Background' }).click();
  await expect(page.locator('.pdf-highlight').first()).toBeVisible();
  // The editor stays on the open file.
  await expect(page.locator('.file-row.active')).toContainText('main.tex');

  // Hiding the outline brings the rail button back.
  await page.getByRole('button', { name: 'Hide outline' }).click();
  await expect(outline).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show outline' })).toBeVisible();
});
