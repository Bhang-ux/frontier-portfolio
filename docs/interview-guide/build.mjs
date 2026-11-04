/**
 * Builds docs/Interview_Guide.pdf from content.mjs.
 *
 *   node docs/interview-guide/build.mjs [--out <pdf>] [--copy <pdf>]
 *
 * HTML + print CSS → headless Chromium (Playwright) → PDF. Diagrams are
 * inline SVG, fonts are the same Inter files the app ships, and the build
 * stamps live repository statistics (lines of code, tests) into the text.
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGuide } from './content.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const outPdf = path.resolve(arg('--out', path.join(root, 'docs', 'Interview_Guide.pdf')));
const copyTo = arg('--copy');

function stats() {
  const count = (dirs, exts) => {
    try {
      const files = execSync(`git ls-files ${dirs.join(' ')}`, { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((f) => exts.some((e) => f.endsWith(e)) && !f.includes('fixtures'));
      let n = 0;
      for (const f of files) {
        try {
          n += execSync(`grep -cv '^\\s*$' "${f}"`, { cwd: root, encoding: 'utf8' }).trim() * 1;
        } catch {
          /* empty file */
        }
      }
      return n;
    } catch {
      return 0;
    }
  };
  const commit = (() => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      return 'working tree';
    }
  })();
  return {
    quant: count(['packages/quant/src'], ['.ts']),
    pipeline: count(['pipeline/src', 'packages/contracts/src'], ['.ts']),
    web: count(['web/src'], ['.ts', '.tsx', '.css']),
    tests: count(['packages/quant/test', 'pipeline/test', 'web/src', 'e2e'], ['.test.ts', '.spec.ts']),
    total: count(
      ['packages', 'pipeline', 'web/src', 'e2e', 'tools', '.github', 'web/scripts'],
      ['.ts', '.tsx', '.mjs', '.css', '.py', '.yml'],
    ),
    commit,
    date: new Date().toISOString().slice(0, 10),
  };
}

const s = stats();
const css = await readFile(path.join(here, 'styles.css'), 'utf8');
const html = renderGuide({ css, stats: s });
const outDir = path.join(here, 'out');
await mkdir(outDir, { recursive: true });
const htmlPath = path.join(outDir, 'guide.html');
// styles reference fonts relative to docs/interview-guide/out/ → ../../node_modules
await writeFile(htmlPath, html.replaceAll('../../node_modules/', '../../../node_modules/'));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
await page.evaluate('document.fonts.ready'); // runs in the browser context
await mkdir(path.dirname(outPdf), { recursive: true });
await page.pdf({
  path: outPdf,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:Inter,sans-serif;font-size:7.5pt;color:#6a7285;padding:0 16mm;display:flex;justify-content:space-between"><span>Frontier — Interview Guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  outline: true,
  tagged: true,
});
await browser.close();
if (copyTo) await copyFile(outPdf, path.resolve(copyTo));
console.log(
  `✓ ${path.relative(root, outPdf)}${copyTo ? ` (copied to ${copyTo})` : ''} · ${s.total.toLocaleString()} lines · commit ${s.commit}`,
);
