/**
 * Capture README screenshots of a running build (vite preview).
 *   node tools/screenshots.mjs <outDir> [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const out = process.argv[2] ?? 'docs/screenshots';
const base = process.argv[3] ?? 'http://localhost:4173/frontier-portfolio/';
await mkdir(out, { recursive: true });

const settings = (theme) =>
  JSON.stringify({
    state: {
      theme,
      currency: 'INR',
      mode: 'beginner',
      lookback: 5,
      covariance: 'ledoit-wolf',
      returnModel: 'shrunk',
      profile: null,
      watchlist: [],
    },
    version: 1,
  });

const shots = [
  { name: 'today', path: './', theme: 'dark' },
  { name: 'portfolio', path: 'portfolio', theme: 'dark' },
  { name: 'optimizer', path: 'optimize', theme: 'dark' },
  { name: 'planner', path: 'simulate', theme: 'dark' },
  { name: 'asset', path: 'asset/NIFTY50', theme: 'dark' },
  { name: 'portfolio-light', path: 'portfolio', theme: 'light' },
];

const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  });
  await ctx.addInitScript((v) => localStorage.setItem('frontier-settings', v), settings(s.theme));
  const page = await ctx.newPage();
  await page.goto(new URL(s.path, base).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${s.name}.jpg`, type: 'jpeg', quality: 82 });
  console.log(`✓ ${s.name}`);
  await ctx.close();
}
// Advisor result (scripted flow)
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  });
  await ctx.addInitScript((v) => localStorage.setItem('frontier-settings', v), settings('dark'));
  const page = await ctx.newPage();
  await page.goto(new URL('start', base).href, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: /Retirement/ }).click();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Show my portfolio/ }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/advisor.jpg`, type: 'jpeg', quality: 82 });
  console.log('✓ advisor');
  await ctx.close();
}
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  });
  await ctx.addInitScript((v) => localStorage.setItem('frontier-settings', v), settings('dark'));
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/mobile.jpg`, type: 'jpeg', quality: 82 });
  console.log('✓ mobile');
  await ctx.close();
}
await browser.close();
