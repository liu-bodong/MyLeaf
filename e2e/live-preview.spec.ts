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

  // One switch next to Recompile; while on, the toolbar names the engine.
  const name = engine === 'pdflatex' ? 'pdfLaTeX' : 'XeLaTeX';
  const toggle = page.getByRole('button', { name: 'Live preview' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toContainText(name);

  // An <img> (TeXpresso's SVG pages) or a <canvas> (pdfTeX's PDF pages).
  const image = page.getByRole('img', { name: 'Live preview of page 1' });
  await expect(image).toBeVisible({ timeout: 30_000 });
  const before = await image.screenshot();

  // Typing (without saving or compiling) re-renders the page.
  await page.locator('.cm-line', { hasText: 'Start writing here.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Typed live.');
  await expect
    .poll(async () => (await image.screenshot()).equals(before), { timeout: 30_000 })
    .toBe(false);
  // The toolbar's page box follows the live pages.
  await expect(page.getByTestId('page-count')).toHaveText('/ 1');

  // A new page appears below the first one (continuous scroll).
  await page.keyboard.insertText(' \\newpage Second page.');
  await expect(page.getByTestId('page-count')).toHaveText('/ 2', { timeout: 30_000 });
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

  // Zoom works on the live pages too, drawing them wider.
  const before100 = await image.boundingBox();
  await page.getByRole('button', { name: /^Zoom level/ }).click();
  await page.getByRole('menuitem', { name: '200%' }).click();
  await expect(page.getByTestId('zoom-level')).toHaveText('200%');
  await expect
    .poll(async () => (await image.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before100?.width ?? 0);
  await page.getByRole('button', { name: /^Zoom level/ }).click();
  await page.getByRole('menuitem', { name: 'Fit to width' }).click();

  // Turning it off brings the PDF back, compiled at once from what the live
  // pages showed (the source changed since the last compile).
  await toggle.click();
  await expect(page.getByTestId('live-preview')).toHaveCount(0);
  await expect(page.getByTestId('pdf-viewer')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('page-count')).toHaveText('/ 2', { timeout: 30_000 });

  // Turned on again, it opens on the compiled PDF's pages until live pages arrive.
  await toggle.click();
  await expect(page.getByTestId('page-count')).toHaveText('/ 2');
  await expect(image).toBeVisible({ timeout: 30_000 });

  // The setting persists.
  await page.reload();
  await expect(page.getByTestId('live-preview')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});
