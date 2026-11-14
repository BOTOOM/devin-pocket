import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The PWA is built into dist/web and embedded/served by the single
// devin-pocket server process. In dev, Vite proxies /api and /ws to it.
export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'local-onnx-assets',
      configureServer(server) {
        const require = createRequire(import.meta.url);
        const transformers = createRequire(require.resolve('@huggingface/transformers'));
        const directory = path.dirname(transformers.resolve('onnxruntime-web'));
        server.middlewares.use((req, res, next) => {
          const match = req.url?.match(/^\/onnx\/(ort-wasm-simd-threaded(?:\.jsep)?\.(wasm|mjs))$/);
          if (!match?.[1]) return next();
          res.setHeader(
            'Content-Type',
            match[2] === 'wasm' ? 'application/wasm' : 'text/javascript',
          );
          createReadStream(path.join(directory, match[1])).on('error', next).pipe(res);
        });
      },
    },
  ],
  worker: { format: 'es' },
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
      '/models': 'http://127.0.0.1:7777',
      '/api': 'http://127.0.0.1:7777',
      '/ws': { target: 'ws://127.0.0.1:7777', ws: true },
    },
  },
});
