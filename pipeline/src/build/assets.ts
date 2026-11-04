/**
 * Per-asset analytics: trailing returns, risk statistics, technical signals
 * and a generated plain-English summary.
 */
import type { AssetSnapshot, AssetStats, Currency, Signals } from '@frontier/contracts';
import {
  alignSeries,
  compositeSignal,
  computeMetrics,
  covariance,
  explain,
  lowerBound,
  percentileRank,
  periodsPerYearFromDates,
  resampleAligned,
  returnsMatrix,
  simpleReturns,
  sliceSeries,
  startOfYear,
  technicals,
  valueAsOf,
  variance,
  yearOf,
  type Series,
  type Technicals,
} from '@frontier/quant';
import type { LoadedAsset, Universe } from './types';

const DAY = 1;
const YEAR = 365.25 * DAY;

export interface AnalyzedAsset {
  asset: LoadedAsset;
  stats: AssetStats;
  tech: Technicals | null;
  ppy: number;
}

function trailing(series: Series, anchor: number, days: number, annualise = false): number | null {
  const start = anchor - days;
  if (series.dates[0] > start + 5) return null; // not enough history
  const p0 = valueAsOf(series, start);
  const p1 = series.values[series.values.length - 1];
  if (!Number.isFinite(p0) || p0 <= 0) return null;
  const r = p1 / p0 - 1;
  return annualise ? Math.pow(1 + r, YEAR / days) - 1 : r;
}

function windowReturns(series: Series, anchor: number, days: number): number[] {
  return simpleReturns(sliceSeries(series, anchor - days).values);
}

const safe = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : x);

