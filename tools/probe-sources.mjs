/**
 * Source health probe: plain, honestly identified requests to every candidate
 * data source, reporting reachability from the current machine (e.g. a GitHub
 * runner). Used to choose sources that permit programmatic access.
 *   node tools/probe-sources.mjs
 */
const UA = 'FrontierPortfolioBot/1.0 (+https://github.com/Bhang-ux/frontier-portfolio)';
const targets = [
  ['binance daily BTC', 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=3'],
  ['frankfurter USD/INR', 'https://api.frankfurter.app/2026-10-01..2026-10-07?from=USD&to=INR'],
  ['mfapi UTI Nifty 50 idx', 'https://api.mfapi.in/mf/120716'],
  ['fred DTB3 csv', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3'],
  ['fred India 3M csv', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=IR3TIB01INM156N'],
  [
    'treasury bills csv',
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_bill_rates&field_tdr_date_value=2026&page&_format=csv',
  ],
  ['stooq SPY', 'https://stooq.com/q/d/l/?s=spy.us&i=d'],
  ['stooq ^SPX', 'https://stooq.com/q/d/l/?s=%5Espx&i=d'],
  ['stooq XAUUSD', 'https://stooq.com/q/d/l/?s=xauusd&i=d'],
  ['coingecko ping', 'https://api.coingecko.com/api/v3/ping'],
  ['yahoo chart (honest UA)', 'https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d'],
];

async function probe(name, url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    const first = text.replace(/\s+/g, ' ').slice(0, 110);
    return {
      name,
      status: res.status,
      ms,
      bytes: text.length,
      type: res.headers.get('content-type') ?? '',
      first,
    };
  } catch (e) {
    return {
      name,
      status: 'ERR',
      ms: Math.round(performance.now() - t0),
      bytes: 0,
      type: '',
      first: String(e?.cause?.code ?? e?.name ?? e).slice(0, 110),
    };
  }
}

const rows = [];
for (const [n, u] of targets) rows.push(await probe(n, u));
console.log('\n=== SOURCE PROBE ===');
for (const r of rows)
  console.log(
    `${String(r.status).padEnd(4)} ${String(r.ms).padStart(6)}ms ${String(r.bytes).padStart(9)}B  ${r.name.padEnd(26)} ${r.type.slice(0, 28).padEnd(28)} | ${r.first}`,
  );

// Official AMFI scheme codes for Indian index funds (mfapi.in search over AMFI data).
console.log('\n=== MFAPI SCHEME SEARCH ===');
for (const q of [
  'UTI Nifty 50 Index Fund Direct',
  'Nifty Next 50 Index Fund Direct',
  'Nasdaq 100 Fund of Fund Direct',
  'Gold Fund Direct Growth',
  'Gilt Fund Direct Growth',
  'Liquid Fund Direct Growth',
  'Nifty Bank Index Fund Direct',
  'Nifty Midcap 150 Index Fund Direct',
  'S&P 500 Index Fund Direct',
  'Silver ETF Fund of Fund Direct',
]) {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20_000),
    });
    const list = await res.json();
    const pick = list
      .filter(
        (s) =>
          /direct/i.test(s.schemeName) &&
          /growth/i.test(s.schemeName) &&
          !/idcw|dividend|bonus/i.test(s.schemeName),
      )
      .slice(0, 6);
    console.log(`-- ${q}: ${list.length} results`);
    for (const s of pick) console.log(`   ${s.schemeCode}  ${s.schemeName}`);
  } catch (e) {
    console.log(`-- ${q}: ERR ${e?.name}`);
  }
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Source probe\n\n| Source | Status | ms | Bytes |\n|---|---|---|---|\n${rows.map((r) => `| ${r.name} | ${r.status} | ${r.ms} | ${r.bytes} |`).join('\n')}\n`,
  );
}
