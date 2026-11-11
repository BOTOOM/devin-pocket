import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
const block = (selector: string) => {
  const body = css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
};
const luminance = (hex: string) => {
  const rgb =
    hex
      .slice(1)
      .match(/../g)
      ?.map((c) => {
        const v = Number.parseInt(c, 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }) ?? [];
  return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
};

describe('brand theme contrast', () => {
  for (const theme of ['light', 'dark']) {
    const tokens = { ...block(':root'), ...(theme === 'dark' ? block('.dark') : {}) };
    const resolve = (name: string): string => {
      const value = tokens[name] ?? '';
      return value.startsWith('var(') ? resolve(value.slice(6, -1)) : value;
    };
    const contrast = (a: string, b: string) => {
      const l = [luminance(resolve(a)), luminance(resolve(b))].sort((x, y) => y - x);
      return ((l[0] ?? 0) + 0.05) / ((l[1] ?? 0) + 0.05);
    };
    for (const bg of ['background', 'card', 'popover', 'muted', 'accent']) {
      for (const fg of [
        'foreground',
        'muted-foreground',
        'link',
        'success',
        'warning',
        'info',
        'destructive',
      ]) {
        it(`${theme}: ${fg} on ${bg} meets AA`, () =>
          expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
      }
    }
    for (const [fg, bg] of [
      ['primary-foreground', 'primary'],
      ['destructive-foreground', 'destructive'],
      ['accent-foreground', 'accent'],
      ['diff-add-fg', 'diff-add-bg'],
      ['diff-del-fg', 'diff-del-bg'],
      ['code-foreground', 'code'],
      ['ring', 'background'],
      ...(theme === 'light' ? [['ring', 'primary'] as const] : []),
    ] as const) {
      it(`${theme}: ${fg} on ${bg} meets AA`, () =>
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
    }
    for (const bg of ['background', 'card', 'popover']) {
      it(`${theme}: controls on ${bg} meet 3:1`, () =>
        expect(contrast('border', bg)).toBeGreaterThanOrEqual(3));
    }
  }
});

it('uses the new installable brand and both theme-color declarations', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../src/web/public/manifest.webmanifest', import.meta.url), 'utf8'),
  );
  expect(manifest.theme_color).toBe('#111412');
  expect(manifest.background_color).toBe('#111412');
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  expect(html).toContain('content="#f6f7f2" media="(prefers-color-scheme: light)"');
  expect(html).toContain('content="#111412" media="(prefers-color-scheme: dark)"');
});
