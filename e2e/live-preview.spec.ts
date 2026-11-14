import { expect, test } from '@playwright/test';

test('live preview updates the page while typing', async ({ page, request }) => {
  const { available } = (await (await request.get('/api/live-preview')).json()) as {
    available: boolean;
  };
  test.skip(!available, 'Live preview needs MYLEAF_TEXPRESSO (vendor/texpresso/build.sh)');

  await page.goto('/');
  await page.getByLabel('New project name').fill('Live');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await page.getByRole('button', { name: 'Compile settings' }).click();
  await page.getByRole('checkbox', { name: /Live preview/ }).check();
  await page.getByRole('button', { name: 'Compile settings' }).click();

  const image = page.getByTestId('live-preview').locator('img').first();
  await expect(image).toBeVisible({ timeout: 30_000 });
  const before = await image.getAttribute('src');

  // Typing (without saving or compiling) re-renders the page.
  await page.locator('.cm-line', { hasText: 'Start writing here.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Typed live.');
  await expect(image).not.toHaveAttribute('src', before ?? '', { timeout: 30_000 });
  await expect(page.getByTestId('live-page')).toHaveText('Page 1 of 1');

  // A new page appears below the first one (continuous scroll).
  await page.keyboard.insertText(' \\newpage Second page.');
  await expect(page.getByTestId('live-page')).toHaveText('Page 1 of 2', { timeout: 30_000 });
  await expect(page.getByAltText('Live preview of page 2')).toBeAttached({ timeout: 30_000 });

  // The PDF stays reachable while live preview is on.
  await page.getByRole('tab', { name: 'PDF' }).click();
  await expect(page.getByTestId('live-preview')).toBeHidden();
  await expect(page.getByText('Compile to see the PDF.')).toBeVisible();
  await page.getByRole('tab', { name: 'Live' }).click();
  await expect(image).toBeVisible();

  // The setting persists; turning it off brings the PDF view back.
  await page.reload();
  await expect(page.getByTestId('live-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Compile settings' }).click();
  await page.getByRole('checkbox', { name: /Live preview/ }).uncheck();
  await expect(page.getByTestId('live-preview')).toHaveCount(0);
});
