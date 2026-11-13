import { expect, it, vi } from 'vitest';
import { coalescedModelFetch } from '../src/web/lib/dictation/model-fetch.js';

it('coalesces parallel model requests until their browser cache write completes', async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response('model'));
  let finish: (() => void) | undefined;
  const write = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const persist = vi.fn(async () => write);
  const fetchModel = coalescedModelFetch(upstream, 'https://pocket.test/models/', persist);
  const [one, two] = await Promise.all([
    fetchModel('https://pocket.test/models/config.json'),
    fetchModel('https://pocket.test/models/config.json'),
  ]);
  expect(await one.text()).toBe('model');
  expect(await two.text()).toBe('model');
  expect(await (await fetchModel('https://pocket.test/models/config.json')).text()).toBe('model');
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledTimes(1);
  finish?.();
});
it('does not persist upstream errors and leaves runtime asset requests alone', async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response('', { status: 502 }));
  const persist = vi.fn();
  const fetchModel = coalescedModelFetch(upstream, 'https://pocket.test/models/', persist);
  expect((await fetchModel('https://pocket.test/models/config.json')).status).toBe(502);
  expect(persist).not.toHaveBeenCalled();
  await fetchModel('https://pocket.test/onnx/runtime.wasm');
  expect(upstream).toHaveBeenCalledTimes(2);
});
