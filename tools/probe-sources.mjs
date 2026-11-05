/**
 * Source discovery probe (diagnostics only): honestly identified requests to
 * the data sources Frontier is allowed to use, printing coverage facts that
 * drive universe curation — FRED series spans and copyright tags, Binance
 * listing dates, ECB INR coverage, and AMFI scheme codes with NAV history
 * spans (oldest schemes first; AMFI codes are assigned sequentially).
 *   node tools/probe-sources.mjs
 */
const UA = 'FrontierPortfolioBot/1.0 (+https://github.com/Bhang-ux/frontier-portfolio)';
const get = async (url, as = 'text') => {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
};
const pool = async (items, n, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]).catch((e) => ({ error: String(e.message ?? e) }));
      }
    }),
  );
  return out;
};

// ── FRED ────────────────────────────────────────────────────────────────────
console.log('\n=== FRED SERIES ===');
const FRED = [
  'SP500', 'DJIA', 'NASDAQCOM', 'NASDAQ100', 'VIXCLS', 'DGS2', 'DGS5', 'DGS10', 'DGS30', 'DTB3',
  'DEXINUS', 'DTWEXBGS', 'DCOILBRENTEU', 'BAMLH0A0HYM2', 'NIKKEI225', 'DFII10', 'T10Y2Y',
];
for (const id of FRED) {
  try {
    const csv = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
    const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
    const ok = rows.filter((r) => r[1] && r[1] !== '.' && Number.isFinite(Number(r[1])));
    console.log(`${id.padEnd(13)} ${ok[0]?.[0]} → ${ok.at(-1)?.[0]}  n=${ok.length}  last=${ok.at(-1)?.[1]}  hdr=${csv.slice(0, 30).replace(/\s+/g, ' ')}`);
  } catch (e) {
    console.log(`${id.padEnd(13)} ERROR ${e.message}`);
  }
}
console.log('\n=== FRED COPYRIGHT NOTES ===');
for (const id of ['SP500', 'DJIA', 'NASDAQCOM', 'NASDAQ100', 'VIXCLS', 'DTWEXBGS', 'DCOILBRENTEU', 'DEXINUS', 'DGS10']) {
  try {
    const html = await get(`https://fred.stlouisfed.org/series/${id}`);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
    const tags = [...new Set(text.match(/(Copyrighted: [A-Za-z -]+?(?=\s{1}[A-Z][a-z]|$)|Public Domain[^.]{0,40})/g) ?? [])].slice(0, 3);
    const copy = (text.match(/Copyright[^.]{0,220}\.[^.]{0,200}/) ?? [''])[0];
    console.log(`${id.padEnd(13)} tags=${JSON.stringify(tags)}\n              ${copy.slice(0, 420)}`);
  } catch (e) {
    console.log(`${id.padEnd(13)} ERROR ${e.message}`);
  }
}

// ── Binance ─────────────────────────────────────────────────────────────────
console.log('\n=== BINANCE ===');
for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'PAXGUSDT']) {
  try {
    const first = await get(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=1d&startTime=0&limit=1`, 'json');
    const last = await get(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=1d&limit=1`, 'json');
    console.log(`${s.padEnd(9)} first=${new Date(first[0][0]).toISOString().slice(0, 10)} lastClose=${last[0][4]}`);
  } catch (e) {
    console.log(`${s.padEnd(9)} ERROR ${e.message}`);
  }
}

// ── ECB via Frankfurter ─────────────────────────────────────────────────────
console.log('\n=== FRANKFURTER (ECB) ===');
for (const range of ['1999-01-01..2001-12-31', '2008-01-01..2009-12-31']) {
  try {
    const j = await get(`https://api.frankfurter.app/${range}?from=USD&to=INR`, 'json');
    const ds = Object.keys(j.rates ?? {});
    console.log(`${range}: n=${ds.length} first=${ds[0]} last=${ds.at(-1)} sample=${JSON.stringify(j.rates?.[ds[0]])}`);
  } catch (e) {
    console.log(`${range}: ERROR ${e.message}`);
  }
}

// ── Other reachability ──────────────────────────────────────────────────────
console.log('\n=== OTHER ===');
for (const [n, u] of [
  ['amfi NAVAll', 'https://www.amfiindia.com/spages/NAVAll.txt'],
  ['amfi portal NAVAll', 'https://portal.amfiindia.com/spages/NAVAll.txt'],
  ['french daily factors', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip'],
]) {
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    const buf = await res.arrayBuffer();
    console.log(`${n.padEnd(22)} ${res.status} ${buf.byteLength}B`);
  } catch (e) {
    console.log(`${n.padEnd(22)} ERROR ${e.message}`);
  }
}

