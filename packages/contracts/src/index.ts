/**
 * The static "data API" contract.
 *
 * The pipeline publishes these JSON documents next to the web app on GitHub
 * Pages; the browser fetches them. Bumping SCHEMA_VERSION is a breaking change
 * that the web app checks at load time.
 *
 *   data/manifest.json          — tiny, polled every few minutes (what changed?)
 *   data/snapshot.<hash>.json   — everything the dashboards need (~50 KB gz)
 *   data/history/<id>.json      — full daily history per asset, lazy-loaded
 *   data/intraday.json          — 5-minute bars for headline instruments
 */

export const SCHEMA_VERSION = 1;

export type Currency = 'USD' | 'INR';
export type Region = 'US' | 'IN' | 'DEV' | 'EM' | 'GLOBAL';
export type AssetKind = 'etf' | 'stock' | 'index' | 'crypto' | 'fx' | 'rate' | 'future' | 'cash';
export type AssetClass =
  | 'equity'
  | 'bond'
  | 'commodity'
  | 'real-estate'
  | 'crypto'
  | 'cash'
  | 'currency'
  | 'volatility'
  | 'rate';

export interface AssetMeta {
  /** File-safe identifier (also the URL slug). */
  id: string;
  /** Yahoo Finance symbol (or a synthetic id for constructed assets). */
  symbol: string;
  name: string;
  short: string;
  kind: AssetKind;
  assetClass: AssetClass;
  region: Region;
  currency: Currency;
  sector?: string;
  /** One-line plain-English description for beginners. */
  description: string;
  /** Portfolio role in plain English, e.g. "Shock absorber". */
  role?: string;
  /** Can be held in a portfolio (indices, yields and VIX cannot). */
  investable: boolean;
  /** Id of a proxy used for stress tests before this asset existed. */
  proxy?: string;
  /** Benchmark id for beta/relative stats. */
  benchmark?: string;
  tags?: string[];
}

export interface Quote {
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  /** ISO timestamp of the last trade/print. */
  asOf: string;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
}

export interface Returns {
  d1: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
  m6: number | null;
  ytd: number | null;
  y1: number | null;
  /** annualised */
  y3: number | null;
  /** annualised */
  y5: number | null;
  /** annualised */
  y10: number | null;
}

export interface AssetStats {
  returns: Returns;
  vol1y: number | null;
  vol3y: number | null;
  sharpe1y: number | null;
  sharpe3y: number | null;
  sortino3y: number | null;
  maxDrawdown5y: number | null;
  maxDrawdownAll: number | null;
  currentDrawdown: number | null;
  beta: number | null;
  correlation: number | null;
  var95: number | null;
  cvar95: number | null;
  high52: number | null;
  low52: number | null;
  fromHigh52: number | null;
}

export interface Signals {
  score: number;
  label: 'strong' | 'positive' | 'neutral' | 'negative' | 'weak';
  trend: 'up' | 'down' | 'sideways';
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  momentum12_1: number | null;
  volRatio: number | null;
  components: { trend: number; momentum: number; quality: number; stretch: number };
  reasons: { key: string; tone: 'positive' | 'negative' | 'neutral'; text: string }[];
}

export interface AssetSnapshot {
  meta: AssetMeta;
  quote: Quote;
  stats: AssetStats;
  signals: Signals | null;
  /** Last ~90 daily closes for sparklines. */
  spark: number[];
  /** Plain-English one-paragraph summary generated from the numbers. */
  summary: string;
  history: { start: string; end: string; points: number; hash: string };
  source: 'yahoo' | 'stooq' | 'previous-deploy' | 'constructed' | 'synthetic';
}

export interface RegimeState {
  label: 'calm' | 'turbulent';
  meanAnnual: number;
  volAnnual: number;
  expectedDurationDays: number;
}

export interface RegimeInfo {
  market: string;
  benchmarkId: string;
  current: 'calm' | 'turbulent';
  probability: number;
  /** First day of the current regime (Viterbi path). */
  since: string;
  states: RegimeState[];
  /** Weekly-sampled filtered probability of the turbulent state. */
  history: { dates: string[]; turbulent: number[] };
  text: string;
}

export interface MoodComponent {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface MoodInfo {
  market: string;
  score: number;
  label: string;
  components: MoodComponent[];
  text: string;
}

export interface MarketSummary {
  key: 'US' | 'IN';
  name: string;
  benchmarkId: string;
  regime: RegimeInfo | null;
  mood: MoodInfo | null;
  breadth: { advancers: number; decliners: number; aboveSma50: number; aboveSma200: number; total: number };
  headline: string;
}

export interface ModelHolding {
  id: string;
  weight: number;
  riskShare: number;
  why: string;
}

export interface ModelPortfolio {
  id: string;
  region: 'US' | 'IN';
  currency: Currency;
  profile: 1 | 2 | 3 | 4 | 5;
  profileName: string;
  holdings: ModelHolding[];
  /** Backtest with monthly rebalancing over the available window. */
  backtest: {
    start: string;
    end: string;
    cagr: number;
    volatility: number;
    sharpe: number;
    maxDrawdown: number;
    worstYear: { year: number; ret: number } | null;
    bestYear: { year: number; ret: number } | null;
  };
  /** Annual arithmetic mean & vol used to seed Monte Carlo projections. */
  forward: { mu: number; sigma: number };
  method: string;
  summary: string;
}

export interface Snapshot {
  schemaVersion: number;
  generatedAt: string;
  synthetic: boolean;
  fx: { USDINR: { rate: number; changePct: number; asOf: string } };
  riskFree: Record<Currency, { rate: number; source: string; asOf: string }>;
  assets: AssetSnapshot[];
  markets: MarketSummary[];
  models: ModelPortfolio[];
  movers: { gainers: string[]; losers: string[] };
}

export interface HistoryFile {
  id: string;
  currency: Currency;
  /** First date (YYYY-MM-DD). */
  start: string;
  /** Day deltas; d[0] = 0, date[i] = date[i-1] + d[i]. */
  d: number[];
  /** Adjusted close, 6 significant digits. */
  c: number[];
}

export interface IntradayFile {
  generatedAt: string;
  series: Record<string, { t: number[]; p: number[]; previousClose: number; currency: Currency }>;
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  synthetic: boolean;
  snapshot: { file: string; hash: string; bytes: number };
  intraday: { file: string; hash: string } | null;
  histories: Record<string, { hash: string; end: string; points: number }>;
  pipeline: {
    durationMs: number;
    sources: Record<string, number>;
    failures: { id: string; reason: string }[];
    runId?: string;
    commit?: string;
  };
  /** Next scheduled refresh (approximate; GitHub cron can be delayed). */
  nextRefresh?: string;
}

export * from './codec';
