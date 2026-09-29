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

test('queue can interrupt an active turn on mobile', async ({ page }) => {
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  await page.locator('textarea').fill('QUEUE_HOLD');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Añadir a la cola|Add to queue/i })).toBeVisible();
  await page.locator('textarea').fill('QUEUE_RESULT_mobile');
  await page.keyboard.press('Enter');
  const queue = page.getByRole('region', { name: /En cola|Queued/i });
  await expect(queue.getByText('QUEUE_RESULT_mobile')).toBeVisible();
  await queue.getByRole('button', { name: /Enviar ahora|Send now/i }).click();
  await expect(page.getByText('Completed QUEUE_RESULT_mobile')).toBeVisible({ timeout: 15_000 });
  await expect(queue).toHaveCount(0);
});

test('side question works alongside an active turn', async ({ page }) => {
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Pregunta aparte|Side question/i })).toBeVisible();
  await page.locator('textarea').first().fill('QUEUE_HOLD');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Working on queued task')).toBeVisible();
  await page.getByRole('button', { name: /Pregunta aparte|Side question/i }).click();
  const panel = page.getByRole('region', { name: /Pregunta aparte|Side question/i });
  await panel.getByRole('textbox').fill('¿Cómo va?');
  await panel
    .getByRole('button', { name: /Preguntar sin interrumpir|Ask without interrupting/i })
    .click();
  await expect(panel.getByText('Side answer: ¿Cómo va?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Añadir a la cola|Add to queue/i })).toBeVisible();
  await expect(page.locator('.prose').filter({ hasText: 'Side answer:' })).toHaveCount(1);
});
