import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import QRCode from 'qrcode';
import type { DevicesResponse, PairingResponse } from '../src/shared/protocol';

let child: ChildProcess;
let state: string;
let base: string;
let admin: string;

test.beforeAll(async () => {
  fs.mkdirSync('test-results/pairing-server', { recursive: true });
  state = fs.mkdtempSync(path.resolve('test-results/pairing-server/host-'));
  const out = fs.openSync(path.join(state, 'server.log'), 'a');
  child = spawn(
    process.execPath,
    [
      'bin/devin-pocket.mjs',
      'start',
      '--host',
      '0.0.0.0',
      '--port',
      '0',
      '--foreground',
      '--no-open',
    ],
    {
      env: {
        ...process.env,
        XDG_STATE_HOME: state,
        XDG_CONFIG_HOME: state,
        XDG_CACHE_HOME: state,
        DEVIN_POCKET_NO_UPDATE_CHECK: '1',
        DEVIN_POCKET_AGENT: `"${process.execPath}" --import tsx test/fake-agent.ts`,
        FAKE_AGENT_AUTHED: '1',
        FAKE_AGENT_FAST: '1',
      },
      stdio: ['ignore', out, out],
    },
  );
  fs.closeSync(out);
  const info = path.join(state, 'devin-pocket', 'server.json');
  await expect.poll(() => fs.existsSync(info)).toBe(true);
  base = `http://127.0.0.1:${JSON.parse(fs.readFileSync(info, 'utf8')).port}`;
  admin = fs.readFileSync(path.join(state, 'devin-pocket', 'admin.token'), 'utf8');
  expect(await fetch(`${base}/api/auth/status`).then((response) => response.json())).toEqual({
    required: true,
    paired: false,
  });
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
  }
});

async function adminCall<T>(route: string, method = 'GET'): Promise<T> {
  const response = await fetch(`${base}/api/auth/${route}`, {
    method,
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}
const grant = () => adminCall<PairingResponse>('pairings', 'POST');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dp.lang', 'en');
  });
});
test.afterEach(async () => {
  await adminCall('devices', 'DELETE');
});