export function analyzeAsset(a: LoadedAsset, universe: Universe, riskFree: Record<Currency, number>): AnalyzedAsset {
  const s = a.series;
  const n = s.dates.length;
  const anchor = s.dates[n - 1];
  const ppy = periodsPerYearFromDates(s.dates.slice(Math.max(0, lowerBound(s.dates, anchor - 3 * YEAR))));
  const rf = riskFree[a.meta.currency] ?? 0;
  const isLevel = a.meta.kind === 'rate' || a.meta.assetClass === 'volatility';

  const r1y = windowReturns(s, anchor, YEAR);
  const r3y = windowReturns(s, anchor, 3 * YEAR);
  const m1 = r1y.length > 120 ? computeMetrics(r1y, { periodsPerYear: ppy, riskFree: rf }) : null;
  const m3 = r3y.length > 400 ? computeMetrics(r3y, { periodsPerYear: ppy, riskFree: rf }) : null;
  const r5y = windowReturns(s, anchor, 5 * YEAR);
  const m5 = r5y.length > 700 ? computeMetrics(r5y, { periodsPerYear: ppy, riskFree: rf }) : null;
  const all = computeMetrics(simpleReturns(s.values), { periodsPerYear: ppy, riskFree: rf });

  // Beta / correlation vs benchmark on weekly returns (robust to time-zone asynchrony).
  let beta: number | null = null;
  let correlation: number | null = null;
  const bench = a.meta.benchmark ? universe.get(a.meta.benchmark) : undefined;
  if (bench && bench.meta.id !== a.meta.id && !isLevel) {
    const al = alignSeries([sliceSeries(s, anchor - 3 * YEAR), sliceSeries(bench.series, anchor - 3 * YEAR)]);
    const wk = returnsMatrix(resampleAligned(al, 'W').values);
    if (wk.length > 52) {
      const x = wk.map((r) => r[0]);
      const b = wk.map((r) => r[1]);
      const vb = variance(b);
      const cov = covariance(x, b);
      beta = vb > 0 ? cov / vb : null;
      const vx = variance(x);
      correlation = vx > 0 && vb > 0 ? cov / Math.sqrt(vx * vb) : null;
    }
  } else if (bench && bench.meta.id === a.meta.id) {
    beta = 1;
    correlation = 1;
  }

  // 52-week range on display prices.
  const i52 = lowerBound(s.dates, anchor - YEAR);
  const window52 = a.close.slice(i52);
  const high52 = window52.length ? Math.max(...window52, a.quote.price) : null;
  const low52 = window52.length ? Math.min(...window52, a.quote.price) : null;
  const maxAll = Math.max(...s.values);

  const ytdBase = valueAsOf(s, startOfYear(yearOf(anchor)) - 1);
  const stats: AssetStats = {
    returns: {
      d1: safe(a.quote.changePct),
      w1: safe(trailing(s, anchor, 7)),
      m1: safe(trailing(s, anchor, 30.44)),
      m3: safe(trailing(s, anchor, 91.31)),
      m6: safe(trailing(s, anchor, 182.6)),
      ytd: Number.isFinite(ytdBase) && s.dates[0] < startOfYear(yearOf(anchor)) ? s.values[n - 1] / ytdBase - 1 : null,
      y1: safe(trailing(s, anchor, YEAR)),
      y3: safe(trailing(s, anchor, 3 * YEAR, true)),
      y5: safe(trailing(s, anchor, 5 * YEAR, true)),
      y10: safe(trailing(s, anchor, 10 * YEAR, true)),
    },
    vol1y: isLevel ? null : safe(m1?.volatility),
    vol3y: isLevel ? null : safe(m3?.volatility),
    sharpe1y: isLevel ? null : safe(m1?.sharpe),
    sharpe3y: isLevel ? null : safe(m3?.sharpe),
    sortino3y: isLevel ? null : safe(m3?.sortino),
    maxDrawdown5y: isLevel ? null : safe(m5?.maxDrawdown ?? all.maxDrawdown),
    maxDrawdownAll: isLevel ? null : safe(all.maxDrawdown),
    currentDrawdown: isLevel ? null : safe(1 - s.values[n - 1] / maxAll),
    beta: safe(beta),
    correlation: safe(correlation),
    var95: isLevel ? null : safe(m3?.varHistorical ?? m1?.varHistorical),
    cvar95: isLevel ? null : safe(m3?.cvarHistorical ?? m1?.cvarHistorical),
    high52: safe(high52),
    low52: safe(low52),
    fromHigh52: high52 ? safe(a.quote.price / high52 - 1) : null,
  };
  const tech = isLevel || a.meta.kind === 'cash' ? null : technicals(s.values.slice(-600), ppy);
  return { asset: a, stats, tech, ppy };
}

/** Peer group for cross-sectional ranks: e.g. US stocks vs US stocks, ETFs by asset class. */
const peerKey = (a: AnalyzedAsset) =>
  `${a.asset.meta.assetClass}:${a.asset.meta.kind === 'stock' ? `stock-${a.asset.meta.region}` : 'fund'}`;

