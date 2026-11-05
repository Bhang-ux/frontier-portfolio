import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { contentHash, decodeHistory, encodeHistory, roundSig } from '@frontier/contracts';
import { fromEpochDay, toEpochDay } from '@frontier/quant';
import { canAppend, parseAmfiDate, parseMfapi, parseNavAll } from '../src/sources/amfi';
import { parseKlines } from '../src/sources/binance';
import { extendWith, fixUnitSplits, inrToUsd, removeSpikes, spliceBackfill } from '../src/sources/clean';
import { parseFrankfurter } from '../src/sources/ecb';
import { parseFredCsv } from '../src/sources/fred';
import { parseFrenchCsv, unzipFirst } from '../src/sources/french';
import { bondIndexFromYields, modifiedDuration, parBondPrice } from '../src/build/bonds';
import { realisedVol } from '../src/build/markets';
import { cashIndex, trailingYield } from '../src/acquire';
import { createLimiter } from '../src/sources/http';
import { ALL_ASSETS, CORE_IDS, INTRADAY_IDS, SOURCES, byId } from '../src/universe';
import { run } from '../src/main';

const day = (iso: string) => toEpochDay(iso);

describe('AMFI NAVs', () => {
  it('parses both AMFI date styles', () => {
    expect(fromEpochDay(parseAmfiDate('04-11-2026'))).toBe('2026-11-04');
    expect(fromEpochDay(parseAmfiDate('4-Nov-2026'))).toBe('2026-11-04');
    expect(parseAmfiDate('2026-11-04')).toBeNaN();
  });
  it('parses an mfapi response (newest first) into a clean ascending series', () => {
    const h = parseMfapi(
      {
        meta: {
          scheme_code: 120716,
          scheme_name: 'UTI Nifty 50 Index Fund - Direct Plan - Growth',
          fund_house: 'UTI',
        },
        data: [
          { date: '04-11-2026', nav: '168.76560' },
          { date: '03-11-2026', nav: '167.10000' },
          { date: '03-11-2026', nav: '167.20000' },
          { date: '31-10-2026', nav: 'N.A.' },
          { date: '30-10-2026', nav: '166.00000' },
        ],
        status: 'SUCCESS',
      },
      120716,
    );
    expect(h.series.dates.map(fromEpochDay)).toEqual(['2026-10-30', '2026-11-03', '2026-11-04']);
    expect(h.series.values[0]).toBe(166);
    expect(h.name).toMatch(/Direct Plan/);
    expect(() => parseMfapi({ status: 'FAIL', data: [] }, 1)).toThrow(/status FAIL/);
    expect(() => parseMfapi({ nope: 1 }, 1)).toThrow(/unexpected/);
  });
  it('parses NAVAll.txt in the current 8-column and the legacy 6-column format', () => {
    const text = [
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
      '',
      'Open Ended Schemes(Other Scheme - Index Funds)',
      'UTI Mutual Fund',
      '120716;INF789F01XA0;-;UTI Nifty 50 Index Fund;Direct Plan;Growth;168.7656;04-Nov-2026',
      '120717;INF789F01XB8;-;Some Fund;Direct Plan;IDCW;N.A.;04-Nov-2026',
      '100822;INF789F01ABC;-;UTI Nifty 50 Index Fund - Regular Plan - Growth;166.1695;04-Nov-2026',
    ].join('\r\n');
    const m = parseNavAll(text);
    expect(m.size).toBe(2);
    expect(m.get(120716)).toMatchObject({ nav: 168.7656, plan: 'Direct Plan', option: 'Growth' });
    expect(fromEpochDay(m.get(100822)!.day)).toBe('2026-11-04');
    expect(m.get(100822)!.plan).toBeUndefined();
  });
  it('appends a new NAV only when no weekday could have been skipped', () => {
    expect(canAppend(day('2026-11-03'), day('2026-11-04'))).toBe(true); // Tue → Wed
    expect(canAppend(day('2026-10-30'), day('2026-11-02'))).toBe(true); // Fri → Mon
    expect(canAppend(day('2026-10-29'), day('2026-11-02'))).toBe(false); // Thu → Mon: Friday missing
    expect(canAppend(day('2026-11-04'), day('2026-11-04'))).toBe(false);
  });
});

