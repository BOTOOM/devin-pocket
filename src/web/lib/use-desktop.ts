import { useSyncExternalStore } from 'react';

const desktopQuery = matchMedia('(min-width: 1024px)');
const subscribe = (notify: () => void) => {
  desktopQuery.addEventListener('change', notify);
  return () => desktopQuery.removeEventListener('change', notify);
};

/** True when the persistent session sidebar is shown (≥1024px). */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => desktopQuery.matches);
}
