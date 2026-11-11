import { defineConfig } from 'tsdown';

// Single-file server bundle. Runtime deps (ACP SDK, ws, zod) stay external
// and are installed by npm; the web build lives next to it in dist/web.
export default defineConfig({
  entry: { server: 'src/server/cli.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: false,
  dts: false,
  sourcemap: false,
  minify: false,
  external: ['@agentclientprotocol/sdk', 'ws', 'zod'],
});
