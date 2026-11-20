import { expect, type Page, test } from '@playwright/test';
import { startSession } from './session-helpers';

const idOf = (url: string) => decodeURIComponent(url.split('#/s/')[1] ?? '');

async function openPanel(page: Page) {
  // A panel still animating out swallows the click.
  await expect(page.getByTestId('session-panel')).toHaveCount(0);
  await page.getByTestId('session-panel-trigger').click();
  const panel = page.getByTestId('session-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function newSessionFromPanel(page: Page) {
  const previous = page.url();
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: /^(Nueva sesión|New session)$/ }).click();
  await page.getByRole('button', { name: /^(Iniciar sesión|Start session)$/ }).click();
  await expect(page).not.toHaveURL(previous);
  await expect(page.locator('textarea')).toBeVisible();
  return page.url();
}

async function switchTo(page: Page, url: string) {
  const panel = await openPanel(page);
  await panel.locator(`[data-session-id="${idOf(url)}"]`).click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(url);
}

test('chat side panel switches sessions and drafts survive switching', async ({ page }) => {
  await page.goto('/#/');
  await startSession(page);
  const first = page.url();
  await expect(page.getByRole('button', { name: /^(Atrás|Back)$/ })).toHaveCount(0);
  await page.locator('textarea').fill('BORRADOR_UNO');
  const second = await newSessionFromPanel(page);
  await expect(page.locator('textarea')).toHaveValue('');
  await page.locator('textarea').fill('BORRADOR_DOS');

  const panel = await openPanel(page);
  await expect(panel.getByRole('button', { name: /Configuración|Settings/ })).toBeVisible();
  await expect(panel.locator(`[data-session-id="${idOf(second)}"]`)).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('Escape');

  await switchTo(page, first);
  await expect(page.locator('textarea')).toHaveValue('BORRADOR_UNO');
  await switchTo(page, second);
  await expect(page.locator('textarea')).toHaveValue('BORRADOR_DOS');
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('BORRADOR_DOS');
});

test('side panel marks a session working, then finished and unseen', async ({ page }) => {
  await page.goto('/#/');
  await startSession(page);
  const first = page.url();
  await page.locator('textarea').fill('QUEUE_HOLD');
  await page.keyboard.press('Enter');
  const second = await newSessionFromPanel(page);
  const panel = await openPanel(page);
  const row = panel.locator(`[data-session-id="${idOf(first)}"]`);
  await expect(row.locator('[data-activity="working"]')).toBeVisible();
  await expect(row.locator('[data-activity="unseen"]')).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole('img', { name: /Terminó, sin ver|Finished, not seen/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await switchTo(page, first);
  await switchTo(page, second);
  const again = await openPanel(page);
  await expect(again.locator(`[data-session-id="${idOf(first)}"] [data-activity]`)).toHaveCount(0);
});

test('desktop chat has no back or panel button next to the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await startSession(page);
  await expect(page.getByTestId('session-sidebar')).toBeVisible();
  await expect(page.getByTestId('session-panel-trigger')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Atrás|Back)$/ })).toHaveCount(0);
});

test('a session locked by another client explains itself instead of loading forever', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/s/fake-session-newest');
  await expect(page.getByTestId('session-locked')).toContainText(/otro cliente|Another client/);
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
});
