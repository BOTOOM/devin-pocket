import { expect, test } from '@playwright/test';

test('fake agent home → session → prompt → permission → tool and usage', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('Devin Pocket')).toBeVisible();
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  await expect(page.locator('textarea')).toBeVisible();
  await page.locator('textarea').fill('Lista los archivos de src');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Devin pide permiso|asks permission/i)).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByRole('button', { name: /allow|permitir/i })
    .first()
    .click();
  await expect(page.locator('[data-chip="usage"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Edit src\/index\.ts|Read file|ls \.\/src/i).first()).toBeVisible({
    timeout: 20_000,
  });
});
