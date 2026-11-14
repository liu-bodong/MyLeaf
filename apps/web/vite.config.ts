import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use workspace packages' TypeScript sources (see "@myleaf/source" exports).
    conditions: ['@myleaf/source', ...defaultClientConditions],
  },
  server: {
    proxy: { '/api': process.env.MYLEAF_API_URL ?? 'http://127.0.0.1:3000' },
  },
  preview: {
    proxy: { '/api': process.env.MYLEAF_API_URL ?? 'http://127.0.0.1:3000' },
  },
});
