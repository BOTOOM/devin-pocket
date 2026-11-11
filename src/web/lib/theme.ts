import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'dp.theme';
let theme: Theme = (localStorage.getItem(KEY) as Theme) || 'system';
const listeners = new Set<() => void>();

function resolved(): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply() {
  const dark = resolved() === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', dark ? '#111412' : '#f6f7f2');
  });
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'system') apply();
});

export function setTheme(t: Theme) {
  theme = t;
  localStorage.setItem(KEY, t);
  apply();
  for (const l of listeners) l();
}

export function useTheme(): { theme: Theme; resolved: 'light' | 'dark' } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${theme}:${resolved()}`,
  ) === 'light:light'
    ? { theme: 'light', resolved: 'light' }
    : { theme, resolved: resolved() };
}

export function useResolvedTheme(): 'light' | 'dark' {
  return useTheme().resolved;
}

apply();
