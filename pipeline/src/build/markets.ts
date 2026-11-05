/**
 * Market-level analytics: HMM regimes, a composite "Market Mood" gauge,
 * breadth and a one-line headline per market.
 *
 * Market Mood is Frontier's own transparent composite (in the spirit of
 * well-known fear/greed gauges): each component is the percentile of today's
 * reading versus its own recent history, so every number is explainable.
 */
import type { MarketSummary, MoodComponent, MoodInfo, RegimeInfo } from '@frontier/contracts';
import {
  expectedDurations,
  explain,
  fitGaussianHmm,
  fromEpochDay,
  lowerBound,
  percentileRank,
  sma,
  type Series,
} from '@frontier/quant';
import type { AnalyzedAsset } from './assets';
import type { Universe } from './types';

const YEAR = 365.25;

export function regimeFor(series: Series, label: string, benchmarkId: string): RegimeInfo | null {
  const start = lowerBound(series.dates, series.dates[series.dates.length - 1] - 10 * YEAR);
  const dates = series.dates.slice(start);
  const px = series.values.slice(start);
  if (px.length < 300) return null;
  const x = px.slice(1).map((p, i) => 100 * Math.log(p / px[i]));
  const fit = fitGaussianHmm(x, 2, { restarts: 4, seed: 7 });
  const ppy = (dates.length - 1) / ((dates[dates.length - 1] - dates[0]) / YEAR);
  const last = fit.filtered[fit.filtered.length - 1];
  const current = last[1] > last[0] ? 1 : 0;
  let k = fit.viterbi.length - 1;
  while (k > 0 && fit.viterbi[k - 1] === fit.viterbi[fit.viterbi.length - 1]) k--;
  const durations = expectedDurations(fit.params.A);
  const histStart = Math.max(0, fit.filtered.length - Math.round(5 * ppy));
  const hDates: string[] = [];
  const hProb: number[] = [];
  for (let i = histStart; i < fit.filtered.length; i += 5) {
    hDates.push(fromEpochDay(dates[i + 1]));
    hProb.push(Number(fit.filtered[i][1].toFixed(3)));
  }
  const states = fit.params.means.map((m, i) => ({
    label: (i === 0 ? 'calm' : 'turbulent') as 'calm' | 'turbulent',
    meanAnnual: (m / 100) * ppy,
    volAnnual: (Math.sqrt(fit.params.variances[i]) / 100) * Math.sqrt(ppy),
    expectedDurationDays: durations[i],
  }));
  const cur = current === 0 ? 'calm' : 'turbulent';
  return {
    market: label,
    benchmarkId,
    current: cur,
    probability: last[current],
    since: fromEpochDay(dates[k + 1]),
    states,
    history: { dates: hDates, turbulent: hProb },
    text: explain.explainRegime(cur, last[current], label),
  };
}

/** Percentile of the latest value versus the trailing `lookback` observations. */
function latestPercentile(values: number[], lookback: number): number | null {
  const w = values.filter(Number.isFinite).slice(-lookback);
  if (w.length < 30) return null;
  return percentileRank(w.slice(0, -1), w[w.length - 1]);
}

function spreadSeries(a: Series, b: Series, days: number): number[] {
  // 20-day return spread a − b on a's calendar (b forward-filled)
  const out: number[] = [];
  let j = 0;
  const bAt: number[] = [];
  for (let i = 0; i < a.dates.length; i++) {
    while (j + 1 < b.dates.length && b.dates[j + 1] <= a.dates[i]) j++;
    bAt.push(b.dates[j] <= a.dates[i] ? b.values[j] : NaN);
  }
  for (let i = days; i < a.values.length; i++) {
    out.push(a.values[i] / a.values[i - days] - bAt[i] / bAt[i - days]);
  }
  return out;
}

interface MoodSpec {
  market: string;
  vix?: string;
  index: string;
  members: AnalyzedAsset[];
  riskOn?: string;
  safeHaven?: string;
  junk?: [string, string];
}

/** Annualised 20-day realised volatility of daily log returns, one value per day from day 21. */
export function realisedVol(values: number[], window = 20, periodsPerYear = 252): number[] {
  const out: number[] = [];
  for (let i = window + 1; i < values.length; i++) {
    let s = 0;
    let s2 = 0;
    for (let k = i - window + 1; k <= i; k++) {
      const r = Math.log(values[k] / values[k - 1]);
      s += r;
      s2 += r * r;
    }
    const m = s / window;
    out.push(Math.sqrt(Math.max(0, s2 / window - m * m) * periodsPerYear));
  }
  return out;
}

