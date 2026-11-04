/**
 * Compact history encoding shared by the pipeline (encode) and browser (decode).
 * Dates are delta-encoded epoch days (mostly "1"s and "3"s → compresses ~20×),
 * prices are rounded to 6 significant digits (error < 5e-7, far below
 * the noise in daily returns).
 */
import type { Currency, HistoryFile } from './index';

const MS_PER_DAY = 86_400_000;

export const roundSig = (x: number, sig = 6): number => {
  if (x === 0 || !Number.isFinite(x)) return x;
  const p = sig - Math.ceil(Math.log10(Math.abs(x)));
  const f = Math.pow(10, p);
  return Math.round(x * f) / f;
};

export function encodeHistory(id: string, currency: Currency, dates: number[], closes: number[]): HistoryFile {
  const d = dates.map((v, i) => (i === 0 ? 0 : v - dates[i - 1]));
  return {
    id,
    currency,
    start: new Date(dates[0] * MS_PER_DAY).toISOString().slice(0, 10),
    d,
    c: closes.map((c) => roundSig(c)),
  };
}

export function decodeHistory(file: HistoryFile): { dates: number[]; values: number[] } {
  const [y, m, dd] = file.start.split('-').map(Number);
  let day = Math.floor(Date.UTC(y, m - 1, dd) / MS_PER_DAY);
  const dates = new Array<number>(file.d.length);
  for (let i = 0; i < file.d.length; i++) {
    day += file.d[i];
    dates[i] = day;
  }
  return { dates, values: file.c.slice() };
}

/** FNV-1a 32-bit hash → 8 hex chars. Stable content hashes for cache busting. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
