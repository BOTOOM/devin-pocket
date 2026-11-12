import { expect, test } from '@playwright/test';
import { startSession } from './session-helpers';

for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
]) {
  test(`responsive layout and modal safety at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('dp.theme', 'dark');
      localStorage.setItem('dp.lang', 'en');
    });
    const noOverflow = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    };
    const panel = async (max: number) => {
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(async () => {
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        if (!box) return;
        if (width >= 768) {
          expect(box.width).toBeLessThanOrEqual(Math.min(max, width - 32) + 1);
          expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
          expect(Math.abs(box.y + box.height / 2 - height / 2)).toBeLessThan(2);
          expect(box.height).toBeLessThanOrEqual(height * 0.85 + 1);
        } else {
          expect(box.width).toBe(width);
          expect(box.x).toBe(0);
        }
      }).toPass();
      const close = dialog.getByRole('button', { name: 'Close', exact: true });
      const target = await close.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(40);
      expect(target?.height).toBeGreaterThanOrEqual(40);
      await noOverflow();
    };
    await page.goto('/#/');
    const sidebar = page.getByTestId('session-sidebar');
    await expect(sidebar).toHaveCount(width >= 1024 ? 1 : 0);
    if (width >= 1024) {
      await expect(page.getByRole('heading', { name: 'Select or start a session' })).toBeVisible();
      expect((await sidebar.boundingBox())?.width).toBe(320);
    }
    await noOverflow();
    await page.locator('[data-chip="workspace"]').click();
    await panel(640);
    await page.keyboard.press('Escape');
    await startSession(page);
    await expect(page.locator('textarea')).toBeVisible();
    if (width >= 1024) {
      await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);
      await expect
        .poll(async () => (await page.getByTestId('main-pane').boundingBox())?.width)
        .toBeLessThanOrEqual(860);
    }
    for (const chip of ['mode', 'reasoning', 'model']) {
      await page.locator(`[data-chip="${chip}"]`).click();
      await panel(chip === 'model' ? 880 : 560);
      if (chip === 'model') {
        await page.getByRole('radio', { name: 'Compare', exact: true }).click();
        await page.getByRole('row').filter({ hasText: 'GPT-6 Sol' }).click();
        const confirm = page.getByRole('button', { name: 'Switch to GPT-6 Sol' });
        await expect(confirm).toBeInViewport();
        await panel(880);
      }
      await page.keyboard.press('Escape');
    }
    await page.locator('textarea').fill('Review the workspace');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Devin asks permission')).toBeVisible({ timeout: 20_000 });
    await panel(560);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await noOverflow();
    for (const route of ['settings', 'diagnostics']) {
      await page.goto(`/#/${route}`);
      await expect(
        page.getByRole('heading', { name: route === 'settings' ? 'Settings' : 'Diagnostics' }),
      ).toBeVisible();
      await expect(sidebar).toHaveCount(width >= 1024 ? 1 : 0);
      await noOverflow();
    }
  });
}
