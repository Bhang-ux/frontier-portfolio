/**
 * GitHub Pages has no SPA rewrite rules. To make every deep link return a
 * real 200 (good for sharing, crawlers and link previews) we copy index.html
 * into a folder per client route — including one per asset page — and use it
 * as 404.html for anything else.
 */
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const index = new URL('index.html', dist);
const routes = ['start', 'portfolio', 'optimize', 'simulate', 'backtest', 'markets', 'learn'];

async function exists(u) {
  try {
    await access(u);
    return true;
  } catch {
    return false;
  }
}

for (const r of routes) {
  await mkdir(new URL(`${r}/`, dist), { recursive: true });
  await copyFile(index, new URL(`${r}/index.html`, dist));
}

let assets = 0;
const snap = new URL('data/snapshot.json', dist);
if (await exists(snap)) {
  const { assets: list } = JSON.parse(await readFile(snap, 'utf8'));
  for (const a of list) {
    const dir = new URL(`asset/${encodeURIComponent(a.meta.id)}/`, dist);
    await mkdir(dir, { recursive: true });
    await copyFile(index, new URL('index.html', dir));
    assets++;
  }
}
await copyFile(index, new URL('404.html', dist));
await writeFile(new URL('.nojekyll', dist), '');
console.log(`postbuild: ${routes.length} routes + ${assets} asset pages + 404.html`);
