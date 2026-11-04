/**
 * Frontier data pipeline — a stateless, idempotent ETL run by GitHub Actions
 * on a schedule:
 *
 *   acquire ─► analyse ─► validate ─► publish (static JSON next to the app)
 *
 * Usage:
 *   tsx src/main.ts [--synthetic] [--out ../web/public/data] [--site-url URL]
 *                   [--concurrency 4] [--min-coverage 0.85] [--max-stale-days 6]
 */
import { mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_VERSION,
  contentHash,
  encodeHistory,
  type IntradayFile,
  type Manifest,
  type MarketSummary,
  type Snapshot,
} from '@frontier/contracts';
import { acquire } from './acquire';
import {
  analyzeAsset,
  buildSnapshotEntry,
  computeSignals,
  summarizeAsset,
  type AnalyzedAsset,
} from './build/assets';
import { breadthFor, headlineFor, moodFor, regimeFor } from './build/markets';
import { buildModels } from './build/models';
import { ALL_ASSETS } from './universe';
import { validateSnapshot } from './validate';

interface Args {
  synthetic: boolean;
  out: string;
  siteUrl?: string;
  concurrency: number;
  minCoverage: number;
  maxStaleDays: number;
  start: string;
}

function parseArgs(argv: string[]): Args {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    synthetic: argv.includes('--synthetic'),
    out: path.resolve(get('--out') ?? path.join(here, '..', '..', 'web', 'public', 'data')),
    siteUrl: get('--site-url') ?? process.env.SITE_URL,
    concurrency: Number(get('--concurrency') ?? 4),
    minCoverage: Number(get('--min-coverage') ?? 0.85),
    maxStaleDays: Number(get('--max-stale-days') ?? 6),
    start: get('--start') ?? '2005-01-01',
  };
}

const log = (msg: string) => console.log(msg);
const ghNotice = (kind: 'notice' | 'warning' | 'error', msg: string) => {
  if (process.env.GITHUB_ACTIONS)
    console.log(`::${kind} title=Frontier pipeline::${msg.replace(/\n/g, ' ')}`);
};

