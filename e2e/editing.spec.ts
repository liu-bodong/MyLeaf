import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This is the first paragraph of the document.

\input{chapters/intro}
\end{document}
`;

/** Replaces the editor content by typing, as a user would. */
async function replaceEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

test('edit a multi-file project, compile, and navigate between source and PDF', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept('chapters/intro.tex'));

  await page.goto('/');
  await page.getByLabel('New project name').fill('E2E paper');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await replaceEditorText(page, MAIN);
  await page.getByRole('button', { name: 'New file' }).click();
  await expect(page.locator('.file-row.active')).toContainText('intro.tex');
  await replaceEditorText(page, 'Text from the chapter.\n\nA \\badmacro here.\n');

  // Compile: the PDF renders and the error points at the included file.
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.locator('.pdf-page canvas')).toHaveCount(1);
  await expect(page.getByTestId('save-state')).toHaveText('saved');
  const error = page.locator('.diagnostic.error');
  await expect(error).toHaveCount(1);
  await expect(error).toContainText('chapters/intro.tex:3');
  await expect(error).toContainText('Undefined control sequence.');

  // Clicking the error moves the cursor to that line.
  await error.getByRole('button').click();
  await expect(page.locator('.cm-activeLine')).toHaveText('A \\badmacro here.');

  // Forward search highlights the line in the PDF.
  await page.getByRole('button', { name: 'Show in PDF' }).click();
  const highlight = page.locator('.pdf-highlight').first();
  await expect(highlight).toBeVisible();

  // Inverse search from another file jumps back to the source line.
  await page.locator('.file-name', { hasText: 'main.tex' }).click();
  await expect(page.locator('.file-row.active')).toContainText('main.tex');
  const box = await highlight.boundingBox();
  if (box === null) throw new Error('highlight has no bounding box');
  await page.mouse.dblclick(box.x + 10, box.y + box.height / 2);
  await expect(page.locator('.file-row.active')).toContainText('intro.tex');
  await expect(page.locator('.cm-activeLine')).toHaveText('A \\badmacro here.');

  // Fixing the error and recompiling succeeds.
  await replaceEditorText(page, 'Text from the chapter.\n');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page.locator('.diagnostics .status')).toHaveText('success');
  await expect(page.locator('.diagnostic.error')).toHaveCount(0);

  // Renaming the open file keeps its latest content in the editor.
  await replaceEditorText(page, 'Renamed chapter text.\n');
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => void dialog.accept('chapters/first.tex'));
  const row = page.locator('.file-row', { hasText: 'intro.tex' });
  await row.hover();
  await row.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.file-row.active')).toContainText('first.tex');
  await expect(page.locator('.cm-content')).toHaveText('Renamed chapter text.');

  // Edits persist across reloads.
  await page.reload();
  await page.locator('.file-name', { hasText: 'first.tex' }).click();
  await expect(page.locator('.cm-content')).toHaveText('Renamed chapter text.');
});
