import { MODEL_PREFIX, WHISPER_MODEL, WHISPER_REVISION } from '@shared/dictation';
import { useSyncExternalStore } from 'react';
import type { LanguageChoice } from './state';

const listeners = new Set<() => void>();
export function saved(key: string): string | null {
  try {
    return localStorage.getItem(`dp.dictation.${key}`);
  } catch {
    return null;
  }
}
export function save(key: string, value: string) {
  try {
    localStorage.setItem(`dp.dictation.${key}`, value);
  } catch {
    /* Storage may be disabled. */
  }
  for (const listener of listeners) listener();
}
export function useDictationPreference(key: string) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener('storage', cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', cb);
      };
    },
    () => saved(key),
  );
}
export function languageChoice(): LanguageChoice {
  const value = saved('language');
  return value === 'es' || value === 'en' ? value : 'auto';
}
export async function deleteBrowserModel() {
  if ('caches' in globalThis) {
    const prefix = `${location.origin}${MODEL_PREFIX}${WHISPER_MODEL}/${WHISPER_REVISION}/`;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        if (request.url.startsWith(prefix)) await cache.delete(request);
    }
  }
  save('downloaded', '');
  save('consent', '');
  window.dispatchEvent(new Event('dp.dictation.delete'));
}
