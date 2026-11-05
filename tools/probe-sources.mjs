/**
 * Source verification probe (diagnostics only): honestly identified, rate-
 * limited requests that confirm the exact AMFI scheme codes, file formats and
 * history spans the pipeline depends on.
 *   node tools/probe-sources.mjs
 */
import { inflateRawSync } from 'node:zlib';

const UA = 'FrontierPortfolioBot/1.0 (+https://github.com/Bhang-ux/frontier-portfolio)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, as = 'text') => {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : as === 'buf' ? Buffer.from(await res.arrayBuffer()) : res.text();
};

/** Minimal ZIP reader: first entry via the central directory. */
function unzipFirst(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const nameLen = buf.readUInt16LE(cd + 28);
  const name = buf.toString('latin1', cd + 46, cd + 46 + nameLen);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return { name, text: (method === 8 ? inflateRawSync(data) : data).toString('latin1') };
}

console.log('\n=== FRENCH ===');
for (const f of ['F-F_Research_Data_Factors_daily_CSV.zip', 'F-F_Momentum_Factor_daily_CSV.zip']) {
  try {
    const { name, text } = unzipFirst(
      await get(`https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/${f}`, 'buf'),
    );
    const lines = text.split(/\r?\n/);
    const data = lines.filter((l) => /^\s*\d{8}\s*,/.test(l));
    console.log(`${name}: ${lines.length} lines, ${data.length} rows, first=${data[0]} last=${data.at(-1)}`);
    console.log(
      lines
        .slice(0, 6)
        .map((l) => `  | ${l}`)
        .join('\n'),
    );
    console.log(
      lines
        .slice(-4)
        .map((l) => `  | ${l}`)
        .join('\n'),
    );
  } catch (e) {
    console.log(`${f}: ERROR ${e.message}`);
  }
}

console.log('\n=== AMFI NAVAll ===');
try {
  const t = await get('https://www.amfiindia.com/spages/NAVAll.txt');
  const lines = t.split(/\r?\n/);
  console.log(
    lines
      .slice(0, 8)
      .map((l) => `  | ${l}`)
      .join('\n'),
  );
  for (const code of ['120716', '148381', '149219', '120137', '119091']) {
    console.log(`  ${code}: ${lines.find((l) => l.startsWith(`${code};`))}`);
  }
  console.log(`  rows: ${lines.filter((l) => /^\d+;/.test(l)).length}`);
} catch (e) {
  console.log(`NAVAll ERROR ${e.message}`);
}

console.log('\n=== MFAPI /latest ===');
try {
  console.log((await get('https://api.mfapi.in/mf/120716/latest')).slice(0, 400));
} catch (e) {
  console.log(`latest ERROR ${e.message}`);
}

console.log('\n=== MFAPI targeted search ===');
const all = await get('https://api.mfapi.in/mf', 'json');
const show = (label, pred, n = 12) => {
  const hits = all
    .filter((s) => pred(s.schemeName))
    .sort((a, b) => a.schemeCode - b.schemeCode)
    .slice(0, n);
  console.log(`-- ${label}`);
  hits.forEach((s) => console.log(`   ${s.schemeCode} ${s.schemeName.slice(0, 100)}`));
};
show('motilal nasdaq', (n) => /motilal/i.test(n) && /nasdaq/i.test(n));
show(
  'regular liquid growth (big AMCs)',
  (n) =>
    /liquid/i.test(n) &&
    !/direct|idcw|dividend|bonus|daily|weekly|monthly|etf/i.test(n) &&
    /growth/i.test(n) &&
    /hdfc|sbi|icici|uti|nippon|reliance|kotak|axis|aditya|birla/i.test(n),
  16,
);
show(
  'gold savings / gold fof direct',
  (n) =>
    /\bgold\b/i.test(n) &&
    /direct/i.test(n) &&
    /growth/i.test(n) &&
    /hdfc|sbi|nippon|kotak|icici|axis|aditya/i.test(n),
  14,
);
show(
  'hdfc/sbi liquid direct',
  (n) => /liquid/i.test(n) && /direct/i.test(n) && /growth/i.test(n) && /^(hdfc|sbi|icici)/i.test(n),
  8,
);

console.log('\n=== MFAPI spans for chosen codes ===');
const CODES = [
  120716, 100822, 120684, 112957, 147622, 147623, 147625, 147620, 150468, 150930, 120587, 150643, 149790,
  152712, 152521, 153015, 148703, 148822, 148721, 149254, 141877, 148381, 149219, 118663, 119132, 105463,
  149760, 120137, 101002, 118987, 118814, 119091, 119800, 118364,
];
for (const code of CODES) {
  try {
    const j = await get(`https://api.mfapi.in/mf/${code}`, 'json');
    const d = j.data ?? [];
    // largest one-day jump (detects unit splits / bad prints)
    let worst = 0;
    let at = '';
    for (let i = 0; i + 1 < d.length; i++) {
      const r = Math.log(Number(d[i].nav) / Number(d[i + 1].nav));
      if (Math.abs(r) > Math.abs(worst)) {
        worst = r;
        at = d[i].date;
      }
    }
    console.log(
      `${code} ${d.at(-1)?.date}→${d[0]?.date} n=${d.length} nav=${d[0]?.nav} maxJump=${(Math.exp(worst) - 1).toFixed(3)}@${at} ${j.meta?.scheme_name?.slice(0, 70)}`,
    );
  } catch (e) {
    console.log(`${code} ERROR ${e.message}`);
  }
  await sleep(700);
}
