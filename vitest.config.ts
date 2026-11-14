import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources (see the
// "@myleaf/source" export condition in each package.json).
const conditions = ['@myleaf/source', ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