describe('cleaning & splicing', () => {
  it('undoes a 1:100 unit split but leaves real moves alone', () => {
    const r = fixUnitSplits({ dates: [1, 2, 3, 4], values: [5000, 5050, 50.4, 51] });
    expect(r.splits).toEqual([{ date: 3, factor: 0.01 }]);
    expect(r.series.values[0]).toBeCloseTo(50, 10);
    const crash = fixUnitSplits({ dates: [1, 2, 3], values: [100, 55, 54] });
    expect(crash.splits).toHaveLength(0);
  });
  it('removes one-day bad prints but keeps genuine moves', () => {
    expect(removeSpikes({ dates: [1, 2, 3, 4, 5], values: [100, 101, 300, 102, 103] }).values).toEqual([
      100, 101, 102, 103,
    ]);
    expect(removeSpikes({ dates: [1, 2, 3, 4], values: [100, 50, 49, 48] }).values).toEqual([
      100, 50, 49, 48,
    ]);
  });
  it('chain-links a backfill so returns on both sides are preserved', () => {
    const primary = { dates: [10, 11, 12], values: [200, 202, 204] };
    const back = { dates: [7, 8, 9, 10, 11], values: [9, 9.9, 9.5, 10, 10.1] };
    const s = spliceBackfill(primary, back);
    expect(s.dates).toEqual([7, 8, 9, 10, 11, 12]);
    expect(s.values[3]).toBe(200);
    expect(s.values[1] / s.values[0]).toBeCloseTo(9.9 / 9, 12);
    expect(s.values[3] / s.values[2]).toBeCloseTo(10 / 9.5, 12);
    expect(spliceBackfill(primary, null)).toBe(primary);
    expect(extendWith(back, primary).dates).toEqual([7, 8, 9, 10, 11, 12]);
  });
  it('converts INR prices to USD with forward-filled FX', () => {
    const s = inrToUsd({ dates: [1, 2, 3], values: [880, 900, 905] }, { dates: [1, 3], values: [88, 90.5] });
    expect(s.values).toEqual([10, 900 / 88, 10]);
  });
});

describe('other adapters', () => {
  it('parses FRED CSV with legacy "." and empty missing values', () => {
    const s = parseFredCsv(
      'observation_date,DTB3\n2024-01-01,5.2\n2024-01-02,.\n2024-01-03,\n2024-01-04,5.1\n',
    );
    expect(s.values).toEqual([5.2, 5.1]);
  });
  it('parses Binance klines', () => {
    const k = parseKlines(
      [
        [
          1793664000000,
          '76816.0',
          '78063.3',
          '76388.8',
          '77453.86',
          '12560.1',
          1793750399999,
          '0',
          1,
          '0',
          '0',
          '0',
        ],
        [1793750400000, '77453.86', '78000', '77000', 'bad', '1', 1793836799999],
      ],
      'BTCUSDT',
    );
    expect(k.close).toEqual([77453.86]);
    expect(() => parseKlines({ code: -1121 }, 'X')).toThrow(/unexpected/);
  });
  it('parses ECB rates from Frankfurter in date order', () => {
    const s = parseFrankfurter(
      { base: 'USD', rates: { '2026-10-02': { INR: 96.4 }, '2026-10-01': { INR: 96.3 }, '2026-10-03': {} } },
      'INR',
    );
    expect(s.dates.map(fromEpochDay)).toEqual(['2026-10-01', '2026-10-02']);
    expect(s.values).toEqual([96.3, 96.4]);
  });
  it('unzips and parses a Fama–French daily file', () => {
    const csv = [
      'This file was created by using the 202609 CRSP database.',
      '',
      ',Mkt-RF,SMB,HML,RF',
      ...Array.from(
        { length: 300 },
        (_, i) =>
          `${fromEpochDay(day('2025-01-01') + i).replace(/-/g, '')},    0.10,   -0.05,    0.02,    0.01`,
      ),
      '',
      'Copyright 2026 Eugene F. Fama and Kenneth R. French',
    ].join('\r\n');
    const t = parseFrenchCsv(unzipFirst(makeZip('F-F_daily.csv', csv)).text);
    expect(t.dates).toHaveLength(300);
    expect(t.columns['Mkt-RF'][0]).toBeCloseTo(0.001, 12);
    expect(t.columns.RF[299]).toBeCloseTo(0.0001, 12);
  });
});

describe('modelled Treasury index', () => {
  it('earns exactly the coupon when yields do not move', () => {
    const s = bondIndexFromYields({ dates: [0, 1, 2], values: [4, 4, 4] }, 10);
    expect(s.values[2] / s.values[0] - 1).toBeCloseTo((1 + 0.04 / 365.25) ** 2 - 1, 12);
  });
  it('loses about duration × Δy when yields rise', () => {
    const d = modifiedDuration(0.04, 10);
    expect(d).toBeGreaterThan(8.1);
    expect(d).toBeLessThan(8.25);
    const s = bondIndexFromYields({ dates: [0, 1], values: [4, 4.1] }, 10);
    expect(s.values[1] / s.values[0] - 1).toBeCloseTo(-d * 0.001 + 0.04 / 365.25, 4);
    expect(parBondPrice(0.05, 0.05, 7.3)).toBeCloseTo(1, 12);
  });
});

