import { expect, type Page, test } from '@playwright/test';
import { startSession } from './session-helpers';

async function newSessionFromSwitcher(page: Page) {
  const previous = page.url();
  await page.getByTestId('session-switcher-trigger').click();
  const sheet = page.getByTestId('session-switcher');
  await sheet.getByRole('button', { name: /^(Nueva sesión|New session)$/ }).click();
  const start = page.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ });
  await start.click();
  await expect(page).not.toHaveURL(previous);
  await expect(page.locator('textarea')).toBeVisible();
  return page.url();
}

const idOf = (url: string) => decodeURIComponent(url.split('#/s/')[1] ?? '');

async function openSwitcher(page: Page) {
  // A sheet still animating out swallows the click.
  await expect(page.getByTestId('session-switcher')).toHaveCount(0);
  await page.getByTestId('session-switcher-trigger').click();
  const sheet = page.getByTestId('session-switcher');
  await expect(sheet).toBeVisible();
  return sheet;
}

async function switchTo(page: Page, url: string) {
  const sheet = await openSwitcher(page);
  await sheet.locator(`[data-session-id="${idOf(url)}"]`).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(url);
}

test('chat title opens the session switcher and drafts survive switching', async ({ page }) => {
  await page.goto('/#/');
  await startSession(page);
  const first = page.url();
  await page.locator('textarea').fill('BORRADOR_UNO');
  const second = await newSessionFromSwitcher(page);
  await expect(page.locator('textarea')).toHaveValue('');
  await page.locator('textarea').fill('BORRADOR_DOS');

  const sheetSearch = async () => {
    await page.getByTestId('session-switcher-trigger').click();
    const sheet = page.getByTestId('session-switcher');
    await expect(sheet.getByRole('searchbox')).toBeVisible();
    await sheet.getByRole('searchbox').fill('zz-no-match');
    await expect(sheet.getByText(/No hay sesiones|No matching/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  };
  await sheetSearch();
  // The search resets when the sheet closes.
  await expect((await openSwitcher(page)).getByRole('searchbox')).toHaveValue('');
  await page.keyboard.press('Escape');

  await switchTo(page, first);
  await expect(page.locator('textarea')).toHaveValue('BORRADOR_UNO');
  await switchTo(page, second);
  await expect(page.locator('textarea')).toHaveValue('BORRADOR_DOS');
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('BORRADOR_DOS');
});

test('switcher marks a session working, then finished and unseen', async ({ page }) => {
  await page.goto('/#/');
  await startSession(page);
  const first = page.url();
  await page.locator('textarea').fill('QUEUE_HOLD');
  await page.keyboard.press('Enter');
  const second = await newSessionFromSwitcher(page);
  let sheet = await openSwitcher(page);
  const row = sheet.locator(`[data-session-id="${idOf(first)}"]`);
  await expect(row.locator('[data-activity="working"]')).toBeVisible();
  await expect(row.locator('[data-activity="unseen"]')).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole('img', { name: /Terminó, sin ver|Finished, not seen/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await switchTo(page, first);
  await switchTo(page, second);
  sheet = await openSwitcher(page);
  await expect(sheet.locator(`[data-session-id="${idOf(first)}"] [data-activity]`)).toHaveCount(0);
});

test('a session locked by another client explains itself instead of loading forever', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/s/fake-session-newest');
  await expect(page.getByTestId('session-locked')).toContainText(/otro cliente|Another client/);
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
});