// ── AMFI scheme discovery via mfapi.in ──────────────────────────────────────
console.log('\n=== AMFI SCHEMES (oldest first; fetched = history span) ===');
const all = await get('https://api.mfapi.in/mf', 'json');
console.log(`schemes listed: ${all.length}`);
const growth = (n) => /growth|cumulative/i.test(n) && !/idcw|dividend|bonus|payout|reinvest|weekly|daily|monthly|quarterly|annual|fortnightly/i.test(n);
const direct = (n) => /direct/i.test(n);
const G = (re, not, opts = {}) => ({ re, not, ...opts });
const GROUPS = {
  nifty50: G(/nifty\s*-?\s*50\b/i, /next|value|equal|momentum|quality|alpha|low\s*vol|arbitrage|shariah|v20|etf$/i, { regular: true }),
  sensex: G(/sensex/i, /next/i, { regular: true }),
  next50: G(/next\s*(nifty\s*)?50/i, /etf$/i, { regular: true }),
  nifty100: G(/nifty\s*100\b/i, /low|quality|alpha|equal|esg|momentum/i),
  midcap150: G(/midcap\s*150/i, /quality|momentum/i),
  smallcap250: G(/smallcap\s*250/i, /quality|momentum/i),
  nifty500: G(/nifty\s*500\b/i, /value|momentum|quality|multicap|equal|shariah/i),
  bank: G(/nifty\s*bank\b|bank\s*index/i, /psu|private|banking\s*(&|and)\s*psu/i),
  psubank: G(/psu\s*bank/i, /banking\s*(&|and)\s*psu/i),
  financial: G(/financial\s*services/i, /ex-?\s*bank/i),
  it: G(/nifty\s*it\b|\bit\s*index|digital\s*index|it\s*etf/i, null),
  pharma: G(/pharma|healthcare/i, /fund$/i, { must: /index|etf/i }),
  fmcg: G(/fmcg/i, null),
  auto: G(/\bauto\b/i, null, { must: /index|etf/i }),
  infra: G(/infra/i, null, { must: /index|etf/i }),
  energy: G(/energy|oil\s*&\s*gas/i, null, { must: /index|etf/i }),
  consumption: G(/consumption/i, null, { must: /index|etf/i }),
  manufacturing: G(/manufactur/i, null, { must: /index|etf/i }),
  defence: G(/defen[cs]e/i, null, { must: /index|etf/i }),
  metal: G(/metal/i, null, { must: /index|etf/i }),
  realty: G(/realty|real\s*estate/i, null, { must: /index|etf|fof/i }),
  momentum: G(/momentum/i, null, { must: /index|etf/i }),
  lowvol: G(/low\s*vol/i, null),
  value: G(/value\s*(20|50)|nifty\s*50\s*value/i, null),
  quality: G(/quality\s*(30|50)/i, null),
  alpha: G(/alpha\s*(50|low)/i, null),
  equalweight: G(/equal\s*weight/i, null),
  sp500: G(/s\s*&\s*p\s*500|s&p500/i, null),
  nasdaq: G(/nasdaq/i, null),
  us: G(/u\.?s\.?\s*(opportunities|equity|bluechip|total|growth|specific)|fang/i, null),
  global: G(/global|world|international|developed|hang\s*seng|europe|japan|taiwan|china/i, /gold|mining|agri/i, { must: /fof|fund\s*of\s*fund|feeder|index|etf|offshore/i }),
  gold: G(/gold/i, /world|mining|silver|precious|multi/i, { regular: true }),
  silver: G(/silver/i, /gold|multi/i),
  gilt: G(/gilt|government\s*securities|g-?sec/i, /index|sdl|target|crisil|20[23]\d|constant|10\s*y/i, { regular: true }),
  gilt10y: G(/constant\s*(maturity|duration)|10\s*y(ea)?r?\s*gilt/i, null, { regular: true }),
  liquid: G(/liquid/i, /overnight|etf|bees/i, { regular: true }),
  overnight: G(/overnight/i, null),
  corpbond: G(/corporate\s*bond/i, /index|sdl|target|crisil|20[23]\d/i, { regular: true }),
  bankingpsu: G(/banking\s*(&|and)\s*psu/i, /index|sdl|target|crisil|20[23]\d/i),
  shortdur: G(/short\s*(term|duration)/i, null),
  dynamicbond: G(/dynamic\s*bond/i, null),
  bharatbond: G(/bharat\s*bond/i, null),
  moneymarket: G(/money\s*market/i, null),
};
const span = async (code) => {
  const j = await get(`https://api.mfapi.in/mf/${code}`, 'json');
  const d = j.data ?? [];
  const nav0 = Number(d[0]?.nav);
  const yearAgo = d.find((x, i) => i > 240);
  return {
    first: d.at(-1)?.date,
    last: d[0]?.date,
    n: d.length,
    nav: d[0]?.nav,
    y1: yearAgo ? `${((nav0 / Number(yearAgo.nav) - 1) * 100).toFixed(1)}%` : '—',
    cat: (j.meta?.scheme_category ?? '').replace(/^(Other Scheme|Equity Scheme|Debt Scheme|Hybrid Scheme) - /, '').slice(0, 26),
  };
};
for (const [key, g] of Object.entries(GROUPS)) {
  const match = (s) => g.re.test(s.schemeName) && (!g.not || !g.not.test(s.schemeName)) && (!g.must || g.must.test(s.schemeName)) && growth(s.schemeName);
  const dirs = all.filter((s) => match(s) && direct(s.schemeName)).sort((a, b) => a.schemeCode - b.schemeCode);
  const regs = g.regular ? all.filter((s) => match(s) && !direct(s.schemeName)).sort((a, b) => a.schemeCode - b.schemeCode) : [];
  const fetchList = [...dirs.slice(0, 4), ...regs.slice(0, 2)];
  const spans = await pool(fetchList, 3, (s) => span(s.schemeCode));
  console.log(`\n-- ${key}: ${dirs.length} direct-growth${g.regular ? `, ${regs.length} regular` : ''}`);
  fetchList.forEach((s, i) => {
    const sp = spans[i];
    const tag = direct(s.schemeName) ? 'D' : 'R';
    console.log(
      sp.error
        ? `  ${tag} ${s.schemeCode} ERROR ${sp.error} ${s.schemeName.slice(0, 70)}`
        : `  ${tag} ${s.schemeCode} ${sp.first}→${sp.last} n=${sp.n} nav=${sp.nav} 1y=${sp.y1} [${sp.cat}] ${s.schemeName.slice(0, 78)}`,
    );
  });
  const rest = dirs.slice(4, 12).map((s) => `${s.schemeCode}:${s.schemeName.replace(/\s*-?\s*direct.*$/i, '').slice(0, 38)}`);
  if (rest.length) console.log(`  more: ${rest.join(' | ')}`);
}