export function computeSignals(analyzed: AnalyzedAsset[]): Map<string, Signals> {
  const groups = new Map<string, AnalyzedAsset[]>();
  for (const a of analyzed) {
    if (!a.tech || !a.asset.meta.investable) continue;
    const k = peerKey(a);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out = new Map<string, Signals>();
  for (const members of groups.values()) {
    const moms = members.map((m) => m.tech!.momentum12_1).filter((x): x is number => x !== null);
    const sharpes = members.map((m) => m.stats.sharpe1y).filter((x): x is number => x !== null);
    for (const m of members) {
      const t = m.tech!;
      const sig = compositeSignal(t, {
        momentum: t.momentum12_1 !== null && moms.length >= 3 ? percentileRank(moms, t.momentum12_1) : null,
        sharpe: m.stats.sharpe1y !== null && sharpes.length >= 3 ? percentileRank(sharpes, m.stats.sharpe1y) : null,
      });
      out.set(m.asset.meta.id, {
        score: sig.score,
        label: sig.label,
        trend: t.trend,
        rsi14: Number.isFinite(t.rsi14) ? t.rsi14 : null,
        sma50: Number.isFinite(t.sma50) ? t.sma50 : null,
        sma200: Number.isFinite(t.sma200) ? t.sma200 : null,
        momentum12_1: t.momentum12_1,
        volRatio: Number.isFinite(t.volRatio) ? t.volRatio : null,
        components: sig.components,
        reasons: sig.reasons,
      });
    }
  }
  return out;
}

const { pct, number } = explain;

export function summarizeAsset(a: AnalyzedAsset, signals: Signals | undefined, universe: Map<string, AnalyzedAsset>): string {
  const m = a.asset.meta;
  const st = a.stats;
  const parts: string[] = [];
  if (m.kind === 'cash') {
    const y = a.stats.returns.y1;
    return `${m.name}: ${m.description}${y !== null ? ` It earned ${pct(y)} over the past year` : ''}, with virtually no day-to-day price swings.`;
  }
  if (m.kind === 'rate') {
    return `${m.name} is ${number(a.asset.quote.price, 2)}%. ${m.description}`;
  }
  if (m.assetClass === 'volatility') {
    const lvl = a.asset.quote.price;
    const mood = lvl < 15 ? 'calm — investors expect small moves' : lvl < 22 ? 'normal' : lvl < 30 ? 'elevated — investors are nervous' : 'very high — markets are in stress';
    return `${m.short} is at ${number(lvl, 1)}, which is ${mood}. ${m.description}`;
  }
  const bench = m.benchmark && m.benchmark !== m.id ? universe.get(m.benchmark) : undefined;
  const horizon = st.returns.y5 !== null ? { r: st.returns.y5, label: '5 years', br: bench?.stats.returns.y5 } : st.returns.y3 !== null ? { r: st.returns.y3, label: '3 years', br: bench?.stats.returns.y3 } : st.returns.y1 !== null ? { r: st.returns.y1, label: 'the past year', br: bench?.stats.returns.y1 } : null;
  if (horizon) {
    const per = horizon.label === 'the past year' ? 'over the past year' : `a year over the past ${horizon.label}`;
    const vs = horizon.br !== undefined && horizon.br !== null ? ` (${bench!.asset.meta.short}: ${pct(horizon.br)})` : '';
    parts.push(`${m.short} has returned ${pct(horizon.r)} ${per}${vs}.`);
  }
  if (st.vol1y !== null) {
    const lvl = explain.explainVolatility(st.vol1y).level;
    const word = { 'very-low': 'very low', low: 'low', moderate: 'moderate', high: 'high', 'very-high': 'very high' }[lvl!];
    parts.push(`Its volatility is ${word} (${pct(st.vol1y, 0)} a year).`);
  }
  if (signals) {
    const trend = signals.trend === 'up' ? 'is in an uptrend' : signals.trend === 'down' ? 'is in a downtrend' : 'is moving sideways';
    const fromHigh = st.fromHigh52 !== null ? (st.fromHigh52 > -0.02 ? ' and is trading near its 52-week high' : ` and trades ${pct(-st.fromHigh52, 0)} below its 52-week high`) : '';
    parts.push(`Right now it ${trend}${fromHigh}.`);
  }
  if (st.maxDrawdownAll !== null && st.maxDrawdownAll > 0.15) parts.push(`At its worst it fell ${pct(st.maxDrawdownAll, 0)} from a peak — a reminder of what holding it can feel like.`);
  return parts.join(' ');
}

export function buildSnapshotEntry(a: AnalyzedAsset, signals: Signals | undefined, summary: string, hash: string): AssetSnapshot {
  const s = a.asset.series;
  const spark = a.asset.close.slice(-90).map((v) => Number(v.toPrecision(5)));
  return {
    meta: a.asset.meta,
    quote: a.asset.quote,
    stats: a.stats,
    signals: signals ?? null,
    spark,
    summary,
    history: {
      start: new Date(s.dates[0] * 86_400_000).toISOString().slice(0, 10),
      end: new Date(s.dates[s.dates.length - 1] * 86_400_000).toISOString().slice(0, 10),
      points: s.dates.length,
      hash,
    },
    source: a.asset.source,
  };
}
