import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('browse starts at a selected external workspace root', async ({ page }) => {
  const root = '/srv/configured-project';
  await page.addInitScript((root) => {
    localStorage.setItem('dp.lang', 'en');
    localStorage.setItem(
      'dp.prefs',
      JSON.stringify({ workspace: root, workspaces: [{ path: root }] }),
    );
  }, root);
  await page.route('/api/workspaces/browse?*', async (route) => {
    const selected = new URL(route.request().url()).searchParams.get('path');
    const current = selected || os.homedir();
    await route.fulfill({
      json: {
        home: os.homedir(),
        path: current,
        entries: current === root ? [{ name: 'child', path: `${root}/child`, kind: 'dir' }] : [],
      },
    });
  });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const panel = page.getByRole('dialog');
  const browse = page.waitForRequest((r) => r.url().includes('/api/workspaces/browse?'));
  await panel.getByRole('button', { name: 'Browse for another folder', exact: true }).click();
  expect(new URL((await browse).url()).searchParams.get('path')).toBe(root);
  await panel.getByRole('button', { name: 'child', exact: true }).click();
  await panel.getByRole('button', { name: /Use this folder/ }).click();
  await expect(panel.getByTestId('selected-folder')).toHaveText(`${root}/child`);
});

for (const [width, height, theme] of [
  [390, 844, 'dark'],
  [390, 844, 'light'],
  [768, 1024, 'dark'],
  [1440, 900, 'dark'],
] as const) {
  test(`per-session folder at ${width}px ${theme}`, async ({ page }, testInfo) => {
    const repo = process.cwd();
    const folder = path.join(repo, 'src');
    let newCount = 0;
    let createdCwd: string | undefined;
    let listed = false;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(
      ({ repo, theme }) => {
        localStorage.setItem('dp.lang', 'en');
        localStorage.setItem('dp.theme', theme);
        localStorage.setItem(
          'dp.prefs',
          JSON.stringify({ workspaces: [{ path: repo, name: 'Repository' }] }),
        );
      },
      { repo, theme },
    );
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const server = ws.connectToServer();
      let id: string | undefined;
      server.onMessage((message) => {
        const data = JSON.parse(String(message));
        if (data.type === 'ack' && data.id === id && data.ok) createdCwd = data.result.cwd;
        if (
          data.type === 'sessions.list' &&
          data.sessions.some((s: { cwd: string }) => s.cwd === folder)
        )
          listed = true;
        ws.send(message);
      });
      ws.onMessage((message) => {
        const data = JSON.parse(String(message));
        if (data.cmd?.type === 'session.new') {
          newCount++;
          id = data.id;
        }
        server.send(message);
      });
    });
    await page.goto('/#/');
    const launch = width >= 1024 ? page.getByTestId('main-pane') : page;
    await launch.getByRole('button', { name: 'New session', exact: true }).first().click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByTestId('selected-folder')).toHaveText(repo);
    await expect(panel.getByRole('button', { name: 'Start session', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(newCount).toBe(0);
    await page.getByRole('button', { name: 'New session', exact: true }).first().click();
    await panel.getByRole('button', { name: 'Browse for another folder', exact: true }).click();
    await expect(panel.getByRole('button', { name: /Use this folder/ })).toContainText(
      path.basename(repo),
    );
    await panel.getByRole('button', { name: 'src', exact: true }).last().click();
    await panel.getByRole('button', { name: /Use this folder/ }).click();
    await expect(panel.getByTestId('selected-folder')).toHaveText(folder);
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('dp.prefs') ?? '{}'));
    expect(prefs.workspace).toBe(folder);
    expect(prefs.workspaces[0].lastUsedAt).toBeGreaterThan(0);
    expect(newCount).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: testInfo.outputPath(`panel-${width}-${theme}.png`),
      animations: 'disabled',
    });
    await panel.getByRole('button', { name: 'Start session', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.getByTestId('session-folder')).toHaveText('src');
    await expect(page.getByTestId('session-folder')).toHaveAttribute('title', folder);
    expect(newCount).toBe(1);
    expect(createdCwd).toBe(folder);
    await expect.poll(() => listed).toBe(true);
    const chatUrl = page.url();
    await page.goto('/#/');
    await page.getByRole('button', { name: 'New session', exact: true }).first().click();
    await expect(panel.getByTestId('selected-folder')).toHaveText(folder);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(chatUrl);
    await expect(page.getByTestId('session-folder')).toHaveAttribute('title', folder);
    expect(newCount).toBe(1);
  });
}

for (const lang of ['en', 'es']) {
  test(`invalid folder error in ${lang}`, async ({ page }) => {
    await page.addInitScript(
      ({ lang, cwd }) => {
        localStorage.setItem('dp.lang', lang);
        localStorage.setItem(
          'dp.prefs',
          JSON.stringify({
            workspace: `${cwd}/does-not-exist`,
            workspaces: [{ path: cwd, name: 'Repository' }],
          }),
        );
      },
      { lang, cwd: process.cwd() },
    );
    await page.goto('/#/');
    await page
      .getByRole('button', { name: /^(New session|Nueva sesión)$/ })
      .first()
      .click();
    const panel = page.getByRole('dialog');
    await panel.getByRole('button', { name: /^(Start session|Iniciar sesión)$/ }).click();
    await expect(
      page.getByText(
        lang === 'en'
          ? /Choose an existing folder with an absolute path/
          : /Elige una carpeta existente con una ruta absoluta/,
      ),
    ).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    await panel.getByRole('button', { name: /Repository/ }).click();
    await panel.getByRole('button', { name: /^(Start session|Iniciar sesión)$/ }).click();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.getByTestId('session-folder')).toHaveAttribute('title', process.cwd());
  });
}
