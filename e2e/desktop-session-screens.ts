import { expect, test } from '@playwright/test';

test('desktop session changes do not leak composer drafts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.goto('/#/s/fake-session-middle');
  await expect(page.locator('textarea')).toBeVisible();
  await page.goto('/#/s/fake-session-empty');
  await expect(page.locator('textarea')).toBeVisible();
  await page.goto('/#/s/fake-session-middle');
  await page.locator('textarea').fill('PRIVATE_DRAFT_FOR_FIRST_SESSION');
  await page.goto('/#/s/fake-session-empty');
  await expect(page.locator('textarea')).toHaveValue('');
});

test('desktop deleting the active session returns home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  const start = page.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ });
  if (await start.isVisible()) await start.click();
  await expect(page.locator('textarea')).toBeVisible();
  const row = page
    .getByTestId('session-sidebar')
    .locator('button[aria-current="page"]')
    .locator('..');
  await row.getByRole('button', { name: 'menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /Eliminar|Delete/i }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Eliminar|Delete/i })
    .click();
  await expect(page).toHaveURL(/#\/$/);
  await page
    .getByTestId('session-sidebar')
    .getByText('Fix the flaky test', { exact: true })
    .click();
  await expect(page.locator('textarea')).toBeVisible();
});

test('desktop new session buttons share an in-flight guard', async ({ page }) => {
  let creations = 0;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((msg) => {
      const data = JSON.parse(String(msg));
      if (data?.cmd?.type === 'session.new') creations++;
      else server.send(msg);
    });
    server.onMessage((msg) => ws.send(msg));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  const buttons = page.getByRole('button', {
    name: /^(Nueva sesión|New session|Creando.*|Creating.*)$/i,
  });
  await expect(buttons).toHaveCount(2);
  await buttons.first().click();
  await buttons.nth(1).evaluate((button: HTMLButtonElement) => button.click());
  await expect(buttons.first()).toBeDisabled();
  await expect(buttons.nth(1)).toBeDisabled();
  expect(creations).toBe(1);
});
