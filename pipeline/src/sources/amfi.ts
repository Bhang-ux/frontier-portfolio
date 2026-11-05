/**
 * Indian mutual-fund NAVs — the Association of Mutual Funds in India (AMFI).
 *
 * NAVs are public disclosures every fund must publish daily, so they can be
 * republished freely. Two endpoints, used politely:
 *   - AMFI's own NAVAll.txt: today's NAV for every scheme in ONE request —
 *     the cheap "did anything change?" check on every run;
 *   - mfapi.in (a free community mirror of AMFI's history): full NAV history
 *     per scheme, fetched only when a scheme has a NAV we have not seen or
 *     on the weekly full refresh. mfapi rate-limits bursts (HTTP 429), so
 *     requests are serialised with generous backoff.
 */
import { toEpochDay, type Series } from '@frontier/quant';
import { cleanSeries } from './clean';
import { fetchWithRetry } from './http';

export interface NavHistory {
  code: number;
  name: string;
  fundHouse: string;
  category: string;
  series: Series;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

/** "04-11-2026" (mfapi) or "04-Nov-2026" (NAVAll) → epoch day; NaN if malformed. */
export function parseAmfiDate(s: string): number {
  const m = /^(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})$/.exec(s.trim());
  if (!m) return NaN;
  const month = /\d/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].toLowerCase()];
  if (!month) return NaN;
  return toEpochDay(`${m[3]}-${pad(month)}-${pad(Number(m[1]))}`);
}

interface MfapiResponse {
  meta?: { scheme_code?: number; scheme_name?: string; fund_house?: string; scheme_category?: string };
  data?: { date: string; nav: string }[];
  status?: string;
}

/** Parse an mfapi.in scheme response (newest first) into a clean ascending series. */
export function parseMfapi(json: unknown, code: number): NavHistory {
  const body = json as MfapiResponse;
  if (!body || !Array.isArray(body.data)) throw new Error(`AMFI ${code}: unexpected response shape`);
  if (body.status && body.status !== 'SUCCESS') throw new Error(`AMFI ${code}: status ${body.status}`);
  const dates: number[] = [];
  const values: number[] = [];
  for (const row of body.data) {
    const d = parseAmfiDate(row.date);
    const v = Number(row.nav);
    if (Number.isFinite(d) && Number.isFinite(v) && v > 0) {
      dates.push(d);
      values.push(v);
    }
  }
  const series = cleanSeries(dates, values, { splits: true });
  if (series.dates.length === 0) throw new Error(`AMFI ${code}: no NAVs`);
  return {
    code,
    name: body.meta?.scheme_name ?? String(code),
    fundHouse: body.meta?.fund_house ?? '',
    category: body.meta?.scheme_category ?? '',
    series,
  };
}

export async function fetchNavHistory(code: number): Promise<NavHistory> {
  const res = await fetchWithRetry(`https://api.mfapi.in/mf/${code}`, {
    retries: 5,
    baseDelayMs: 2500,
    timeoutMs: 30_000,
  });
  return parseMfapi(await res.json(), code);
}

export interface LatestNav {
  nav: number;
  day: number;
  name: string;
  /** "Direct Plan" / "Regular Plan" (8-column format only). */
  plan?: string;
  option?: string;
}

/**
 * Parse AMFI's NAVAll.txt. Current format (8 fields):
 *   code;ISIN growth;ISIN reinvest;scheme name;plan;option;NAV;DD-Mon-YYYY
 * legacy format (6 fields): code;ISIN;ISIN;name;NAV;date. Data rows sit
 * between category and fund-house headings; "N.A." NAVs are skipped.
 */
export function parseNavAll(text: string): Map<number, LatestNav> {
  const out = new Map<number, LatestNav>();
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(';').map((x) => x.trim());
    if (f.length < 6 || !/^\d+$/.test(f[0])) continue;
    const nav = Number(f[f.length - 2]);
    const day = parseAmfiDate(f[f.length - 1]);
    if (!Number.isFinite(nav) || nav <= 0 || !Number.isFinite(day)) continue;
    const wide = f.length >= 8;
    out.set(Number(f[0]), {
      nav,
      day,
      name: f[3],
      ...(wide ? { plan: f[4], option: f[5] } : {}),
    });
  }
  return out;
}

export async function fetchNavAll(): Promise<Map<number, LatestNav>> {
  const urls = [
    'https://www.amfiindia.com/spages/NAVAll.txt',
    'https://portal.amfiindia.com/spages/NAVAll.txt',
  ];
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetchWithRetry(url, { retries: 2, timeoutMs: 45_000 });
      const map = parseNavAll(await res.text());
      if (map.size < 1000) throw new Error(`NAVAll: only ${map.size} schemes parsed`);
      return map;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Can the previous history be extended by today's NAV alone? Only when no
 * weekday lies strictly between its last date and the new NAV's date —
 * otherwise a NAV may have been missed and the full history is refetched.
 */
export function canAppend(prevLast: number, next: number): boolean {
  if (next <= prevLast) return false;
  for (let d = prevLast + 1; d < next; d++) {
    const w = (((d + 4) % 7) + 7) % 7;
    if (w !== 0 && w !== 6) return false;
  }
  return true;
}