describe('FRED-derived cash & rates', () => {
  it('accrues the risk-free rate on weekdays', () => {
    const start = toEpochDay('2024-01-01');
    const s = cashIndex({ dates: [start], values: [3.65] }, start, start + 365);
    const growth = s.values.at(-1)! / s.values[0] - 1;
    expect(growth).toBeGreaterThan(0.0365);
    expect(growth).toBeLessThan(0.038);
  });
  it('annualises a liquid fund’s trailing return', () => {
    const dates = Array.from({ length: 92 }, (_, i) => i);
    const values = dates.map((d) => 100 * Math.pow(1.07, d / 365));
    expect(trailingYield({ dates, values }, 91)).toBeCloseTo(0.07, 10);
    expect(trailingYield({ dates: [0, 1], values: [1, 1] }, 91)).toBeNull();
  });
  it('measures realised volatility', () => {
    const v = [100];
    for (let i = 1; i < 60; i++) v.push(v[i - 1] * (i % 2 ? 1.01 : 0.99));
    const rv = realisedVol(v);
    expect(rv.at(-1)!).toBeGreaterThan(0.15);
    expect(rv.at(-1)!).toBeLessThan(0.17);
  });
});

describe('history codec', () => {
  it('round-trips dates exactly and prices to 6 significant digits', () => {
    const dates = [toEpochDay('2024-01-02'), toEpochDay('2024-01-03'), toEpochDay('2024-01-08')];
    const closes = [123.456789, 0.00123456789, 98765.4321];
    const enc = encodeHistory('X', 'USD', dates, closes);
    expect(enc.d).toEqual([0, 1, 5]);
    const dec = decodeHistory(JSON.parse(JSON.stringify(enc)));
    expect(dec.dates).toEqual(dates);
    dec.values.forEach((v, i) => expect(Math.abs(v / closes[i] - 1)).toBeLessThan(5e-6));
    expect(roundSig(98765.4321)).toBe(98765.4);
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});

describe('universe integrity', () => {
  it('has unique ids, valid links, a source and provenance for every instrument', () => {
    const ids = ALL_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ALL_ASSETS) {
      if (a.benchmark) expect(byId.has(a.benchmark), `${a.id} benchmark ${a.benchmark}`).toBe(true);
      if (a.proxy) expect(byId.has(a.proxy), `${a.id} proxy ${a.proxy}`).toBe(true);
      expect(a.description.length).toBeGreaterThan(20);
      expect(/^[A-Za-z0-9.\-_]+$/.test(a.id), `${a.id} is file-safe`).toBe(true);
      expect(SOURCES.has(a.id), `${a.id} has a source`).toBe(true);
      expect(a.provenance?.detail.length ?? 0, `${a.id} provenance`).toBeGreaterThan(20);
      expect(a.symbol.length).toBeLessThanOrEqual(9);
    }
    for (const id of [...CORE_IDS, ...INTRADAY_IDS]) expect(byId.has(id)).toBe(true);
    const derived = [...SOURCES.entries()].filter(([, s]) => s.type === 'inr-to-usd');
    for (const [, s] of derived) if (s.type === 'inr-to-usd') expect(byId.get(s.from)?.currency).toBe('INR');
  });
});

describe('concurrency limiter', () => {
  it('never exceeds the limit', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});

describe('end-to-end (synthetic, offline)', () => {
  it('publishes a manifest, snapshot and per-asset histories that pass validation', async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'frontier-'));
    const code = await run({ synthetic: true, out, minCoverage: 0.85, maxStaleDays: 6, start: '2015-01-01' });
    expect(code).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    const snap = JSON.parse(await readFile(path.join(out, 'snapshot.json'), 'utf8'));
    expect(manifest.synthetic).toBe(true);
    expect(snap.synthetic).toBe(true);
    expect(snap.models.length).toBe(10);
    snap.models.forEach((m: { holdings: { weight: number }[] }) =>
      expect(m.holdings.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 10),
    );
    expect(snap.markets.every((m: { mood: unknown }) => m.mood !== null)).toBe(true);
    const files = await readdir(path.join(out, 'history'));
    expect(files.length).toBe(snap.assets.length);
    expect(Object.keys(manifest.histories)).toHaveLength(snap.assets.length);
  }, 60_000);
});

/** Build a one-file deflated ZIP archive (local header + central directory + EOCD). */
function makeZip(name: string, text: string): Buffer {
  const data = deflateRawSync(Buffer.from(text, 'latin1'));
  const raw = Buffer.byteLength(text, 'latin1');
  const n = Buffer.from(name, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw, 22);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw, 24);
  cd.writeUInt16LE(n.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdOffset = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}
