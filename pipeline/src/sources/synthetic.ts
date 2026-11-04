/**
 * SYNTHETIC data for local development and CI tests ONLY.
 *
 * Generates plausible, deterministic price paths (regional market factors,
 * class-specific drift/volatility, volatility regimes) so the UI and the
 * analytics can be exercised without network access. Output is always
 * flagged `synthetic: true`, the web app shows a prominent banner, and the
 * deploy workflow refuses to publish it.
 */
import type { AssetMeta } from '@frontier/contracts';
import { createRng, isWeekday, toEpochDay, type Series } from '@frontier/quant';

const INCEPTION: Record<string, string> = {
  XLRE: '2015-10-08',
  XLC: '2018-06-19',
  MTUM: '2013-04-18',
  QUAL: '2013-07-18',
  USMV: '2011-10-20',
  'BTC-USD': '2014-09-17',
  'ETH-USD': '2017-11-09',
  'SOL-USD': '2020-04-10',
  'MON100.NS': '2011-03-31',
  'SILVERBEES.NS': '2022-02-01',
  'SETF10GILT.NS': '2016-07-01',
  'GOLDBEES.NS': '2007-03-19',
  TIP: '2005-01-03',
};

interface Profile {
  mu: number;
  vol: number;
  beta: number;
  factor: 'US' | 'IN' | 'CRYPTO' | 'BOND' | 'GOLD' | 'NONE';
  level: number;
}

function profile(a: AssetMeta): Profile {
  if (a.assetClass === 'crypto')
    return { mu: 0.45, vol: 0.75, beta: 1, factor: 'CRYPTO', level: a.id === 'BTC-USD' ? 400 : 50 };
  if (a.assetClass === 'bond') {
    const v = a.id === 'TLT' ? 0.14 : a.id === 'SHY' ? 0.015 : a.id === 'HYG' ? 0.08 : 0.055;
    return {
      mu: 0.03 + v * 0.1,
      vol: v,
      beta: a.id === 'HYG' ? 0.3 : 1,
      factor: a.id === 'HYG' ? 'US' : 'BOND',
      level: 100,
    };
  }
  if (a.assetClass === 'commodity')
    return {
      mu: 0.06,
      vol: a.id.includes('SILVER') || a.id === 'SLV' ? 0.28 : 0.16,
      beta: 0.8,
      factor: 'GOLD',
      level: a.region === 'IN' ? 40 : 120,
    };
  if (a.assetClass === 'volatility')
    return { mu: 0, vol: 0.9, beta: -3, factor: a.region === 'IN' ? 'IN' : 'US', level: 18 };
  if (a.assetClass === 'rate')
    return { mu: 0, vol: 0.25, beta: 0.2, factor: 'BOND', level: a.id === 'IRX' ? 3.5 : 4 };
  if (a.assetClass === 'currency')
    return { mu: 0.02, vol: 0.06, beta: 0, factor: 'NONE', level: a.id === 'USDINR' ? 45 : 90 };
  const stock = a.kind === 'stock';
  const region = a.region === 'IN' ? 'IN' : 'US';
  return {
    mu: stock ? 0.11 : 0.09,
    vol: stock ? 0.3 : a.tags?.includes('sector') ? 0.2 : 0.17,
    beta: stock ? 1.1 : 1,
    factor: region,
    level: a.kind === 'index' ? (region === 'IN' ? 2000 : 1200) : stock ? 50 : 80,
  };
}

/** Deterministic hash of a string → 32-bit seed. */
const seedOf = (s: string) =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

export function syntheticUniverse(
  assets: AssetMeta[],
  endDay: number,
  startIso = '2005-01-03',
): Map<string, Series> {
  const start = toEpochDay(startIso);
  const days: number[] = [];
  for (let d = start; d <= endDay; d++) days.push(d);
  // Shared factor paths with a two-state volatility regime.
  const frng = createRng(20240611);
  const factors: Record<string, number[]> = { US: [], IN: [], CRYPTO: [], BOND: [], GOLD: [], NONE: [] };
  let turbulent = false;
  for (let i = 0; i < days.length; i++) {
    if (frng.next() < (turbulent ? 0.02 : 0.004)) turbulent = !turbulent;
    const k = turbulent ? 2.2 : 0.8;
    const us = frng.normal() * k;
    factors.US.push(us);
    factors.IN.push(0.55 * us + 0.84 * frng.normal() * k);
    factors.CRYPTO.push(0.25 * us + 0.97 * frng.normal());
    factors.BOND.push(-0.25 * us + 0.97 * frng.normal());
    factors.GOLD.push(-0.1 * us + 0.99 * frng.normal());
    factors.NONE.push(frng.normal());
  }
  const out = new Map<string, Series>();
  for (const a of assets) {
    if (a.kind === 'cash') continue;
    const p = profile(a);
    const rng = createRng(seedOf(a.id));
    const incept = toEpochDay(INCEPTION[a.id] ?? startIso);
    const weekdaysOnly = a.assetClass !== 'crypto';
    const dates: number[] = [];
    const values: number[] = [];
    let level = p.level;
    const dt = 1 / 252;
    const sysShare = p.factor === 'NONE' ? 0 : Math.min(0.85, Math.abs(p.beta) * 0.7);
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d < incept || (weekdaysOnly && !isWeekday(d))) continue;
      const shock =
        Math.sign(p.beta) * sysShare * factors[p.factor][i] +
        Math.sqrt(1 - sysShare * sysShare) * rng.normal();
      if (a.assetClass === 'rate' || a.assetClass === 'volatility') {
        // mean-reverting level (yields, VIX)
        const target = p.level;
        level = Math.max(0.05, level + 0.01 * (target - level) + p.vol * Math.sqrt(dt) * level * shock);
      } else {
        level *= Math.exp((p.mu - 0.5 * p.vol * p.vol) * dt + p.vol * Math.sqrt(dt) * shock);
      }
      dates.push(d);
      values.push(level);
    }
    out.set(a.id, { dates, values });
  }
  return out;
}
