/** Render PWA / Apple touch icons from the SVG logo (run once: node scripts/icons.mjs). */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['pwa-512.png', 512, 0.12],
  ['pwa-192.png', 192, 0.12],
  ['apple-touch-icon.png', 180, 0.1],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#070a12;display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${size * (1 - 2 * pad)}px;height:${size * (1 - 2 * pad)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({
    path: new URL(`../public/${name}`, import.meta.url).pathname,
    omitBackground: false,
  });
}
await browser.close();
console.log('icons written');
