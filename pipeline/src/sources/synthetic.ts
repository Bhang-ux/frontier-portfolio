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
  NIFTYNEXT50: '2010-06-29',
  NIFTY500: '2019-09-11',
  MIDCAP150: '2019-09-11',
  SMALLCAP250: '2019-09-11',
  NIFTYBANK: '2019-09-11',
  NIFTYIT: '2022-08-19',
  NIFTYPHARMA: '2022-12-15',
  NIFTYAUTO: '2022-10-12',
  MANUFACTURING: '2022-02-01',
  DEFENCE: '2024-07-09',
  REALTY: '2024-03-26',
  CONSUMPTION: '2024-11-06',
  EQUALWEIGHT50: '2017-10-23',
  MOMENTUM30: '2021-03-12',
  LOWVOL30: '2021-04-13',
  VALUE20: '2021-02-23',
  QUALITY30: '2021-10-07',
  'SP500-INR': '2020-04-29',
  'NASDAQ100-INR': '2018-11-29',
  'US-TECH': '2018-11-29',
  'GOLD-INR': '2007-04-13',
  'SILVER-INR': '2022-02-08',
  CORPBOND: '2013-01-01',
  'BTC-USD': '2017-08-17',
  'ETH-USD': '2017-08-17',
  'SOL-USD': '2020-08-11',
  DOLLAR: '2006-01-02',
};

interface Profile {
  mu: number;
  vol: number;
  beta: number;
  factor: 'US' | 'IN' | 'CRYPTO' | 'BOND' | 'GOLD' | 'NONE';
  level: number;
}

const BOND_VOL: Record<string, number> = {
  UST2Y: 0.015,
  UST10Y: 0.07,
  UST30Y: 0.14,
  GILT10Y: 0.05,
  CORPBOND: 0.025,
};

function profile(a: AssetMeta): Profile {
  if (a.tags?.includes('factor')) return { mu: 0.01, vol: 0.08, beta: 0, factor: 'NONE', level: 100 };
  if (a.assetClass === 'crypto')
    return { mu: 0.45, vol: 0.75, beta: 1, factor: 'CRYPTO', level: a.id === 'BTC-USD' ? 4000 : 50 };
  if (a.assetClass === 'bond') {
    const v = BOND_VOL[a.id] ?? 0.05;
    return {
      mu: 0.03 + v * 0.1 + (a.currency === 'INR' ? 0.03 : 0),
      vol: v,
      beta: 1,
      factor: 'BOND',
      level: 100,
    };
  }
  if (a.assetClass === 'commodity') {
    if (a.kind === 'index') return { mu: 0.02, vol: 0.32, beta: 0.4, factor: 'NONE', level: 80 };
    return {
      mu: 0.07,
      vol: a.id.includes('SILVER') ? 0.28 : 0.16,
      beta: 0.8,
      factor: 'GOLD',
      level: a.currency === 'INR' ? 20 : 1500,
    };
  }
  if (a.assetClass === 'volatility')
    return { mu: 0, vol: 0.9, beta: -3, factor: a.region === 'IN' ? 'IN' : 'US', level: 18 };
  if (a.assetClass === 'rate')
    return { mu: 0, vol: 0.25, beta: 0.2, factor: 'BOND', level: a.id === 'US3M' ? 3.5 : 4 };
  if (a.assetClass === 'currency')
    return { mu: 0.025, vol: 0.06, beta: 0, factor: 'NONE', level: a.id === 'USDINR' ? 60 : 100 };
  const region = a.region === 'IN' && a.currency === 'INR' ? 'IN' : 'US';
  const satellite = a.tags?.includes('sector') || a.tags?.includes('strategy');
  const small = a.id === 'SMALLCAP250' || a.id === 'MIDCAP150';
  return {
    mu: region === 'IN' ? 0.12 : 0.09,
    vol: small ? 0.24 : satellite ? 0.21 : 0.17,
    beta: 1,
    factor: region,
    level: a.currency === 'INR' ? 20 : 100,
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
