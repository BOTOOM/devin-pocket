import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const transformersRequire = createRequire(require.resolve('@huggingface/transformers'));
const source = dirname(transformersRequire.resolve('onnxruntime-web'));
const target = resolve(process.argv[2] ?? 'dist/web/onnx');
await mkdir(target, { recursive: true });
for (const file of [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]) {
  await copyFile(join(source, file), join(target, file));
}
