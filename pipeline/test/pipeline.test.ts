import { describe, expect, it } from 'vitest';
import { contentHash, decodeHistory, encodeHistory, roundSig } from '@frontier/contracts';
import { fromEpochDay, toEpochDay } from '@frontier/quant';
import { parseDaily, parseIntraday, removeSpikes } from '../src/sources/yahoo';
import { parseFredCsv } from '../src/sources/fred';
import { cashIndex } from '../src/acquire';
import { createLimiter } from '../src/sources/http';
import { ALL_ASSETS, CORE_IDS, byId } from '../src/universe';
import { run } from '../src/main';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Shape of a real v8 chart response (values abbreviated). */
const chartFixture = (overrides: Record<string, unknown> = {}) => ({
  chart: {
    result: [
      {
        meta: {
          currency: 'INR',
          symbol: 'RELIANCE.NS',
          exchangeTimezoneName: 'Asia/Kolkata',
          gmtoffset: 19800,
          regularMarketPrice: 1418.5,
          regularMarketTime: 1762247400,
          regularMarketDayHigh: 1425,
          regularMarketDayLow: 1401.2,
          regularMarketVolume: 9_812_345,
          chartPreviousClose: 1300,
          longName: 'Reliance Industries Limited',
        },
        // 03:45 UTC = 09:15 IST market open on consecutive days
        timestamp: [1761882300, 1761968700, 1762141500, 1762141600, 1762227900],
        indicators: {
          quote: [{ close: [1400, null, 1410, 1412, 1418.5] }],
          adjclose: [{ adjclose: [1395, null, 1405, 1407, 1418.5] }],
        },
        ...overrides,
      },
    ],
    error: null,
  },
});

describe('Yahoo chart parsing', () => {
  it('maps timestamps to exchange-local dates, drops nulls and de-duplicates', () => {
    const d = parseDaily(chartFixture(), 'RELIANCE.NS');
    expect(d.dates.map(fromEpochDay)).toEqual(['2025-10-31', '2025-11-03', '2025-11-04']);
    expect(d.close).toEqual([1400, 1412, 1418.5]); // later duplicate on 11-03 wins
    expect(d.adjClose).toEqual([1395, 1407, 1418.5]);
    expect(d.currency).toBe('INR');
    expect(d.regularMarketPrice).toBe(1418.5);
    expect(d.longName).toBe('Reliance Industries Limited');
  });
  it('surfaces API errors with the symbol', () => {
    expect(() => parseDaily({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, 'XXXX')).toThrow(/XXXX: Not Found/);
    expect(() => parseDaily({ nope: true }, 'X')).toThrow(/unexpected response/);
  });
  it('falls back to close when adjclose is absent (indices)', () => {
    const fx = chartFixture({ indicators: { quote: [{ close: [10, 11, 12, 13, 14] }] } });
    expect(parseDaily(fx, '^NSEI').adjClose).toEqual([10, 11, 13, 14]);
  });
  it('parses intraday bars and previous close', () => {
    const r = parseIntraday(chartFixture(), 'RELIANCE.NS');
    expect(r.p).toHaveLength(4);
    expect(r.previousClose).toBe(1300);
  });
  it('removes one-day bad prints but keeps genuine moves', () => {
    const s = removeSpikes({ dates: [1, 2, 3, 4, 5], close: [100, 101, 300, 102, 103], adjClose: [100, 101, 300, 102, 103] });
    expect(s.adjClose).toEqual([100, 101, 102, 103]);
    const crash = removeSpikes({ dates: [1, 2, 3, 4], close: [100, 50, 49, 48], adjClose: [100, 50, 49, 48] });
    expect(crash.adjClose).toEqual([100, 50, 49, 48]);
  });
});

describe('FRED & constructed cash', () => {
  it('parses CSV with missing values', () => {
    const s = parseFredCsv('observation_date,DTB3\n2024-01-01,5.2\n2024-01-02,.\n2024-01-03,5.1\n');
    expect(s.values).toEqual([5.2, 5.1]);
  });
  it('accrues the risk-free rate on weekdays', () => {
    const start = toEpochDay('2024-01-01');
    const s = cashIndex({ dates: [start], values: [3.65] }, start, start + 365);
    const growth = s.values.at(-1)! / s.values[0] - 1;
    expect(growth).toBeGreaterThan(0.0365);
    expect(growth).toBeLessThan(0.038); // compounding over ~261 accrual steps
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
  it('has unique ids, valid benchmarks/proxies and every core instrument', () => {
    const ids = ALL_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ALL_ASSETS) {
      if (a.benchmark) expect(byId.has(a.benchmark), `${a.id} benchmark ${a.benchmark}`).toBe(true);
      if (a.proxy) expect(byId.has(a.proxy), `${a.id} proxy ${a.proxy}`).toBe(true);
      expect(a.description.length).toBeGreaterThan(20);
      expect(/^[A-Za-z0-9.\-_]+$/.test(a.id), `${a.id} is file-safe`).toBe(true);
    }
    for (const id of CORE_IDS) expect(byId.has(id)).toBe(true);
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
    const code = await run({ synthetic: true, out, concurrency: 4, minCoverage: 0.85, maxStaleDays: 6, start: '2015-01-01' });
    expect(code).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    const snap = JSON.parse(await readFile(path.join(out, 'snapshot.json'), 'utf8'));
    expect(manifest.synthetic).toBe(true);
    expect(snap.synthetic).toBe(true);
    expect(snap.models.length).toBe(10);
    snap.models.forEach((m: { holdings: { weight: number }[] }) =>
      expect(m.holdings.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 10),
    );
    const files = await readdir(path.join(out, 'history'));
    expect(files.length).toBe(snap.assets.length);
    expect(Object.keys(manifest.histories)).toHaveLength(snap.assets.length);
  }, 60_000);
});
