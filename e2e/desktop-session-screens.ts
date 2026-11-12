import { expect, type Page, test } from '@playwright/test';

async function createSession(page: Page) {
  const previous = page.url();
  await page
    .getByRole('button', { name: /^(Nueva sesión|New session)$/i })
    .first()
    .click();
  const start = page.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ });
  if (await start.isVisible()) await start.click();
  await expect(page).not.toHaveURL(previous);
  await expect(page.locator('textarea')).toBeVisible();
  return page.url();
}

test('desktop session changes do not leak composer drafts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  const first = await createSession(page);
  const second = await createSession(page);
  const rows = page.getByTestId('session-sidebar').locator('button[aria-current]');
  await rows.first().waitFor();
  const secondButton = await rows.first().elementHandle();
  const sessionButtons = page
    .getByTestId('session-sidebar')
    .locator('button')
    .filter({ has: page.locator('span.font-medium') });
  await sessionButtons.nth(1).click();
  await expect(page).toHaveURL(first);
  await page.locator('textarea').fill('PRIVATE_DRAFT_FOR_FIRST_SESSION');
  await secondButton?.click();
  await expect(page).toHaveURL(second);
  await expect(page.locator('textarea')).toHaveValue('');
});

test('desktop deleting the active session returns home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await createSession(page);
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
  await createSession(page);
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
    includeHidden: true,
  });
  await expect(buttons).toHaveCount(2);
  await buttons.first().click();
  const start = page.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ });
  if (await start.isVisible()) {
    await start.click();
    await buttons.nth(1).evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ }).click();
    await expect(
      page.getByRole('button', { name: /^(Creando|Creating)/i, includeHidden: true }),
    ).toHaveCount(2);
    expect(creations).toBe(1);
    return;
  }
  await buttons.nth(1).evaluate((button: HTMLButtonElement) => button.click());
  await expect(buttons.first()).toBeDisabled();
  await expect(buttons.nth(1)).toBeDisabled();
  expect(creations).toBe(1);
});
