import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('Pocket doctor label, versions and fix follow the UI language', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dp.lang', 'es'));
  await page.route('**/api/doctor', (route) =>
    route.fulfill({
      json: {
        checks: [
          {
            id: 'pocket-update',
            label: 'Devin Pocket version',
            detail: 'current 0.5.0 · latest known 99.0.0',
            fix: 'Run: devin-pocket update',
            status: 'warn',
            update: { current: '0.5.0', latest: '99.0.0', updateAvailable: true },
          },
        ],
        summary: 'warn',
        at: Date.now(),
      },
    }),
  );
  await page.goto('/#/diagnostics');
  await expect(page.getByText('Versión de Devin Pocket', { exact: true })).toBeVisible();
  await expect(
    page.getByText('actual 0.5.0 · última conocida 99.0.0', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Ejecuta: devin-pocket update', { exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`update notice at 390px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((theme) => {
      localStorage.setItem('dp.theme', theme);
      localStorage.setItem('dp.lang', 'es');
    }, theme);
    let latest = '99.0.0';
    await page.route('**/api/health', (route) =>
      route.fulfill({
        json: {
          ok: true,
          update: { current: '0.5.0', latest, updateAvailable: true },
        },
      }),
    );
    await page.goto('/#/settings');
    const notice = page.getByRole('complementary', { name: 'Actualización disponible' });
    await expect(notice).toContainText('Nueva versión 99.0.0 disponible · ejecuta');
    await expect(notice.locator('code')).toHaveText('devin-pocket update');
    const dir = process.env.UPDATE_SCREENSHOT_DIR;
    if (dir) await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: dir
        ? `${dir}/settings-390-${theme}.png`
        : testInfo.outputPath(`settings-390-${theme}.png`),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await notice.getByRole('button', { name: 'Cerrar' }).click();
    await expect(notice).toHaveCount(0);
    await page.goto('/#/diagnostics');
    await expect(notice).toHaveCount(0);
    latest = '99.1.0';
    await page.reload();
    await expect(notice).toContainText('99.1.0');
  });
}

test('update health failures and current versions never block Settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dp.lang', 'en'));
  await page.route('**/api/health', (route) => route.abort());
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Update available' })).toHaveCount(0);
  await page.unroute('**/api/health');
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        update: { current: '1.0.0', latest: '1.0.0', updateAvailable: false },
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Update available' })).toHaveCount(0);
});
