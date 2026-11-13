import fs from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

function fixture() {
  const events = new Map<string, (event: unknown) => void>();
  const remove = vi.fn();
  const fetch = vi.fn();
  vm.runInNewContext(fs.readFileSync('src/web/public/sw.js', 'utf8'), {
    URL,
    fetch,
    caches: {
      keys: async () => [
        'dp-shell-v0',
        'dp-assets-v0',
        'dp-shell-v1',
        'dp-assets-v1',
        'transformers-cache',
        'unrelated',
      ],
      delete: remove,
    },
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        events.set(type, handler),
      clients: { claim: vi.fn() },
    },
  });
  return { events, remove, fetch };
}
it('preserves downloaded models across service-worker upgrades', async () => {
  const { events, remove } = fixture();
  let task: Promise<unknown> | undefined;
  events.get('activate')?.({
    waitUntil: (promise: Promise<unknown>) => {
      task = promise;
    },
  });
  await task;
  expect(remove.mock.calls.map(([key]) => key)).toEqual(['dp-shell-v0', 'dp-assets-v0']);
});
it('leaves model requests to the authenticated route and explicit model cache', () => {
  const { events, fetch } = fixture();
  const respondWith = vi.fn();
  events.get('fetch')?.({
    request: { url: 'https://pocket.test/models/hf/model/config.json', method: 'GET' },
    respondWith,
  });
  expect(respondWith).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
