import { expect, test } from '@playwright/test';

test('live preview updates the page while typing', async ({ page, request }) => {
  const { available, engine, synctex } = (await (
    await request.get('/api/live-preview')
  ).json()) as {
    available: boolean;
    engine: 'pdflatex' | 'xelatex' | null;
    synctex: boolean;
  };
  test.skip(!available, 'Live preview needs vendor/texpresso/build.sh or vendor/pdftex/build.sh');

  await page.goto('/');
  await page.getByLabel('New project name').fill('Live');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  await page.getByRole('button', { name: 'Compile settings' }).click();
  const name = engine === 'pdflatex' ? 'pdfLaTeX' : 'XeLaTeX';
  await page.getByRole('checkbox', { name: `Live preview (${name})` }).check();
  await page.getByRole('button', { name: 'Compile settings' }).click();

  // An <img> (TeXpresso's SVG pages) or a <canvas> (pdfTeX's PDF pages).
  const image = page.getByRole('img', { name: 'Live preview of page 1' });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('live-preview')).toContainText(`Live · ${name}`);
  const before = await image.screenshot();

  // Typing (without saving or compiling) re-renders the page.
  await page.locator('.cm-line', { hasText: 'Start writing here.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Typed live.');
  await expect
    .poll(async () => (await image.screenshot()).equals(before), { timeout: 30_000 })
    .toBe(false);
  await expect(page.getByTestId('live-page')).toHaveText('Page 1 of 1');

  // A new page appears below the first one (continuous scroll).
  await page.keyboard.insertText(' \\newpage Second page.');
  await expect(page.getByTestId('live-page')).toHaveText('Page 1 of 2', { timeout: 30_000 });
  await expect(page.getByRole('img', { name: 'Live preview of page 2' })).toBeAttached({
    timeout: 30_000,
  });

  if (synctex) {
    // Double-click on the live page moves the cursor to the source; "Show in
    // PDF" highlights the cursor's line on the live page.
    // A paragraph of its own (inside the paragraph above, the page maps to that paragraph's line).
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Third line on page two.');
    const text = page
      .getByTestId('live-preview')
      .locator('.live-text span', { hasText: 'Third line on page two.' });
    await expect(text).toBeAttached({ timeout: 30_000 });
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+Home');
      await text.dblclick();
      await expect(page.locator('.cm-activeLine')).toHaveText('Third line on page two.', {
        timeout: 1_000,
      });
    }).toPass({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show in PDF' }).click();
    await expect(page.getByTestId('live-preview').locator('.pdf-highlight')).not.toHaveCount(0);
    await expect(page.getByTestId('live-preview')).toBeVisible();
  }

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
