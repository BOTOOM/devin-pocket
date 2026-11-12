import { expect, type Page } from '@playwright/test';

export async function startSession(page: Page) {
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ }).click();
  await expect(page.locator('textarea').first()).toBeVisible();
}