export function moodFor(spec: MoodSpec, universe: Universe): MoodInfo | null {
  const comps: MoodComponent[] = [];
  const vix = spec.vix ? universe.get(spec.vix) : undefined;
  const idx = universe.get(spec.index);
  if (vix) {
    const p = latestPercentile(vix.series.values, 252);
    if (p !== null)
      comps.push({
        key: 'volatility',
        label: 'Volatility',
        score: Math.round(100 * (1 - p)),
        detail: `${vix.meta.short} at ${explain.number(vix.quote.price, 1)} — ${p < 0.5 ? 'calmer' : 'more fearful'} than ${Math.round(100 * (p < 0.5 ? 1 - p : p))}% of the past year.`,
      });
  } else if (idx) {
    // No freely licensed implied-volatility index (India VIX is NSE-licensed),
    // so use the market's own 20-day realised volatility.
    const rv = realisedVol(idx.series.values);
    const p = latestPercentile(rv, 252);
    if (p !== null)
      comps.push({
        key: 'volatility',
        label: 'Volatility',
        score: Math.round(100 * (1 - p)),
        detail: `${idx.meta.short} has been swinging ${explain.pct(rv[rv.length - 1], 0)} a year (last 20 days) — ${p < 0.5 ? 'calmer' : 'choppier'} than ${Math.round(100 * (p < 0.5 ? 1 - p : p))}% of the past year.`,
      });
  }
  if (idx) {
    const s125 = sma(idx.series.values, 125);
    const gaps = idx.series.values.map((v, i) => v / s125[i] - 1);
    const p = latestPercentile(gaps, 504);
    const g = gaps[gaps.length - 1];
    if (p !== null && Number.isFinite(g))
      comps.push({
        key: 'momentum',
        label: 'Momentum',
        score: Math.round(100 * p),
        detail: `${idx.meta.short} is ${explain.pct(Math.abs(g))} ${g >= 0 ? 'above' : 'below'} its 125-day average.`,
      });
  }
  const withTech = spec.members.filter((m) => m.tech);
  if (withTech.length >= 5) {
    const above = withTech.filter((m) => m.tech!.aboveSma50).length / withTech.length;
    comps.push({
      key: 'breadth',
      label: 'Breadth',
      score: Math.round(100 * above),
      detail: `${Math.round(100 * above)}% of tracked sector, size and strategy funds trade above their 50-day average.`,
    });
    const highs = withTech.filter((m) => m.tech!.fromHigh52 > -0.03).length;
    const lows = withTech.filter((m) => m.tech!.price <= m.tech!.low52 * 1.03).length;
    const net = (highs - lows) / withTech.length;
    comps.push({
      key: 'highs-lows',
      label: 'New highs vs lows',
      score: Math.round(50 + 50 * net),
      detail: `${highs} near 52-week highs vs ${lows} near 52-week lows.`,
    });
  }
  if (spec.riskOn && spec.safeHaven) {
    const a = universe.get(spec.riskOn);
    const b = universe.get(spec.safeHaven);
    if (a && b) {
      const sp = spreadSeries(a.series, b.series, 20);
      const p = latestPercentile(sp, 504);
      const last = sp[sp.length - 1];
      if (p !== null && Number.isFinite(last))
        comps.push({
          key: 'safe-haven',
          label: 'Safe-haven demand',
          score: Math.round(100 * p),
          detail: `${a.meta.short} ${last >= 0 ? 'beat' : 'lagged'} ${b.meta.short} by ${explain.pct(Math.abs(last))} over 20 trading days.`,
        });
    }
  }
  if (spec.junk) {
    const a = universe.get(spec.junk[0]);
    const b = universe.get(spec.junk[1]);
    if (a && b) {
      const sp = spreadSeries(a.series, b.series, 20);
      const p = latestPercentile(sp, 504);
      if (p !== null)
        comps.push({
          key: 'junk',
          label: 'Junk-bond appetite',
          score: Math.round(100 * p),
          detail: `High-yield bonds ${sp[sp.length - 1] >= 0 ? 'outperforming' : 'underperforming'} Treasuries over 20 trading days.`,
        });
    }
  }
  if (comps.length < 3) return null;
  const score = Math.round(comps.reduce((s, c) => s + c.score, 0) / comps.length);
  return {
    market: spec.market,
    score,
    label: explain.moodLabel(score).label,
    components: comps,
    text: explain.explainMood(score, spec.market),
  };
}

export function breadthFor(members: AnalyzedAsset[]): MarketSummary['breadth'] {
  const withTech = members.filter((m) => m.tech);
  return {
    advancers: members.filter((m) => (m.stats.returns.d1 ?? 0) > 0).length,
    decliners: members.filter((m) => (m.stats.returns.d1 ?? 0) < 0).length,
    aboveSma50: withTech.filter((m) => m.tech!.aboveSma50).length,
    aboveSma200: withTech.filter((m) => m.tech!.aboveSma200).length,
    total: members.length,
  };
}

export function headlineFor(
  name: string,
  idx: AnalyzedAsset | undefined,
  regime: RegimeInfo | null,
  mood: MoodInfo | null,
): string {
  if (!idx) return `${name}: data unavailable.`;
  const m1 = idx.stats.returns.m1;
  const dir =
    m1 === null
      ? 'steady'
      : m1 > 0.03
        ? 'rising strongly'
        : m1 > 0.005
          ? 'edging higher'
          : m1 < -0.03
            ? 'falling sharply'
            : m1 < -0.005
              ? 'drifting lower'
              : 'flat';
  const calm = regime ? (regime.current === 'calm' ? 'calm' : 'turbulent') : null;
  const moodTxt = mood ? `; sentiment: ${mood.label.toLowerCase()}` : '';
  return `${name} stocks are ${calm ? `${calm} and ` : ''}${dir} (${explain.signedPct(m1)} over the past month)${moodTxt}.`;
}
