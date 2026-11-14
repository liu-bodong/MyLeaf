import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const THREE_PAGES = String.raw`\documentclass{article}
\begin{document}
First page.
\newpage
Second page.
\newpage
Third page.
\end{document}
`;

async function replaceEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

test('top bar, editor toolbar, PDF toolbar and layout', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Frame');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  // Placeholders are visible but disabled.
  await expect(page.getByRole('button', { name: 'History' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Share' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Visual' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Insert' }).click();
  await expect(page.getByRole('menuitem', { name: 'Figure…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Undo and redo.
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();
  await replaceEditorText(page, THREE_PAGES);
  await undo.click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.cm-content')).toContainText('Third page.');

  // Page navigation and zoom.
  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(3);
  await expect(page.getByTestId('page-count')).toHaveText('/ 3');
  const pageBox = page.getByRole('textbox', { name: 'Page' });
  await expect(pageBox).toHaveValue('1');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageBox).toHaveValue('2');
  await pageBox.fill('3');
  await pageBox.press('Enter');
  await expect(pageBox).toHaveValue('3');

  const zoomLevel = page.getByTestId('zoom-level');
  const fitted = await zoomLevel.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomLevel).not.toHaveText(fitted ?? '');
  await page.getByRole('button', { name: /^Zoom level/ }).click();
  await page.getByRole('menuitem', { name: '100%' }).click();
  await expect(zoomLevel).toHaveText('100%');

  // Error badge toggles the logs.
  await replaceEditorText(page, THREE_PAGES.replace('Second page.', String.raw`\badmacro`));
  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  const logs = page.getByRole('button', { name: 'Logs: 1 error' });
  await expect(logs).toBeVisible();
  await expect(page.locator('.diagnostic.error')).toHaveCount(1);
  await logs.click();
  await expect(page.locator('.diagnostics')).toHaveCount(0);

  // Resizing with the keyboard.
  const handle = page.getByRole('separator', { name: 'Resize editor and PDF' });
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '48');

  // Layout and zoom persist across reloads.
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitemradio', { name: 'PDF only' }).click();
  await expect(page.locator('.cm-content')).toBeHidden();
  await page.reload();
  await expect(page.locator('.pdf-page').first()).toBeVisible();
  await expect(page.locator('.cm-content')).toBeHidden();
  await expect(page.getByTestId('zoom-level')).toHaveText('100%');
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitemradio', { name: 'Editor & PDF' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(handle).toHaveAttribute('aria-valuenow', '48');

  // Renaming the project from the title menu.
  page.on('dialog', (dialog) => void dialog.accept('Renamed frame'));
  await page.getByRole('button', { name: 'Project: Frame' }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await expect(page.getByRole('heading', { name: 'Renamed frame' })).toBeAttached();
});
