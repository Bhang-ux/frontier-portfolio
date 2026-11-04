/**
 * Publication gate. The deploy job only ships a snapshot that passes:
 *  1. schema validation (zod) — structural contract with the web app,
 *  2. completeness — core instruments present, ≥ N % of the universe,
 *  3. freshness — core US data no older than the staleness budget,
 *  4. sanity — finite, positive prices; bounded statistics.
 * A failure exits non-zero, so GitHub Pages simply keeps serving the last
 * good deployment: users never see a broken or half-empty site.
 */
import { z } from 'zod';
import type { Snapshot } from '@frontier/contracts';
import { CORE_IDS } from './universe';

const num = z.number().refine(Number.isFinite, 'must be finite');
const nnum = num.nullable();

const AssetSchema = z.object({
  meta: z.object({ id: z.string().min(1), symbol: z.string(), name: z.string(), currency: z.enum(['USD', 'INR']), investable: z.boolean() }).passthrough(),
  quote: z.object({ price: num.positive(), previousClose: num.positive(), change: num, changePct: num, asOf: z.string() }).passthrough(),
  stats: z.object({
    returns: z.object({ d1: nnum, w1: nnum, m1: nnum, m3: nnum, m6: nnum, ytd: nnum, y1: nnum, y3: nnum, y5: nnum, y10: nnum }),
    vol1y: nnum,
    sharpe1y: nnum,
    maxDrawdownAll: nnum.refine((v) => v === null || (v >= 0 && v <= 1), 'drawdown out of range'),
  }).passthrough(),
  spark: z.array(num),
  summary: z.string(),
  history: z.object({ start: z.string(), end: z.string(), points: z.number().int().positive(), hash: z.string() }),
}).passthrough();

const SnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  synthetic: z.boolean(),
  fx: z.object({ USDINR: z.object({ rate: num.positive(), changePct: num, asOf: z.string() }) }),
  riskFree: z.object({ USD: z.object({ rate: num }).passthrough(), INR: z.object({ rate: num }).passthrough() }),
  assets: z.array(AssetSchema).min(20),
  markets: z.array(z.object({ key: z.enum(['US', 'IN']), headline: z.string() }).passthrough()),
  models: z.array(z.object({ id: z.string(), holdings: z.array(z.object({ id: z.string(), weight: num.min(0).max(1) }).passthrough()).min(1) }).passthrough()),
}).passthrough();

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSnapshot(
  snap: Snapshot,
  opts: { universeSize: number; minCoverage: number; maxStaleDays: number; now: Date },
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = SnapshotSchema.safeParse(snap);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 10)) errors.push(`schema: ${issue.path.join('.')} — ${issue.message}`);
  }
  const ids = new Set(snap.assets.map((a) => a.meta.id));
  for (const id of CORE_IDS) if (!ids.has(id)) errors.push(`core instrument missing: ${id}`);
  const coverage = snap.assets.length / opts.universeSize;
  if (coverage < opts.minCoverage) errors.push(`coverage ${(coverage * 100).toFixed(0)}% below ${(opts.minCoverage * 100).toFixed(0)}%`);
  else if (coverage < 1) warnings.push(`coverage ${(coverage * 100).toFixed(0)}% (${opts.universeSize - snap.assets.length} instruments missing)`);
  const spy = snap.assets.find((a) => a.meta.id === 'SPY');
  if (spy) {
    const ageDays = (opts.now.getTime() - Date.parse(spy.history.end)) / 86_400_000;
    if (ageDays > opts.maxStaleDays) errors.push(`stale data: SPY last bar ${spy.history.end} (${ageDays.toFixed(1)} days old)`);
  }
  for (const a of snap.assets) {
    const v = a.stats.vol1y;
    if (v !== null && (v < 0 || v > 5)) warnings.push(`${a.meta.id}: implausible volatility ${v}`);
    if (a.history.points < 60) warnings.push(`${a.meta.id}: short history (${a.history.points} points)`);
  }
  if (snap.models.length < 6) errors.push(`only ${snap.models.length} model portfolios built`);
  return { ok: errors.length === 0, errors, warnings };
}
