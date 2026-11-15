import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// End-to-end tests run the built server (fresh data directory) and the Vite
// dev server. Build first: `pnpm --filter "@myleaf/server..." run build`.
const API_PORT = 3100;
const WEB_PORT = 5174;
const dataDir = mkdtempSync(join(tmpdir(), 'myleaf-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'off',
    launchOptions: {
      // Lets environments with a preinstalled browser use it instead of `playwright install`.
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    },
  },
  webServer: [
    {
      command: 'node apps/server/dist/main.js',
      env: {
        PORT: String(API_PORT),
        MYLEAF_DATA_DIR: dataDir,
        // Live preview tests run when the patched TeXpresso is available, or the
        // patched pdfTeX with MYLEAF_LIVE_ENGINE=pdftex.
        ...Object.fromEntries(
          ['MYLEAF_TEXPRESSO', 'MYLEAF_LIVE_ENGINE', 'MYLEAF_PDFTEX'].flatMap((name) => {
            const value = process.env[name];
            return value ? [[name, value]] : [];
          }),
        ),
      },
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @myleaf/web exec vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      env: { MYLEAF_API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
