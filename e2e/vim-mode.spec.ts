import { expect, test } from '@playwright/test';

test('vim key bindings turn on from the editor toolbar and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Vim paper');
  await page.getByRole('button', { name: 'Create' }).click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('Start writing here.');

  const toggle = page.getByRole('button', { name: 'Vim', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // Normal mode: typed letters are commands, not text.
  await content.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Ovim line');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-vim-panel')).toBeVisible();
  await expect(content).toContainText('vim line');
  await page.keyboard.type('dd');
  await expect(content).not.toContainText('vim line');

  // :w writes at once instead of after the autosave delay.
  await page.keyboard.type('Osaved by w');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-state')).toHaveText('unsaved');
  await page.keyboard.type(':w');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-state')).toHaveText('saved', { timeout: 500 });

  // Completion works in insert mode: Enter accepts the suggestion.
  await page.keyboard.type('o\\subsec');
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
  // CodeMirror ignores Enter for 75 ms after the popup opens (interactionDelay).
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Intro');
  await page.keyboard.press('Escape');
  await expect(content).toContainText('\\subsection{Intro}');

  // Writing to another file name does not apply.
  await page.keyboard.type(':w other.tex');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-vim-message')).toHaveText(
    'Writing to another file is not supported',
  );

  // The setting survives a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Vim', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Off again: letters are inserted as text.
  await page.getByRole('button', { name: 'Vim', exact: true }).click();
  await expect(page.locator('.cm-vim-panel')).toHaveCount(0);
  await page.locator('.cm-content').click();
  await page.keyboard.type('dd');
  await expect(page.locator('.cm-content')).toContainText('dd');
});
