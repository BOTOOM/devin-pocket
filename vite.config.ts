import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The PWA is built into dist/web and embedded/served by the single
// devin-pocket server process. In dev, Vite proxies /api and /ws to it.
export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/web'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7777',
      '/ws': { target: 'ws://127.0.0.1:7777', ws: true },
    },
  },
});
