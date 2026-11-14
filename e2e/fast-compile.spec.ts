import { expect, test } from '@playwright/test';

test('auto-compile updates the PDF after typing, reusing the precompiled preamble', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Auto-compile');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  // Off by default.
  await page.getByRole('button', { name: 'Compile settings' }).click();
  const autoCompile = page.getByRole('checkbox', { name: /Auto-compile/ });
  await expect(autoCompile).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Precompile preamble/ })).toBeChecked();
  await autoCompile.check();
  await expect(autoCompile).toBeChecked();
  await page.getByRole('button', { name: 'Compile settings' }).click();

  // Typing alone triggers compiles: the first caches the preamble, later ones reuse it.
  const editor = page.locator('.cm-content');
  await page.locator('.cm-line', { hasText: 'Start writing here.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' First edit.');
  await expect(page.locator('.pdf-page canvas')).toHaveCount(1);
  await expect(page.getByTestId('preamble-status')).toContainText('caching preamble');

  await page.keyboard.insertText(' Second edit.');
  await expect(page.getByTestId('preamble-status')).toContainText('preamble cached');
  await expect(page.locator('.diagnostics .status')).toHaveText('success');
  await expect(editor).toContainText('Second edit.');

  // The setting persists.
  await page.reload();
  await page.getByRole('button', { name: 'Compile settings' }).click();
  await expect(page.getByRole('checkbox', { name: /Auto-compile/ })).toBeChecked();
});
