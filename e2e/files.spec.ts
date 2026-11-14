import { expect, test } from '@playwright/test';

// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const MAIN = String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
\includegraphics[width=2cm]{figures/dot.png}
\includegraphics[width=2cm]{dropped.png}
\end{document}
`;

test('folders, uploads, image preview and images in the PDF', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept(dialog.type() === 'prompt' ? 'figures/notes.tex' : undefined);
  });

  await page.goto('/');
  await page.getByLabel('New project name').fill('Files');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.cm-content')).toContainText('Start writing here.');

  // A new file in a new folder creates the folder in the tree.
  await page.getByRole('button', { name: 'New file' }).click();
  const folder = page.locator('.file-row.directory', { hasText: 'figures' });
  await expect(folder).toBeVisible();

  // Upload into that folder through its own Upload action.
  await folder.hover();
  const chooser = page.waitForEvent('filechooser');
  await folder.getByRole('button', { name: 'Upload' }).click();
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  const uploaded = page.locator('.file-name', { hasText: 'dot.png' });
  await expect(uploaded).toBeVisible();

  // Drop a file onto the empty tree area: it lands in the project root.
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
      return data;
    },
    [...PNG],
  );
  await page.getByTestId('file-tree').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('.file-name', { hasText: 'dropped.png' })).toBeVisible();

  // Selecting an image shows a preview and how to include it.
  await uploaded.click();
  const preview = page.getByTestId('file-preview');
  await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(preview).toContainText('\\includegraphics[width=\\linewidth]{figures/dot.png}');

  // Both images compile into the PDF.
  await page.locator('.file-name', { hasText: 'main.tex' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(MAIN);
  await page.getByRole('button', { name: 'Recompile', exact: true }).click();
  await expect(page.locator('.diagnostics .status')).toHaveText('success');
  await expect(page.locator('.diagnostic.error')).toHaveCount(0);

  // Collapsing a folder hides its files.
  await folder.getByRole('button', { name: /figures/ }).click();
  await expect(uploaded).toBeHidden();
  await folder.getByRole('button', { name: /figures/ }).click();
  await expect(uploaded).toBeVisible();

  // Uploading an existing name asks before replacing it.
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload files' }).click();
  await (await again).setFiles({ name: 'dropped.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => dialogs.at(-1)).toContain('Replace 1 existing file(s)?');
});
