import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// The API server, including WebSockets (live preview).
const apiProxy = { target: process.env.MYLEAF_API_URL ?? 'http://127.0.0.1:3000', ws: true };

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use workspace packages' TypeScript sources (see "@myleaf/source" exports).
    conditions: ['@myleaf/source', ...defaultClientConditions],
  },
  // MuPDF (live preview) finds its WebAssembly next to its own module, which
  // pre-bundling would move; its worker uses top-level await (ES modules).
  optimizeDeps: { exclude: ['mupdf'] },
  worker: { format: 'es' },
  server: { proxy: { '/api': apiProxy } },
  preview: { proxy: { '/api': apiProxy } },
});
