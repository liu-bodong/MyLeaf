import { expect, test } from '@playwright/test';

test.use({ colorScheme: 'light' });

test('settings switch the theme and editor appearance and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Appearance test');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // The line-number gutter follows the theme (it stayed light before).
  const gutterColor = () =>
    page.locator('.cm-gutters').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await gutterColor()).toBe('rgb(31, 34, 39)');

  await dialog.getByLabel('Font size (px)').fill('18');
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '18px');
  await dialog.getByLabel('Line numbers').uncheck();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '18px');
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);

  // "System" follows the browser's color scheme.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByRole('radio', { name: 'System' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
});
