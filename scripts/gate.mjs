import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:29229');
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:7777/#/');
await page.evaluate(() => {
  localStorage.setItem('dp.lang', 'es');
  localStorage.setItem('dp.theme', 'dark');
});
await page.reload();
await page.waitForTimeout(1200);
await page.screenshot({ path: '/home/ubuntu/shots/20-home-dark.png' });
const s = await page.locator('a[href*="#/s/"], [data-session]').first();
if (await s.count()) {
  await s.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/home/ubuntu/shots/21-chat-dark.png' });
}
if (process.env.GATE) {
  await page.goto('http://127.0.0.1:7778/#/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/home/ubuntu/shots/22-gate.png' });
}
await ctx.close();
await browser.close();
