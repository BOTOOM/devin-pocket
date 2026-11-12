import { afterAll, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => 'es', setItem: () => {} });
const { t, setLang } = await import('../src/web/i18n.js');
afterAll(() => vi.unstubAllGlobals());

it('localizes all Pocket doctor text in Spanish and English', () => {
  for (const lang of ['es', 'en'] as const) {
    setLang(lang);
    for (const key of [
      'doctor.label.pocket-update',
      'doctor.detail.pocket-update',
      'doctor.fix.pocket-update',
    ]) {
      expect(t(key as Parameters<typeof t>[0])).not.toBe(key);
    }
  }
});
