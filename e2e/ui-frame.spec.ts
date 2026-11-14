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

  // Compile messages start collapsed to their summary line; the Logs button
  // and the summary line both expand and collapse them.
  await replaceEditorText(page, THREE_PAGES.replace('Second page.', String.raw`\badmacro`));
  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  const logs = page.getByRole('button', { name: 'Logs: 1 error' });
  await expect(logs).toBeVisible();
  const summary = page.getByRole('button', { name: /1 errors ·/ });
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  const error = page.locator('.diagnostic.error');
  await expect(error).toHaveCount(1);
  await expect(error).toBeHidden();
  await logs.click();
  await expect(error).toBeVisible();
  await expect(logs).toHaveAttribute('aria-pressed', 'true');
  await summary.click();
  await expect(error).toBeHidden();
  await expect(logs).toHaveAttribute('aria-pressed', 'false');

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

test('double-clicking the divider resets the split', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Reset');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  const handle = page.getByRole('separator', { name: 'Resize editor and PDF' });
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '48');
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
});

test('the file tree sidebar can be resized', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Sidebar');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  const resizer = page.getByRole('separator', { name: 'Resize file tree' });
  const sidebar = page.locator('.sidebar');
  await expect(resizer).toHaveAttribute('aria-valuenow', '240');

  // The keyboard resizes it and the rendered width follows.
  const before = (await sidebar.boundingBox())?.width ?? 0;
  await resizer.focus();
  await page.keyboard.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', '248');
  const after = (await sidebar.boundingBox())?.width ?? 0;
  expect(after).toBeGreaterThan(before);

  // Double-click resets to the default width.
  await resizer.dblclick();
  await expect(resizer).toHaveAttribute('aria-valuenow', '240');

  // The width persists across reloads.
  await resizer.focus();
  await page.keyboard.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '480');
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Resize file tree' })).toHaveAttribute(
    'aria-valuenow',
    '480',
  );
});

test('the file tree can be collapsed entirely', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Collapse');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  const sidebar = page.getByRole('complementary', { name: 'Files' });
  const toggle = page.getByRole('button', { name: 'File tree' });
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // The toolbar toggle hides the sidebar and its resizer; the editor takes the space.
  const editorBefore = (await page.locator('.cm-editor').boundingBox())?.width ?? 0;
  await toggle.click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Resize file tree' })).toBeHidden();
  const editorAfter = (await page.locator('.cm-editor').boundingBox())?.width ?? 0;
  expect(editorAfter).toBeGreaterThan(editorBefore);

  // Collapsed stays collapsed after a reload; the View menu brings it back.
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  await expect(sidebar).toBeHidden();
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const item = page.getByRole('menuitemcheckbox', { name: 'File tree' });
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await item.click();
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('menus open and navigate with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Menus');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  const view = page.getByRole('menuitem', { name: 'View', exact: true });
  await view.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Editor & PDF' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'PDF only' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeHidden();
  await expect(view).toBeFocused();

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Editor & PDF' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(view).toBeFocused();

  // Left/Right move between the top-level menus.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Format', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(view).toBeFocused();

  // With a menu open, Left/Right switch menus and focus stays in the menu bar.
  await view.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Editor & PDF' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const format = page.getByRole('menuitem', { name: 'Format', exact: true });
  await expect(format).toBeFocused();
  await expect(format).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('End');
  const help = page.getByRole('menuitem', { name: 'Help', exact: true });
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(help).toBeFocused();
});

test('PDF keyboard shortcuts change pages and zoom', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('PDF keys');
  await page.getByRole('button', { name: 'Create' }).click();
  await replaceEditorText(page, THREE_PAGES);
  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(3);

  const pageBox = page.getByRole('textbox', { name: 'Page' });
  await expect(pageBox).toHaveValue('1');

  const viewer = page.getByTestId('pdf-viewer');
  await viewer.focus();
  await page.keyboard.press('PageDown');
  await expect(pageBox).toHaveValue('2');
  await page.keyboard.press('PageUp');
  await expect(pageBox).toHaveValue('1');

  const zoomLevel = page.getByTestId('zoom-level');
  await page.getByRole('button', { name: /^Zoom level/ }).click();
  await page.getByRole('menuitem', { name: '100%' }).click();
  await expect(zoomLevel).toHaveText('100%');
  await viewer.focus();
  await page.keyboard.press('ControlOrMeta+=');
  await expect(zoomLevel).toHaveText('110%');
  await page.keyboard.press('ControlOrMeta+-');
  await expect(zoomLevel).toHaveText('100%');
});

test('Help shows the keyboard shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Shortcuts');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Compile');
  await expect(dialog).toContainText('Undo');

  // Escape closes the dialog.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