export async function run(args: Args): Promise<number> {
  const t0 = Date.now();
  const now = new Date();
  log(`▶ Frontier pipeline — ${args.synthetic ? 'SYNTHETIC (dev only)' : 'live'} — ${now.toISOString()}`);

  // 1. acquire
  const acq = await acquire({
    synthetic: args.synthetic,
    siteUrl: args.siteUrl,
    concurrency: args.concurrency,
    start: args.start,
    now,
    log,
  });
  log(
    `  acquired ${acq.universe.size} instruments · sources ${JSON.stringify(acq.sources)} · ${acq.failures.length} failures`,
  );
  const rf = { USD: acq.riskFree.USD.rate, INR: acq.riskFree.INR.rate };

  // 2. analyse
  const analyzed = new Map<string, AnalyzedAsset>();
  for (const a of acq.universe.values()) {
    try {
      analyzed.set(a.meta.id, analyzeAsset(a, acq.universe, rf));
    } catch (e) {
      acq.failures.push({ id: a.meta.id, reason: `analysis: ${(e as Error).message}` });
    }
  }
  const signals = computeSignals([...analyzed.values()]);

  // history files (content-hashed for cache busting)
  const histories: Manifest['histories'] = {};
  const historyText = new Map<string, string>();
  for (const a of analyzed.values()) {
    const s = a.asset.series;
    const text = JSON.stringify(encodeHistory(a.asset.meta.id, a.asset.meta.currency, s.dates, s.values));
    const hash = contentHash(text);
    historyText.set(a.asset.meta.id, text);
    histories[a.asset.meta.id] = {
      hash,
      end: new Date(s.dates.at(-1)! * 86_400_000).toISOString().slice(0, 10),
      points: s.dates.length,
    };
  }

  const order = new Map(ALL_ASSETS.map((m, i) => [m.id, i]));
  const assets = [...analyzed.values()]
    .sort((x, y) => (order.get(x.asset.meta.id) ?? 999) - (order.get(y.asset.meta.id) ?? 999))
    .map((a) =>
      buildSnapshotEntry(
        a,
        signals.get(a.asset.meta.id),
        summarizeAsset(a, signals.get(a.asset.meta.id), analyzed),
        histories[a.asset.meta.id].hash,
      ),
    );

  // markets
  const members = (region: 'US' | 'IN') =>
    [...analyzed.values()].filter(
      (a) =>
        a.asset.meta.region === region &&
        (a.asset.meta.kind === 'stock' || a.asset.meta.tags?.includes('sector')),
    );
  const markets: MarketSummary[] = [];
  for (const spec of [
    {
      key: 'US' as const,
      name: 'US',
      index: 'GSPC',
      vix: 'VIX',
      riskOn: 'SPY',
      safeHaven: 'TLT',
      junk: ['HYG', 'IEF'] as [string, string],
    },
    {
      key: 'IN' as const,
      name: 'Indian',
      index: 'NSEI',
      vix: 'INDIAVIX',
      riskOn: 'NIFTYBEES.NS',
      safeHaven: 'GOLDBEES.NS',
      junk: undefined,
    },
  ]) {
    const idx = acq.universe.get(spec.index);
    let regime = null;
    try {
      regime = idx
        ? regimeFor(idx.series, spec.key === 'US' ? 'The US market' : 'The Indian market', spec.index)
        : null;
    } catch (e) {
      log(`  ✗ regime ${spec.key}: ${(e as Error).message}`);
    }
    const mood = moodFor(
      {
        market: spec.key === 'US' ? 'US' : 'India',
        vix: spec.vix,
        index: spec.index,
        members: members(spec.key),
        riskOn: spec.riskOn,
        safeHaven: spec.safeHaven,
        junk: spec.junk,
      },
      acq.universe,
    );
    markets.push({
      key: spec.key,
      name: spec.key === 'US' ? 'United States' : 'India',
      benchmarkId: spec.index,
      regime,
      mood,
      breadth: breadthFor(members(spec.key)),
      headline: headlineFor(spec.name, analyzed.get(spec.index), regime, mood),
    });
  }

  // models
  const { models, skipped } = buildModels(acq.universe, rf);
  if (skipped.length) log(`  ⚠ model portfolios skipped: ${skipped.join(', ')}`);

  const movable = assets.filter(
    (a) => a.meta.investable && a.meta.kind !== 'cash' && a.stats.returns.d1 !== null,
  );
  const byMove = [...movable].sort((a, b) => b.stats.returns.d1! - a.stats.returns.d1!);
  const usdinr = acq.universe.get('USDINR');
  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    synthetic: args.synthetic,
    fx: {
      USDINR: {
        rate: usdinr?.quote.price ?? NaN,
        changePct: usdinr?.quote.changePct ?? 0,
        asOf: usdinr?.quote.asOf ?? now.toISOString(),
      },
    },
    riskFree: acq.riskFree,
    assets,
    markets,
    models,
    movers: {
      gainers: byMove.slice(0, 6).map((a) => a.meta.id),
      losers: byMove
        .slice(-6)
        .reverse()
        .map((a) => a.meta.id),
    },
  };

  // 3. validate
  const report = validateSnapshot(snapshot, {
    universeSize: ALL_ASSETS.length,
    minCoverage: args.minCoverage,
    maxStaleDays: args.maxStaleDays,
    now,
  });
  report.warnings.forEach((w) => log(`  ⚠ ${w}`));
  acq.failures.forEach((f) => ghNotice('warning', `${f.id}: ${f.reason}`));
  if (!report.ok) {
    report.errors.forEach((e) => {
      log(`  ✗ ${e}`);
      ghNotice('error', e);
    });
    log('✗ validation failed — nothing published (the live site keeps its last good data).');
    return 1;
  }

  // 4. publish
  await rm(args.out, { recursive: true, force: true });
  await mkdir(path.join(args.out, 'history'), { recursive: true });
  for (const [id, text] of historyText) await writeFile(path.join(args.out, 'history', `${id}.json`), text);
  const snapText = JSON.stringify(snapshot);
  await writeFile(path.join(args.out, 'snapshot.json'), snapText);
  let intraday: Manifest['intraday'] = null;
  if (Object.keys(acq.intraday).length) {
    const file: IntradayFile = { generatedAt: now.toISOString(), series: acq.intraday };
    const text = JSON.stringify(file);
    await writeFile(path.join(args.out, 'intraday.json'), text);
    intraday = { file: 'intraday.json', hash: contentHash(text) };
  }
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    synthetic: args.synthetic,
    snapshot: { file: 'snapshot.json', hash: contentHash(snapText), bytes: snapText.length },
    intraday,
    histories,
    pipeline: {
      durationMs: Date.now() - t0,
      sources: acq.sources,
      failures: acq.failures,
      runId: process.env.GITHUB_RUN_ID,
      commit: process.env.GITHUB_SHA?.slice(0, 7),
    },
    nextRefresh: process.env.NEXT_REFRESH,
  };
  await writeFile(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const kb = (snapText.length / 1024).toFixed(0);
  const summary = `published ${assets.length} instruments, ${models.length} model portfolios, snapshot ${kb} KiB in ${((Date.now() - t0) / 1000).toFixed(1)}s`;
  log(`✓ ${summary}`);
  ghNotice(
    'notice',
    `${summary}; sources ${JSON.stringify(acq.sources)}; failures ${acq.failures.map((f) => f.id).join(',') || 'none'}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = markets
      .map(
        (m) =>
          `| ${m.name} | ${m.regime ? `${m.regime.current} (${Math.round(m.regime.probability * 100)}%)` : '—'} | ${m.mood ? `${m.mood.score} ${m.mood.label}` : '—'} | ${m.headline} |`,
      )
      .join('\n');
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Frontier data refresh\n\n${summary}\n\n| Market | Regime | Mood | Headline |\n|---|---|---|---|\n${rows}\n\n**Sources:** ${JSON.stringify(acq.sources)}  \n**Failures:** ${acq.failures.map((f) => `\`${f.id}\` (${f.reason})`).join(', ') || 'none'}\n`,
    );
  }
  return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  run(parseArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      ghNotice('error', `pipeline crashed: ${(e as Error).message}`);
      process.exit(1);
    });
}
