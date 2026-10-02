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

test('compact controls stay on one row with long settings on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  await page.locator('[data-chip="mode"]').click();
  await page.getByText('Bypass Permissions', { exact: true }).last().click();
  await expect(page.locator('[data-chip="mode"]')).toContainText('Bypass Permissions');
  const positions = await page.locator('[data-chip]').evaluateAll((buttons) =>
    buttons
      .filter((b) => ['mode', 'model', 'reasoning'].includes(b.getAttribute('data-chip') ?? ''))
      .map((b) => {
        const rect = b.getBoundingClientRect();
        return { top: rect.top, right: rect.right };
      }),
  );
  expect(positions).toHaveLength(3);
  expect(new Set(positions.map((p) => p.top)).size).toBe(1);
  expect(positions.every((p) => p.right <= 320)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('[data-chip="model"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('visible commands button opens palette without changing the draft', async ({ page }) => {
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  const input = page.locator('textarea').first();
  await input.fill('Borrador');
  const attach = page.getByRole('button', { name: /Adjuntar imagen|Attach image/i });
  const cmdBtn = page.getByRole('button', { name: /Comandos|Commands/i });
  // icon-only button on the same row as attach/mention
  const [a, b] = await Promise.all([attach.boundingBox(), cmdBtn.boundingBox()]);
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeLessThan(4);
  await cmdBtn.click();
  await expect(page.getByRole('dialog').getByText('/plan', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Borrador');
  await page.getByRole('dialog').getByText('/plan', { exact: true }).click();
  await expect(input).toHaveValue('/plan ');
});

test('mention button loads files and picks one', async ({ page }) => {
  await page.goto('/#/');
  await page.getByText('Fix the flaky test').click();
  const input = page.locator('textarea').first();
  await expect(input).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Mencionar archivo|Mention file/i }).click();
  const row = page.getByRole('button', { name: /package\.json/ }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await page.keyboard.type('pack');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('button', { name: /^@package\.json/ })).toBeVisible();
  await expect(input).toHaveValue('');
});

test('enter inserts a newline when enter-to-send is off', async ({ page }) => {
  await page.goto('/#/settings');
  const toggle = page.getByRole('switch', { name: /Enter envía|Enter sends/i });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.goto('/#/');
  await page.getByText('Fix the flaky test').click();
  const input = page.locator('textarea').first();
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('línea uno');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('línea uno\n');
  await page.goto('/#/settings');
  await page.getByRole('switch', { name: /Enter envía|Enter sends/i }).click();
});

test('queued message edits in place keeping its position', async ({ page }) => {
  await page.goto('/#/');
  await page
    .getByRole('button', { name: /Nueva sesión|New session/i })
    .first()
    .click();
  const input = page.locator('textarea');
  await input.fill('QUEUE_HOLD');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Añadir a la cola|Add to queue/i })).toBeVisible();
  await input.fill('FIRST_QUEUED');
  await page.keyboard.press('Enter');
  await input.fill('SECOND_QUEUED');
  await page.keyboard.press('Enter');
  const queue = page.getByRole('region', { name: /En cola|Queued/i });
  await expect(queue.getByText('SECOND_QUEUED')).toBeVisible();
  const row = queue.locator('div', { hasText: 'SECOND_QUEUED' });
  await row.getByRole('button', { name: /Editar mensaje|Edit message/i }).click();
  await expect(page.getByText(/Editando mensaje en cola|Editing queued message/i)).toBeVisible();
  await expect(input).toHaveValue('SECOND_QUEUED');
  // the item stays queued while being edited
  await expect(queue.getByText('SECOND_QUEUED')).toBeVisible();
  await input.fill('SECOND_EDITED');
  await page.getByRole('button', { name: /Guardar cambios|Save changes/i }).click();
  await expect(page.getByText(/Editando mensaje en cola|Editing queued message/i)).toHaveCount(0);
  const rows = queue.locator('> div');
  await expect(rows.nth(0)).toContainText('FIRST_QUEUED');
  await expect(rows.nth(1)).toContainText('SECOND_EDITED');
});

test('new session shows busy state, blocks double-clicks and reports errors', async ({ page }) => {
  let newCount = 0;
  let ackId: string | null = null;
  let pendingAck: string | null = null;
  let deliver: ((msg: string) => void) | null = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((msg) => {
      const data = JSON.parse(String(msg));
      if (data?.cmd?.type === 'session.new') {
        newCount++;
        ackId = data.id;
      }
      server.send(msg);
    });
    server.onMessage((msg) => {
      const data = JSON.parse(String(msg));
      if (data?.type === 'ack' && data.id === ackId) {
        pendingAck = String(msg);
        deliver = (m) => ws.send(m);
        return;
      }
      ws.send(msg);
    });
  });
  await page.goto('/#/');
  const newBtn = page.getByRole('button', { name: /Nueva sesión|New session/i }).first();
  await newBtn.click();
  const busy = page.getByRole('button', { name: /Creando|Creating/i });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  expect(newCount).toBe(1);
  deliver?.(JSON.stringify({ type: 'ack', id: ackId, ok: false, error: 'boom' }));
  await expect(
    page.getByText(/No se pudo crear la sesión|Could not create the session/i),
  ).toBeVisible();
  await expect(newBtn).toBeEnabled();
  pendingAck = null;
  await newBtn.click();
  await expect.poll(() => newCount).toBe(2);
  await expect.poll(() => pendingAck).not.toBeNull();
  deliver?.(pendingAck ?? '');
  await expect(page.locator('textarea')).toBeVisible();
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

test('long history renders the last page and expands on load earlier', async ({ page }) => {
  await page.goto('/#/');
  await page.getByText('Fix the flaky test').click();
  const earlier = page.getByRole('button', { name: /Cargar.*anteriores|Load.*earlier/i });
  await expect(earlier).toBeVisible({ timeout: 20_000 });
  // newest items rendered; oldest stay out of the DOM
  await expect(page.getByRole('button', { name: 'Filler call 80', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filler call 1', exact: true })).toHaveCount(0);
  await earlier.dispatchEvent('click'); // no scroll — it would auto-expand
  await expect(page.getByRole('button', { name: 'Filler call 1', exact: true })).toBeVisible();
  await expect(earlier).toHaveCount(0);
  // a double session.open would have replayed the history twice
  await expect(page.getByText('package.json is 22 lines.')).toHaveCount(1);
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
