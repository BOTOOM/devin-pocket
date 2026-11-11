import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { startSession } from './session-helpers';

for (const theme of ['dark', 'light'] as const) {
  test(`${theme} brand surfaces and theme switching`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => {
      localStorage.setItem('dp.theme', value);
      localStorage.setItem('dp.lang', 'en');
    }, theme);
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        const data = JSON.parse(String(message));
        if (data.type === 'hello' || data.type === 'catalog') {
          data.catalog = {
            status: 'ready',
            fromCache: false,
            fetchedAt: Date.now(),
            entries: [
              ['swe-2', 'SWE-2', 1, 4, 262000],
              ['gpt-6-sol', 'GPT-6 Sol', 2, 8, 1000000],
              ['opus-5', 'Claude Opus 5', 3, 12, 200000],
              ['gemini-4', 'Gemini 4', 0, 0, 131072],
            ].map(([modelUid, label, input, output, maxContext]) => ({
              modelUid,
              label,
              prices: { input, output },
              maxContext,
              isNew: false,
              isBeta: false,
            })),
          };
        }
        ws.send(JSON.stringify(data));
      });
    });
    const shot = async (screen: string) => {
      const dir = process.env.THEME_SCREENSHOT_DIR;
      if (dir) await mkdir(dir, { recursive: true });
      await page.screenshot({
        scale: 'css',
        path: dir ? `${dir}/${screen}-${theme}.png` : testInfo.outputPath(`${screen}-${theme}.png`),
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    };
    await page.goto('/#/');
    await expect(page.getByText('Fix the flaky test')).toBeVisible();
    await expect(page.locator('header svg').first()).toHaveAttribute('viewBox', '0 0 512 512');
    await shot('sessions');
    await page.locator('[data-chip="workspace"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot('drawer');
    await page.keyboard.press('Escape');
    await startSession(page);
    await expect(page.locator('textarea')).toBeVisible();
    await shot('empty');
    await page.locator('textarea').fill('Review the workspace');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/asks permission/i)).toBeVisible({ timeout: 20_000 });
    await shot('permission');
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    const edit = page.getByRole('button', { name: /Edit src\/index.ts/ });
    await expect(edit).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('const a = 2;')).toBeVisible();
    await shot('diff');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('textarea').fill('MARKDOWN_FIXTURE');
    await page.keyboard.press('Enter');
    await expect(page.locator('.prose pre code')).toHaveText('const test = "<script>";');
    await page.locator('.prose pre code').scrollIntoViewIfNeeded();
    await shot('chat');
    await page.locator('[data-chip="model"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot('model');
    await page.getByRole('radio', { name: 'Compare', exact: true }).click();
    const cost = page.getByTestId('relative-cost');
    await expect(cost).toContainText('Relative listed cost');
    await expect(cost.locator('[data-model]')).toHaveCount(4);
    await expect(cost.locator('[data-marker]')).toHaveCount(1);
    const selectedPosition = await cost.locator('[data-marker="current"]').getAttribute('style');
    await page.getByPlaceholder('Search models…').fill('GPT');
    await expect(cost.locator('[data-model]')).toHaveCount(4);
    await expect(cost.locator('[data-marker="current"]')).toHaveAttribute(
      'style',
      selectedPosition ?? '',
    );
    await page.getByPlaceholder('Search models…').fill('');
    expect(
      await page
        .getByRole('dialog')
        .locator('table')
        .evaluate((el) => el.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);
    await shot('model-compare');
    await page.getByRole('row').filter({ hasText: 'GPT-6 Sol' }).click();
    await expect(cost.locator('[data-marker]')).toHaveCount(2);
    await expect(cost.locator('[data-marker="current"]')).toHaveAttribute('data-model', 'swe-2');
    await expect(cost.locator('[data-marker="new"]')).toHaveAttribute('data-model', 'gpt-6-sol');
    await expect(cost).toContainText('Current: SWE-2');
    await expect(cost).toContainText('New: GPT-6 Sol');
    await shot('model-confirm');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Gemini 4' }).click();
    await expect(cost.locator('[data-marker="new"]')).toHaveAttribute('style', /left: 0%/);
    await expect(cost).toContainText('New: Gemini 4 · 0%');
    await shot('model-free');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'SWE-1.6' }).first().click();
    await expect(cost).toContainText('Position unavailable');
    await expect(cost.locator('[data-marker="new"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/#/settings');
    await expect(page.getByText('Plan & quota')).toBeVisible();
    await shot('settings');
    const opposite = theme === 'dark' ? 'Light' : 'Dark';
    await page.getByRole('radio', { name: opposite, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(theme === 'light' ? /dark/ : /^(?!.*dark)/);
    const expected = theme === 'dark' ? '#f6f7f2' : '#111412';
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      'content',
      expected,
    );
    await expect(page.locator('meta[name="theme-color"]').last()).toHaveAttribute(
      'content',
      expected,
    );
    await page.getByRole('radio', { name: 'System', exact: true }).click();
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
    await expect(page.locator('html')).toHaveClass(theme === 'light' ? /dark/ : /^(?!.*dark)/);
  });
}
