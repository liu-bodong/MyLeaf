import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

const MAIN = String.raw`\documentclass{article}
\begin{document}
Imported from a zip.
\input{sections/intro}
\end{document}
`;

test('uploading a zip on the home page creates a project from its files', async ({ page }) => {
  const zip = zipSync({
    'thesis/main.tex': strToU8(MAIN),
    'thesis/sections/intro.tex': strToU8('Intro text.'),
  });

  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload .zip' }).click();
  await (
    await chooser
  ).setFiles({ name: 'thesis.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });

  // The project is named after the zip and opens on its main file.
  await expect(page.locator('.cm-content')).toContainText('Imported from a zip.');
  await expect(page.locator('.project-name')).toHaveText('thesis');
  await expect(page.locator('.file-row', { hasText: 'main.tex' })).toContainText('main');
  await expect(page.locator('.file-row.directory', { hasText: 'sections' })).toBeVisible();
});
