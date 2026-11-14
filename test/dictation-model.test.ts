import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DictationModels, modelFile } from '../src/server/dictation-model.js';
import { MODEL_PREFIX, WHISPER_MODEL, WHISPER_REVISION } from '../src/shared/dictation.js';

const prefix = `${MODEL_PREFIX}${WHISPER_MODEL}/${WHISPER_REVISION}/`;
const roots: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});
async function fixture(upstream: typeof fetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-model-'));
  roots.push(root);
  const models = new DictationModels(root, upstream);
  const server = http.createServer((req, res) => void models.serve(req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { root, base: `http://127.0.0.1:${address.port}` };
}
it('allows only pinned whisper-base files; rejects other repos, revisions and traversal', () => {
  expect(modelFile(`${prefix}onnx/encoder_model_quantized.onnx`)).toBe(
    'onnx/encoder_model_quantized.onnx',
  );
  for (const url of [
    `${prefix}../config.json`,
    `${prefix}%2e%2e/config.json`,
    `${prefix}onnx\\config.json`,
    `${prefix}unknown`,
    `${prefix}config.json?url=https://evil.test`,
    `${MODEL_PREFIX}other/model/main/config.json`,
    `${MODEL_PREFIX}${WHISPER_MODEL}/main/config.json`,
  ])
    expect(modelFile(url)).toBeNull();
});
it('streams an atomic first download; concurrent and subsequent requests use disk', async () => {
  const upstream = vi.fn<typeof fetch>(
    async () => new Response('test-model', { headers: { 'content-length': '10' } }),
  );
  const { base, root } = await fixture(upstream);
  const responses = await Promise.all([
    fetch(`${base}${prefix}config.json`),
    fetch(`${base}${prefix}config.json`),
  ]);
  for (const response of responses) expect(await response.text()).toBe('test-model');
  expect(await (await fetch(`${base}${prefix}config.json`)).text()).toBe('test-model');
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(String(upstream.mock.calls[0]?.[0])).toBe(
    `https://huggingface.co/${WHISPER_MODEL}/resolve/${WHISPER_REVISION}/config.json`,
  );
  expect(fs.readdirSync(root)).toEqual(['config.json']);
});
it('does not cache failed or empty downloads and can retry', async () => {
  const upstream = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(''))
    .mockResolvedValue(new Response('ok'));
  const { base, root } = await fixture(upstream);
  expect((await fetch(`${base}${prefix}config.json`)).status).toBe(502);
  expect(fs.readdirSync(root)).toEqual([]);
  expect((await fetch(`${base}${prefix}config.json`)).status).toBe(502);
  expect(await (await fetch(`${base}${prefix}config.json`)).text()).toBe('ok');
  expect(upstream).toHaveBeenCalledTimes(3);
});
it('never fetches rejected paths or unsupported methods', async () => {
  const upstream = vi.fn<typeof fetch>();
  const { base } = await fixture(upstream);
  expect((await fetch(`${base}${prefix}other.onnx`)).status).toBe(404);
  expect((await fetch(`${base}${prefix}config.json`, { method: 'POST' })).status).toBe(405);
  expect(upstream).not.toHaveBeenCalled();
});
