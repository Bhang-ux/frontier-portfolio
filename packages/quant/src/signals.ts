/**
 * Technical indicators and a transparent, rules-based "Trend & Momentum"
 * score. These *describe* recent price behaviour — they are not forecasts —
 * and every point of the score is attributable to a plain-English reason.
 */
import { std } from './stats';

export function sma(x: ArrayLike<number>, n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let t = 0; t < x.length; t++) {
    s += x[t];
    if (t >= n) s -= x[t - n];
    if (t >= n - 1) out[t] = s / n;
  }
  return out;
}

export function ema(x: ArrayLike<number>, n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let t = 0; t < x.length; t++) {
    if (t === n - 1) {
      let s = 0;
      for (let i = 0; i < n; i++) s += x[i];
      prev = s / n; // seed with SMA
      out[t] = prev;
    } else if (t >= n) {
      prev = x[t] * k + prev * (1 - k);
      out[t] = prev;
    }
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(prices: ArrayLike<number>, n = 14): number[] {
  const out = new Array<number>(prices.length).fill(NaN);
  if (prices.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let t = 1; t <= n; t++) {
    const d = prices[t] - prices[t - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let t = n + 1; t < prices.length; t++) {
    const d = prices[t] - prices[t - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[t] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(prices: ArrayLike<number>, fast = 12, slow = 26, signalN = 9) {
  const ef = ema(prices, fast);
  const es = ema(prices, slow);
  const line = ef.map((v, i) => v - es[i]);
  const firstValid = line.findIndex(Number.isFinite);
  const sig = new Array<number>(line.length).fill(NaN);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signalN);
    tail.forEach((v, i) => (sig[firstValid + i] = v));
  }
  return { line, signal: sig, histogram: line.map((v, i) => v - sig[i]) };
}

export function bollinger(prices: ArrayLike<number>, n = 20, k = 2) {
  const mid = sma(prices, n);
  const upper = new Array<number>(prices.length).fill(NaN);
  const lower = new Array<number>(prices.length).fill(NaN);
  const pctB = new Array<number>(prices.length).fill(NaN);
  for (let t = n - 1; t < prices.length; t++) {
    const w = Array.prototype.slice.call(prices, t - n + 1, t + 1) as number[];
    const sd = std(w, 0);
    upper[t] = mid[t] + k * sd;
    lower[t] = mid[t] - k * sd;
    pctB[t] = upper[t] > lower[t] ? (prices[t] - lower[t]) / (upper[t] - lower[t]) : 0.5;
  }
  return { mid, upper, lower, pctB };
}

export interface Technicals {
  price: number;
  sma50: number;
  sma200: number;
  rsi14: number;
  macdHistogram: number;
  bollingerPctB: number;
  /** 12-month return skipping the most recent month (Jegadeesh–Titman). */
  momentum12_1: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  high52: number;
  low52: number;
  fromHigh52: number; // ≤ 0
  vol20: number; // annualised
  vol252: number;
  volRatio: number;
  aboveSma200: boolean;
  aboveSma50: boolean;
  goldenCross: boolean; // sma50 > sma200
  trend: 'up' | 'down' | 'sideways';
}

/** Snapshot of indicators at the last bar. `ppy` = observations per year for this asset. */
export function technicals(prices: ArrayLike<number>, ppy = 252): Technicals | null {
  const T = prices.length;
  if (T < 60) return null;
  const last = prices[T - 1];
  const at = (k: number) => (T - 1 - k >= 0 ? prices[T - 1 - k] : NaN);
  const back = (days: number) => Math.round((days / 252) * ppy);
  const ret = (days: number) => {
    const p = at(back(days));
    return Number.isFinite(p) && p > 0 ? last / p - 1 : null;
  };
  const s50 = sma(prices, Math.min(50, T));
  const s200 = sma(prices, Math.min(200, T));
  const r = rsi(prices, 14);
  const m = macd(prices);
  const b = bollinger(prices, 20, 2);
  const yearWindow = Array.prototype.slice.call(prices, Math.max(0, T - back(252))) as number[];
  const high52 = Math.max(...yearWindow);
  const low52 = Math.min(...yearWindow);
  const dailyRets: number[] = [];
  for (let t = Math.max(1, T - back(252)); t < T; t++) dailyRets.push(prices[t] / prices[t - 1] - 1);
  const vol252 = std(dailyRets) * Math.sqrt(ppy);
  const vol20 = std(dailyRets.slice(-back(20))) * Math.sqrt(ppy);
  const sma50v = s50[T - 1];
  const sma200v = s200[T - 1];
  const p12 = at(back(252));
  const p1 = at(back(21));
  const momentum12_1 = Number.isFinite(p12) && Number.isFinite(p1) && p12 > 0 ? p1 / p12 - 1 : null;
  const aboveSma200 = last > sma200v;
  const aboveSma50 = last > sma50v;
  const goldenCross = sma50v > sma200v;
  const trend: Technicals['trend'] =
    aboveSma200 && goldenCross && aboveSma50
      ? 'up'
      : !aboveSma200 && !goldenCross && !aboveSma50
        ? 'down'
        : 'sideways';
  return {
    price: last,
    sma50: sma50v,
    sma200: sma200v,
    rsi14: r[T - 1],
    macdHistogram: m.histogram[T - 1],
    bollingerPctB: b.pctB[T - 1],
    momentum12_1,
    ret1m: ret(21),
    ret3m: ret(63),
    ret6m: ret(126),
    ret1y: ret(252),
    high52,
    low52,
    fromHigh52: high52 > 0 ? last / high52 - 1 : 0,
    vol20,
    vol252,
    volRatio: vol252 > 0 ? vol20 / vol252 : 1,
    aboveSma200,
    aboveSma50,
    goldenCross,
    trend,
  };
}

export type SignalLabel = 'strong' | 'positive' | 'neutral' | 'negative' | 'weak';

export interface SignalReason {
  key: string;
  tone: 'positive' | 'negative' | 'neutral';
  text: string;
}

export interface CompositeSignal {
  score: number; // 0–100
  label: SignalLabel;
  components: { trend: number; momentum: number; quality: number; stretch: number };
  reasons: SignalReason[];
}

/**
 * Combine indicators into a 0–100 score:
 *   40 % trend (price vs 50/200-day averages),
 *   30 % momentum (12-1 month return, ranked within its asset class),
 *   20 % quality (1-year Sharpe, ranked within its asset class),
 *   10 % stretch (penalises extreme RSI — overheated or capitulating).
 */
export function compositeSignal(
  t: Technicals,
  ranks: { momentum: number | null; sharpe: number | null },
): CompositeSignal {
  const reasons: SignalReason[] = [];
  const trendPts = (t.aboveSma200 ? 1 : 0) + (t.goldenCross ? 1 : 0) + (t.aboveSma50 ? 1 : 0);
  const trend = trendPts / 3;
  if (t.trend === 'up')
    reasons.push({
      key: 'trend-up',
      tone: 'positive',
      text: 'Price is above its 50- and 200-day averages — a healthy uptrend.',
    });
  else if (t.trend === 'down')
    reasons.push({
      key: 'trend-down',
      tone: 'negative',
      text: 'Price is below its 50- and 200-day averages — a downtrend.',
    });
  else if (t.aboveSma200)
    reasons.push({
      key: 'trend-mixed-up',
      tone: 'neutral',
      text: 'Long-term trend is up, but the short-term trend has weakened.',
    });
  else
    reasons.push({
      key: 'trend-mixed-down',
      tone: 'neutral',
      text: 'Below its 200-day average, though showing some short-term strength.',
    });

  const momentum = ranks.momentum ?? 0.5;
  if (ranks.momentum !== null) {
    if (momentum >= 0.75)
      reasons.push({
        key: 'mom-high',
        tone: 'positive',
        text: `Stronger 12-month momentum than ${Math.round(momentum * 100)}% of similar assets.`,
      });
    else if (momentum <= 0.25)
      reasons.push({
        key: 'mom-low',
        tone: 'negative',
        text: `Weaker 12-month momentum than ${Math.round((1 - momentum) * 100)}% of similar assets.`,
      });
  }
  const quality = ranks.sharpe ?? 0.5;
  if (ranks.sharpe !== null) {
    if (quality >= 0.75)
      reasons.push({
        key: 'sharpe-high',
        tone: 'positive',
        text: 'Among the best risk-adjusted returns in its group over the past year.',
      });
    else if (quality <= 0.25)
      reasons.push({
        key: 'sharpe-low',
        tone: 'negative',
        text: 'Poor risk-adjusted returns over the past year.',
      });
  }
  let stretch = 1;
  if (Number.isFinite(t.rsi14)) {
    if (t.rsi14 > 75) {
      stretch = 0.2;
      reasons.push({
        key: 'rsi-hot',
        tone: 'neutral',
        text: `RSI is ${t.rsi14.toFixed(0)} — overheated in the short term; pullbacks are common from here.`,
      });
    } else if (t.rsi14 < 25) {
      stretch = 0.4;
      reasons.push({
        key: 'rsi-cold',
        tone: 'neutral',
        text: `RSI is ${t.rsi14.toFixed(0)} — heavily sold off in the short term.`,
      });
    } else if (t.rsi14 > 65 || t.rsi14 < 35) stretch = 0.7;
  }
  if (t.volRatio > 1.5)
    reasons.push({
      key: 'vol-spike',
      tone: 'negative',
      text: 'Volatility has jumped well above its 1-year norm.',
    });
  if (t.fromHigh52 < -0.3)
    reasons.push({
      key: 'deep-dd',
      tone: 'negative',
      text: `Trading ${Math.round(-t.fromHigh52 * 100)}% below its 52-week high.`,
    });
  else if (t.fromHigh52 > -0.02)
    reasons.push({ key: 'near-high', tone: 'positive', text: 'Trading at or near its 52-week high.' });

  const score = Math.round(100 * (0.4 * trend + 0.3 * momentum + 0.2 * quality + 0.1 * stretch));
  const label: SignalLabel =
    score >= 75
      ? 'strong'
      : score >= 60
        ? 'positive'
        : score >= 40
          ? 'neutral'
          : score >= 25
            ? 'negative'
            : 'weak';
  return { score, label, components: { trend, momentum, quality, stretch }, reasons };
}