async function pairCode(page: Page, name = 'Test phone') {
  const access = await grant();
  await page.goto(base);
  await expect(page.getByTestId('pair-screen')).toBeVisible();
  await page
    .getByLabel('Access code', { exact: true })
    .fill(access.code.replace('-', ' ').toLowerCase());
  await expect(page.getByLabel('Access code', { exact: true })).toHaveValue(access.code);
  await page.getByLabel('Device name (optional)', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Pair device', exact: true }).click();
  await expect(page.getByText('Fix the flaky test', { exact: true })).toBeVisible();
}

async function settings(page: Page) {
  await page.goto(`${base}/#/settings`);
  await expect(page.getByText('This device', { exact: true })).toBeVisible();
}

test('unpaired gate handles invalid codes, rate limits and network errors', async ({ page }) => {
  let sockets = 0;
  page.on('websocket', () => {
    sockets++;
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Connect your device' })).toBeVisible();
  await page.getByLabel('Access code', { exact: true }).fill('aaaa aaaa');
  await page.getByRole('button', { name: 'Pair device', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('invalid, already used or expired');
  await page.route('**/api/auth/pair', (route) =>
    route.fulfill({ status: 429, json: { error: 'too many pairing attempts' } }),
  );
  await page.getByRole('button', { name: 'Pair device', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Wait a minute');
  await page.unroute('**/api/auth/pair');
  await page.route('**/api/auth/pair', (route) => route.abort());
  await page.getByRole('button', { name: 'Pair device', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not connect');
  expect(sockets).toBe(0);
});

test('status network failure has a retry and never starts an unauthenticated socket', async ({
  page,
}) => {
  await page.route('**/api/auth/status', (route) => route.abort());
  await page.goto(base);
  await expect(page.getByRole('alert')).toContainText('Could not connect');
  await page.unroute('**/api/auth/status');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pair device', exact: true })).toBeDisabled();
});

test('a human code pairs and persists across reload', async ({ page }) => {
  await pairCode(page);
  await page.reload();
  await expect(page.getByText('Fix the flaky test', { exact: true })).toBeVisible();
  await settings(page);
  await expect(page.getByTestId('paired-device')).toContainText('Test phone');
});

test('token links show progress, redeem once under StrictMode and erase the fragment token', async ({
  page,
}) => {
  const access = await grant();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/auth/pair', async (route) => {
    requests++;
    await pending;
    await route.continue();
  });
  await page.goto(`${base}/#/pair?t=${access.token}`);
  try {
    await expect(page.getByRole('status')).toHaveText('Pairing this device…');
  } finally {
    release();
  }
  await expect(page.getByText('Fix the flaky test', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${base}/#/`);
  expect(requests).toBe(1);
});

test('Settings QR matches its origin, polls new devices and revokes another device', async ({
  page,
  browser,
}) => {
  await pairCode(page);
  await settings(page);
  const response = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/pairings'),
  );
  await page.getByRole('button', { name: 'New access QR', exact: true }).click();
  const access = (await (await response).json()) as PairingResponse;
  const expected = `${base}/#/pair?t=${access.token}`;
  await expect(page.getByTestId('access-url')).toHaveText(expected);
  const matrix = QRCode.create(expected, { errorCorrectionLevel: 'M' }).modules;
  const expectedPath = Array.from({ length: matrix.size }, (_, y) =>
    Array.from({ length: matrix.size }, (_, x) =>
      matrix.get(y, x) ? `M${x + 4} ${y + 4}h1v1h-1z` : '',
    ).join(''),
  ).join('');
  const qr = page.getByTestId('access-qr');
  await expect(qr).toHaveAttribute('viewBox', `0 0 ${matrix.size + 8} ${matrix.size + 8}`);
  await expect(qr.locator('rect')).toHaveAttribute('fill', '#fff');
  await expect(qr.locator('path')).toHaveAttribute('d', expectedPath);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(access.code);
  const other = await browser.newContext();
  try {
    expect(
      (
        await other.request.post(`${base}/api/auth/pair`, {
          data: { token: access.token, name: 'Other phone' },
        })
      ).ok(),
    ).toBe(true);
    const otherPage = await other.newPage();
    await otherPage.goto(base);
    await expect(otherPage.getByText('Fix the flaky test', { exact: true })).toBeVisible();
    await expect(page.getByTestId('paired-device').filter({ hasText: 'Other phone' })).toHaveCount(
      1,
      { timeout: 10000 },
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke access for Other phone', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(page.getByTestId('paired-device')).toHaveCount(1);
    await expect(otherPage.getByTestId('pair-screen')).toBeVisible();
  } finally {
    await other.close();
  }
});

test('a token link navigated within an existing app is also redeemed and cleared', async ({
  page,
}) => {
  await pairCode(page);
  const before = await page.request
    .get(`${base}/api/auth/status`)
    .then((response) => response.json());
  const access = await grant();
  const paired = page.waitForResponse((response) => response.url().endsWith('/api/auth/pair'));
  await page.evaluate((token) => {
    location.hash = `#/pair?t=${token}`;
  }, access.token);
  expect((await paired).ok()).toBe(true);
  await expect(page).toHaveURL(`${base}/#/`);
  await expect(page.getByText('Fix the flaky test', { exact: true })).toBeVisible();
  const after = await page.request
    .get(`${base}/api/auth/status`)
    .then((response) => response.json());
  expect(after.deviceId).not.toBe(before.deviceId);
});

test('invalid token links clear their secret and display a localized error', async ({ page }) => {
  await page.goto(`${base}/#/pair?t=expired-token`);
  await expect(page.getByRole('alert')).toContainText('invalid, already used or expired');
  await expect(page).toHaveURL(`${base}/#/`);
  await expect(page.getByTestId('pair-screen')).toBeVisible();
});

test('QR grant-limit errors give expiry guidance and allow retry', async ({ page }) => {
  await pairCode(page);
  await settings(page);
  await page.route('**/api/auth/pairings', (route) =>
    route.fulfill({ status: 429, json: { error: 'too many active pairing grants' } }),
  );
  await page.getByRole('button', { name: 'New access QR', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('up to ten minutes');
  await page.unroute('**/api/auth/pairings');
  await page.getByRole('dialog').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('access-qr')).toBeVisible();
});

test('current-device revocation returns to the gate without a reconnect loop', async ({ page }) => {
  await pairCode(page);
  await page.clock.install();
  let connections = 0;
  page.on('websocket', () => {
    connections++;
  });
  const devices = (await page.request
    .get(`${base}/api/auth/devices`)
    .then((response) => response.json())) as DevicesResponse;
  const current = devices.devices.find((device) => device.current);
  expect(current).toBeDefined();
  await adminCall(`devices/${current?.id}`, 'DELETE');
  await expect(page.getByTestId('pair-screen')).toBeVisible();
  await page.clock.fastForward(60000);
  expect(connections).toBe(0);
});

test('revoke others preserves current access; logout requires pairing again', async ({ page }) => {
  await pairCode(page);
  const access = await grant();
  expect(
    (
      await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: access.token, name: 'Spare' }),
      })
    ).ok,
  ).toBe(true);
  await settings(page);
  await page.getByRole('button', { name: 'Revoke other devices', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByTestId('paired-device')).toHaveCount(1);
  await page.getByRole('button', { name: 'Unpair this device', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByTestId('pair-screen')).toBeVisible();
});

test('QR expiry removes the QR and supports regeneration', async ({ page }) => {
  await pairCode(page);
  await settings(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'New access QR', exact: true }).click();
  await expect(page.getByTestId('access-qr')).toBeVisible();
  await page.clock.fastForward(11 * 60 * 1000);
  await expect(page.getByRole('timer')).toHaveText('Expired');
  await expect(page.getByTestId('access-qr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeDisabled();
  await page.clock.setSystemTime(Date.now());
  await page.getByRole('button', { name: 'Generate another', exact: true }).click();
  await expect(page.getByTestId('access-qr')).toBeVisible();
});

for (const [width, theme] of [
  [390, 'light'],
  [390, 'dark'],
  [768, 'dark'],
  [1024, 'dark'],
] as const) {
  test(`pairing surfaces ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((theme) => {
      localStorage.setItem('dp.theme', theme);
      localStorage.setItem('dp.lang', 'es');
    }, theme);
    await page.goto(base);
    await expect(page.getByRole('heading', { name: 'Conecta tu dispositivo' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Emparejar dispositivo', exact: true }),
    ).toBeDisabled();
    fs.mkdirSync('test-results/pairing-web', { recursive: true });
    await page.screenshot({
      path: `test-results/pairing-web/pair-${width}-${theme}.png`,
      scale: 'css',
    });
    const access = await grant();
    await page.getByLabel('Código de acceso', { exact: true }).fill(access.code);
    await page.getByRole('button', { name: 'Emparejar dispositivo', exact: true }).click();
    await expect(page.getByText('Fix the flaky test', { exact: true })).toBeVisible();
    await page.goto(`${base}/#/settings`);
    await page.getByRole('button', { name: 'Nuevo QR de acceso', exact: true }).click();
    await expect(page.getByTestId('access-qr')).toBeVisible();
    await page.screenshot({
      path: `test-results/pairing-web/qr-${width}-${theme}.png`,
      scale: 'css',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const box = await page.getByRole('dialog').boundingBox();
    expect(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844,
    ).toBe(true);
  });
}
