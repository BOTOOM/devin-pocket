// Dev helper: drive the running app through Chrome (CDP) at a phone viewport and save screenshots.
import { chromium } from '@playwright/test';

const base = process.env.BASE ?? 'http://127.0.0.1:7777';
const out = process.env.OUT ?? '/home/ubuntu/shots';
const browser = await chromium.connectOverCDP('http://localhost:29229');
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: process.env.DARK ? 'dark' : 'light',
});
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));

await page.goto(`${base}/#/`);
await page.evaluate(() => localStorage.setItem('dp.lang', 'es'));
await page.reload();
await page.waitForTimeout(1500);
await shot('01-home');
await page
  .locator('[data-chip="workspace"], button:has-text("carpeta"), button:has-text("folder")')
  .first()
  .click();
await page.waitForTimeout(1000);
await shot('01b-workspace-sheet');
// With no saved workspaces the sheet is already in browse mode at $HOME.
const browseOther = page
  .getByRole('button', { name: /buscar otra|elegir carpeta|browse|choose folder/i })
  .last();
if (await browseOther.count()) {
  await browseOther.click();
  await page.waitForTimeout(800);
}
await shot('01b2-browse');
const repos = page.getByRole('button', { name: /^repos$/i }).first();
if (await repos.count()) {
  await repos.click();
  await page.waitForTimeout(800);
}
const pocket = page.getByRole('button', { name: /^devin-pocket$/i }).first();
if (await pocket.count()) {
  await pocket.click();
  await page.waitForTimeout(800);
}
await shot('01c-workspace-browse');
const use = page.getByRole('button', { name: /usar esta|use this|seleccionar|select/i }).first();
if (await use.count()) await use.click();
await page.waitForTimeout(800);
await shot('01d-home-ready');
await page
  .getByRole('button', { name: /nueva sesi/i })
  .first()
  .click();
await page.waitForTimeout(1500);
await shot('02-chat-empty');
const ta = page.locator('textarea').first();
await ta.fill('Lista los archivos de src y explica la estructura');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await shot('03-chat-streaming');
await page.waitForTimeout(4000);
await shot('04-chat-permission');
const allow = page.getByRole('button', { name: /^allow$|permitir/i }).first();
if (await allow.count()) await allow.click();
await page.waitForTimeout(6000);
await shot('05-chat-done');
await page.evaluate(() => document.querySelector('main, [data-scroll]')?.scrollTo(0, 0));
await page.waitForTimeout(500);
await shot('06-chat-top');
// model sheet
const modelChip = page
  .locator('[data-chip="model"], button:has-text("Model"), button:has-text("Modelo")')
  .first();
if (await modelChip.count()) {
  await modelChip.click();
  await page.waitForTimeout(800);
  await shot('07-model-sheet');
  await page.keyboard.press('Escape');
}
const modeChip = page.locator('[data-chip="mode"]').first();
if (await modeChip.count()) {
  await modeChip.click();
  await page.waitForTimeout(800);
  await shot('08-mode-sheet');
  await page.keyboard.press('Escape');
}
const usage = page.locator('[data-chip="usage"]').first();
if (await usage.count()) {
  await usage.click();
  await page.waitForTimeout(800);
  await shot('09-usage-sheet');
  await page.keyboard.press('Escape');
}
await ta.fill('/');
await page.waitForTimeout(800);
await shot('10-command-palette');
await page.keyboard.press('Escape');
await ta.fill('@');
await page.waitForTimeout(1200);
await shot('11-mentions');
await page.keyboard.press('Escape');
await page.goto(`${base}/#/settings`);
await page.waitForTimeout(800);
await shot('12-settings');
await page.goto(`${base}/#/diagnostics`);
await page.waitForTimeout(3000);
await shot('13-diagnostics');
await ctx.close();
await browser.close();
