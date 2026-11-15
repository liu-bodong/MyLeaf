import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function replaceEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

/** Types `text` key by key, so completion opens as it would for a user. */
async function typeAndAccept(page: Page, text: string, option: string) {
  await page.keyboard.type(text);
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup.locator('[aria-selected]')).toHaveText(new RegExp(`^${escape(option)}`));
  // CodeMirror ignores Enter for 75 ms after the popup opens (interactionDelay).
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
}

function escape(text: string) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

test('completes commands, environments, labels and bibliography keys', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept('refs.bib'));

  await page.goto('/');
  await page.getByLabel('New project name').fill('Completion');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  // A bibliography in another file.
  await page.getByRole('button', { name: 'New file' }).click();
  await expect(page.locator('.file-row.active')).toContainText('refs.bib');
  await replaceEditorText(page, '@article{knuth84,\n  title = {Literate Programming},\n}\n');
  await expect(page.getByTestId('save-state')).toHaveText('saved');
  await page.locator('.file-name', { hasText: 'main.tex' }).click();
  await expect(page.locator('.file-row.active')).toContainText('main.tex');

  await replaceEditorText(page, '');
  const content = page.locator('.cm-content');

  // A command snippet puts the cursor inside its argument.
  await typeAndAccept(page, '\\subsec', '\\subsection');
  await page.keyboard.type('Intro');
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await expect(content).toContainText('\\subsection{Intro}');

  await page.keyboard.press('Enter');
  await page.keyboard.type('\\label{sec:intro}');
  await page.keyboard.press('Enter');

  // An environment expands to begin and end, with an \item in lists.
  await typeAndAccept(page, '\\begin{item', 'itemize');
  await page.keyboard.type('See ');
  await typeAndAccept(page, '\\ref{sec:', 'sec:intro');
  await page.keyboard.type('} and ');
  await typeAndAccept(page, '\\cite{kn', 'knuth84');

  const lines = await page.locator('.cm-line').allInnerTexts();
  expect(lines.map((line) => line.trim())).toEqual([
    '\\subsection{Intro}',
    '\\label{sec:intro}',
    '\\begin{itemize}',
    '\\item See \\ref{sec:intro} and \\cite{knuth84',
    '\\end{itemize}',
  ]);
});
