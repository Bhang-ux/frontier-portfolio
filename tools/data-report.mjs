/**
 * Print a coverage report for a published data directory:
 *   node tools/data-report.mjs web/public/data
 * One row per instrument (source, span, last value, 1-year return and
 * volatility), then market regimes/moods, model portfolios and risk-free rates.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2] ?? 'web/public/data';
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const snap = JSON.parse(await readFile(path.join(dir, 'snapshot.json'), 'utf8'));
const pct = (x, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`);
const pad = (s, n) => String(s).slice(0, n).padEnd(n);

console.log(`generated ${snap.generatedAt} · synthetic=${snap.synthetic} · ${snap.assets.length} assets`);
console.log(
  `sources ${JSON.stringify(manifest.pipeline.sources)} · failures ${JSON.stringify(manifest.pipeline.failures)}`,
);
console.log(
  `USDINR ${snap.fx.USDINR.rate} · rf USD ${pct(snap.riskFree.USD.rate, 2)} (${snap.riskFree.USD.source}) · rf INR ${pct(snap.riskFree.INR.rate, 2)} (${snap.riskFree.INR.source})\n`,
);
console.log(
  `${pad('id', 15)}${pad('source', 16)}${pad('start', 11)}${pad('end', 11)}${pad('points', 7)}${pad('last', 12)}${pad('d1', 8)}${pad('1y', 8)}${pad('vol1y', 7)}score`,
);
for (const a of snap.assets) {
  console.log(
    `${pad(a.meta.id, 15)}${pad(a.source, 16)}${pad(a.history.start, 11)}${pad(a.history.end, 11)}${pad(a.history.points, 7)}${pad(Number(a.quote.price.toPrecision(7)), 12)}${pad(pct(a.stats.returns.d1), 8)}${pad(pct(a.stats.returns.y1), 8)}${pad(pct(a.stats.vol1y, 0), 7)}${a.signals?.score ?? '—'}`,
  );
}
console.log('\nmarkets:');
for (const m of snap.markets)
  console.log(
    `  ${m.key}: regime ${m.regime ? `${m.regime.current} ${pct(m.regime.probability, 0)}` : '—'} · mood ${m.mood ? `${m.mood.score} ${m.mood.label} [${m.mood.components.map((c) => `${c.key}=${c.score}`).join(', ')}]` : '—'}\n     ${m.headline}`,
  );
console.log('\nmodels:');
for (const m of snap.models)
  console.log(
    `  ${pad(m.id, 5)} ${pad(m.profileName, 13)} ${m.backtest.start}→${m.backtest.end} CAGR ${pct(m.backtest.cagr)} vol ${pct(m.backtest.volatility)} maxDD ${pct(m.backtest.maxDrawdown, 0)} | ${m.holdings.map((h) => `${h.id} ${Math.round(h.weight * 100)}%`).join(', ')}`,
  );
