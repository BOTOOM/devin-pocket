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

test('ACP Markdown renders on mobile without losing file references or code', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  await page.locator('textarea').fill('MARKDOWN_FIXTURE');
  await page.keyboard.press('Enter');
  const response = page
    .locator('.prose')
    .filter({ has: page.getByRole('heading', { name: 'Título' }) });
  await expect(response.getByRole('listitem')).toHaveCount(2);
  await expect(response.locator('table td').last()).toHaveText('$1');
  await expect(response.locator('.file-reference')).toHaveText([
    '/tmp/proyecto/src/index.ts:10-12',
    '/tmp/proyecto/README.md',
  ]);
  await expect(response.locator('script')).toHaveCount(0);
  await expect(response.locator('pre code')).toHaveText('const test = "<script>";');
  await response.locator('[data-copy-code]').click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('const test = "<script>";');
  await expect(response.locator('a')).toHaveAttribute('href', 'https://example.com');
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflows).toBe(false);
});
