import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'chat'; sessionId: string }
  | { name: 'settings' }
  | { name: 'diagnostics' };

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const m = h.match(/^\/s\/(.+)$/);
  if (m) return { name: 'chat', sessionId: decodeURIComponent(m[1]!) };
  if (h === '/settings') return { name: 'settings' };
  if (h === '/diagnostics') return { name: 'diagnostics' };
  return { name: 'home' };
}

const listeners = new Set<() => void>();
addEventListener('hashchange', () => {
  for (const l of listeners) l();
});

export function navigate(r: Route | string) {
  const path =
    typeof r === 'string'
      ? r === 'home' || r === '/'
        ? '/'
        : r.startsWith('/')
          ? r
          : `/${r}`
      : r.name === 'chat'
        ? `/s/${encodeURIComponent(r.sessionId)}`
        : r.name === 'home'
          ? '/'
          : `/${r.name}`;
  location.hash = `#${path}`;
  if (!location.hash) for (const l of listeners) l();
}

export function useRoute(): Route {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.hash,
    () => '',
  );
  return parse(location.hash);
}
