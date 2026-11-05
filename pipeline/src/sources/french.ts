/**
 * Kenneth R. French Data Library (Tuck School of Business, Dartmouth) —
 * the academic standard for US equity factor returns, published free for
 * research and teaching. Daily returns back to 1926, total return (dividends
 * included), updated roughly monthly.
 *
 * Frontier uses it (a) to extend US equity history before the funds it tracks
 * existed and (b) for Fama–French factor regressions. Files are ZIP archives
 * holding one CSV; unzipping uses only node:zlib.
 */
import { inflateRawSync } from 'node:zlib';
import { toEpochDay } from '@frontier/quant';
import { fetchWithRetry } from './http';

const BASE = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/';

/** Extract the first file of a ZIP archive (stored or deflated) via its central directory. */
export function unzipFirst(buf: Buffer): { name: string; text: string } {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP: end of central directory not found');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('ZIP: bad central directory');
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const nameLen = buf.readUInt16LE(cd + 28);
  const name = buf.toString('latin1', cd + 46, cd + 46 + nameLen);
  const lho = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('ZIP: bad local header');
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method !== 0 && method !== 8) throw new Error(`ZIP: unsupported compression ${method}`);
  return { name, text: (method === 8 ? inflateRawSync(data) : data).toString('latin1') };
}

export interface FactorTable {
  dates: number[];
  /** column name → daily returns as fractions (the files quote percent). */
  columns: Record<string, number[]>;
}

/**
 * Parse the first daily table of a French CSV: a header row (",Mkt-RF,SMB,…")
 * followed by `YYYYMMDD, v1, v2, …` rows, ended by a blank or footer line.
 */
export function parseFrenchCsv(text: string): FactorTable {
  const lines = text.split(/\r?\n/);
  let h = lines.findIndex((l, i) => /^\s*,/.test(l) && /^\s*\d{8}\s*,/.test(lines[i + 1] ?? ''));
  if (h < 0) throw new Error('French CSV: header not found');
  const names = lines[h]
    .split(',')
    .slice(1)
    .map((s) => s.trim());
  const dates: number[] = [];
  const columns: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  for (h = h + 1; h < lines.length; h++) {
    const m = /^\s*(\d{4})(\d{2})(\d{2})\s*,(.*)$/.exec(lines[h]);
    if (!m) break;
    const vals = m[4].split(',').map((s) => Number(s));
    if (vals.length < names.length || vals.some((v) => !Number.isFinite(v) || v <= -99.99)) continue;
    dates.push(toEpochDay(`${m[1]}-${m[2]}-${m[3]}`));
    names.forEach((n, i) => columns[n].push(vals[i] / 100));
  }
  if (dates.length < 250) throw new Error(`French CSV: only ${dates.length} rows`);
  return { dates, columns };
}

export async function fetchFrenchDaily(file: string): Promise<FactorTable> {
  const res = await fetchWithRetry(`${BASE}${file}`, { retries: 3, timeoutMs: 60_000 });
  const { text } = unzipFirst(Buffer.from(await res.arrayBuffer()));
  return parseFrenchCsv(text);
}

export const FRENCH_FILES = {
  factors: 'F-F_Research_Data_Factors_daily_CSV.zip',
  momentum: 'F-F_Momentum_Factor_daily_CSV.zip',
} as const;
