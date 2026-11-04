/**
 * Stress testing: replay real crises and apply hypothetical shocks.
 *
 * Historical replay values each holding at the scenario's start and end
 * dates (in the investor's base currency). Holdings that did not exist yet
 * are represented by a declared proxy (e.g. a new ETF by its index), and the
 * coverage of real vs proxied data is reported so results are never silently
 * fabricated.
 */
import { toEpochDay, valueAsOf, type Series } from './series';
import { simpleBeta } from './factors';

export interface Scenario {
  id: string;
  name: string;
  start: string;
  end: string;
  region: 'US' | 'IN' | 'GLOBAL';
  summary: string;
}

/** Peak-to-trough windows of the reference market for each episode. */
export const HISTORICAL_SCENARIOS: Scenario[] = [
  { id: 'gfc', name: 'Global Financial Crisis', start: '2007-10-09', end: '2009-03-09', region: 'GLOBAL', summary: 'US housing bust triggers a global banking crisis; Lehman Brothers collapses. Stocks lose over half their value.' },
  { id: 'euro-2011', name: 'Euro debt crisis & US downgrade', start: '2011-04-29', end: '2011-10-03', region: 'GLOBAL', summary: 'Fears of Greek default and the first-ever US credit downgrade hit stocks; Treasuries and gold rally.' },
  { id: 'taper-2013', name: 'Taper tantrum', start: '2013-05-22', end: '2013-06-24', region: 'GLOBAL', summary: 'The Fed hints at slowing bond purchases; bond prices and emerging markets fall, the rupee slides.' },
  { id: 'china-2015', name: 'China slowdown & oil crash', start: '2015-08-17', end: '2016-02-11', region: 'GLOBAL', summary: 'A surprise yuan devaluation and collapsing oil prices spark a global growth scare.' },
  { id: 'ilfs-2018', name: 'IL&FS / NBFC crisis', start: '2018-08-28', end: '2018-10-26', region: 'IN', summary: 'Defaults at infrastructure lender IL&FS freeze Indian credit markets; financials sell off.' },
  { id: 'q4-2018', name: 'Q4 2018 sell-off', start: '2018-09-20', end: '2018-12-24', region: 'US', summary: 'Rate hikes and US–China trade-war fears push US stocks to the edge of a bear market.' },
  { id: 'covid-2020', name: 'COVID-19 crash', start: '2020-02-19', end: '2020-03-23', region: 'GLOBAL', summary: 'The fastest bear market in history: global lockdowns send stocks down ~34% in 23 trading days.' },
  { id: 'inflation-2022', name: '2022 inflation & rate shock', start: '2022-01-03', end: '2022-10-12', region: 'GLOBAL', summary: 'The fastest rate hikes in 40 years hit stocks *and* bonds together — the classic 60/40 hedge fails.' },
  { id: 'tariff-2025', name: '2025 tariff shock', start: '2025-04-02', end: '2025-04-08', region: 'GLOBAL', summary: 'Sweeping US tariff announcements trigger one of the sharpest four-day drops on record.' },
];

export interface StressHolding {
  id: string;
  weight: number;
  /** Base-currency price series of the holding. */
  series: Series;
  /** Optional base-currency proxy series used when the holding has no data for the window. */
  proxy?: Series;
}

export interface StressResult {
  scenario: Scenario;
  portfolioReturn: number;
  /** Fraction of portfolio weight covered by the holding's own data. */
  coverage: number;
  /** Fraction covered by own data or proxy (rest excluded & weights renormalised). */
  totalCoverage: number;
  contributions: { id: string; ret: number | null; contribution: number; source: 'own' | 'proxy' | 'missing' }[];
}

function windowReturn(s: Series | undefined, start: number, end: number): number | null {
  if (!s || s.dates.length === 0) return null;
  // must have data at (or within 7 days before) the start
  if (s.dates[0] > start) return null;
  const a = valueAsOf(s, start);
  const b = valueAsOf(s, end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return b / a - 1;
}

export function historicalStress(holdings: StressHolding[], scenario: Scenario): StressResult {
  const start = toEpochDay(scenario.start);
  const end = toEpochDay(scenario.end);
  let own = 0;
  let covered = 0;
  const rows = holdings.map((h) => {
    const r = windowReturn(h.series, start, end);
    if (r !== null) {
      own += h.weight;
      covered += h.weight;
      return { id: h.id, ret: r, weight: h.weight, source: 'own' as const };
    }
    const pr = windowReturn(h.proxy, start, end);
    if (pr !== null) {
      covered += h.weight;
      return { id: h.id, ret: pr, weight: h.weight, source: 'proxy' as const };
    }
    return { id: h.id, ret: null, weight: h.weight, source: 'missing' as const };
  });
  const norm = covered > 0 ? 1 / covered : 0;
  const contributions = rows.map((r) => ({
    id: r.id,
    ret: r.ret,
    contribution: r.ret === null ? 0 : r.ret * r.weight * norm,
    source: r.source,
  }));
  return {
    scenario,
    portfolioReturn: contributions.reduce((s, c) => s + c.contribution, 0),
    coverage: own,
    totalCoverage: covered,
    contributions,
  };
}

export interface ShockSpec {
  id: string;
  name: string;
  /** Driver series id that receives the shock. */
  driver: string;
  shock: number;
  summary: string;
}

/**
 * Hypothetical shock via single-factor betas estimated on weekly returns:
 * impactᵢ = βᵢ · shock. Betas are clipped to [-3, 3] to tame noisy estimates.
 */
export function hypotheticalShock(
  holdings: { id: string; weight: number; weeklyReturns: number[] }[],
  driverWeekly: number[],
  shock: number,
): { portfolioImpact: number; rows: { id: string; beta: number; impact: number; r2: number }[] } {
  const rows = holdings.map((h) => {
    const n = Math.min(h.weeklyReturns.length, driverWeekly.length);
    if (n < 26) return { id: h.id, beta: 0, impact: 0, r2: 0 };
    const { beta, r2 } = simpleBeta(h.weeklyReturns.slice(-n), driverWeekly.slice(-n));
    const b = Math.max(-3, Math.min(3, beta));
    return { id: h.id, beta: b, impact: b * shock, r2 };
  });
  const total = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  return { portfolioImpact: rows.reduce((s, r, i) => s + (r.impact * holdings[i].weight) / total, 0), rows };
}

