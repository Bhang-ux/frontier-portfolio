/**
 * Plain-English explanation engine.
 *
 * Deterministic natural-language generation: every sentence is a template
 * driven by thresholds on real numbers. No LLM, so explanations are free,
 * instant, offline, reproducible and unit-testable — and can never
 * hallucinate a number that the maths didn't produce.
 */

export type Currency = 'USD' | 'INR';

const nf = (digits: number, locale = 'en-US') =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${nf(digits).format(x * 100)}%`;
}

export function signedPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const s = nf(digits).format(Math.abs(x) * 100);
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${s}%`;
}

export function money(x: number | null | undefined, currency: Currency = 'USD', digits?: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const d = digits ?? (Math.abs(x) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
}

/** Compact money: $1.2M / ₹1.25 Cr / ₹12.4 L. Indian investors think in lakhs & crores. */
export function compactMoney(x: number | null | undefined, currency: Currency = 'USD'): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const sign = x < 0 ? '−' : '';
  const a = Math.abs(x);
  if (currency === 'INR') {
    if (a >= 1e7) return `${sign}₹${nf(a >= 1e9 ? 0 : 2, 'en-IN').format(a / 1e7)} Cr`;
    if (a >= 1e5) return `${sign}₹${nf(1, 'en-IN').format(a / 1e5)} L`;
    return `${sign}₹${nf(0, 'en-IN').format(a)}`;
  }
  if (a >= 1e9) return `${sign}$${nf(2).format(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}$${nf(2).format(a / 1e6)}M`;
  if (a >= 1e4) return `${sign}$${nf(1).format(a / 1e3)}K`;
  return `${sign}$${nf(0).format(a)}`;
}

export function number(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return nf(digits).format(x);
}

export type Level = 'very-low' | 'low' | 'moderate' | 'high' | 'very-high';

export interface Explanation {
  level?: Level;
  /** One-sentence "so what" for a beginner. */
  text: string;
}

export function explainVolatility(vol: number): Explanation {
  const level: Level = vol < 0.05 ? 'very-low' : vol < 0.1 ? 'low' : vol < 0.18 ? 'moderate' : vol < 0.3 ? 'high' : 'very-high';
  const feel = {
    'very-low': 'barely moves — closer to a savings account than the stock market',
    low: 'a gentle ride, typical of bond-heavy portfolios',
    moderate: 'a normal stock-market ride',
    high: 'a bumpy ride — bigger than the overall stock market',
    'very-high': 'a roller-coaster — single-stock or crypto territory',
  }[level];
  return {
    level,
    text: `In a typical year the value swings about ±${pct(vol, 0)} around its average: ${feel}.`,
  };
}

export function explainSharpe(sharpe: number): Explanation {
  const level: Level = sharpe < 0 ? 'very-low' : sharpe < 0.4 ? 'low' : sharpe < 0.8 ? 'moderate' : sharpe < 1.4 ? 'high' : 'very-high';
  const text = {
    'very-low': 'It earned less than cash — the risk taken was not rewarded at all.',
    low: 'Weak reward for the risk taken; safer options earned nearly as much.',
    moderate: 'A fair reward for the risk — in line with a broad stock index over the long run.',
    high: 'A strong reward for each unit of risk — better than most investors achieve.',
    'very-high': 'Exceptional reward for the risk. Rarely sustainable — expect this to cool off.',
  }[level];
  return { level, text };
}

export function explainDrawdown(dd: number, amount?: number, currency: Currency = 'USD'): Explanation {
  const level: Level = dd < 0.05 ? 'very-low' : dd < 0.15 ? 'low' : dd < 0.3 ? 'moderate' : dd < 0.5 ? 'high' : 'very-high';
  const example = amount ? ` — ${money(amount, currency, 0)} would have shrunk to ${money(amount * (1 - dd), currency, 0)}` : '';
  return { level, text: `At its worst it fell ${pct(dd, 0)} from a previous high${example}. That is the pain you must be ready to sit through.` };
}

export function explainVaR(var1d: number, amount: number, currency: Currency): Explanation {
  return { text: `On a bad day (1 day in 20) expect to lose at least ${pct(var1d, 1)} — about ${money(amount * var1d, currency, 0)} on ${money(amount, currency, 0)}.` };
}

export function explainCVaR(cvar1d: number, amount: number, currency: Currency): Explanation {
  return { text: `When those bad days happen, the average loss is ${pct(cvar1d, 1)} (≈ ${money(amount * cvar1d, currency, 0)}). This "expected shortfall" captures how bad the bad days really are.` };
}

export function explainBeta(beta: number, benchmark = 'the market'): Explanation {
  const level: Level = beta < 0.3 ? 'very-low' : beta < 0.8 ? 'low' : beta < 1.15 ? 'moderate' : beta < 1.6 ? 'high' : 'very-high';
  const text =
    beta < 0
      ? `Tends to move opposite to ${benchmark} — a natural hedge.`
      : `When ${benchmark} moves 10%, this tends to move about ${number(beta * 10, 0)}%${beta < 0.8 ? ' — calmer than the market' : beta > 1.2 ? ' — amplifying market swings' : ''}.`;
  return { level, text };
}

export function explainCagr(cagr: number, years: number, amount = 10_000, currency: Currency = 'USD'): Explanation {
  const end = amount * Math.pow(1 + cagr, years);
  return { text: `Grew ${pct(cagr)} a year on average — ${money(amount, currency, 0)} invested ${years >= 1 ? `${number(years, 0)} years` : 'a year'} ago would be about ${money(end, currency, 0)} today.` };
}

export function explainCorrelation(rho: number): Explanation {
  const level: Level = rho < 0 ? 'very-low' : rho < 0.3 ? 'low' : rho < 0.6 ? 'moderate' : rho < 0.85 ? 'high' : 'very-high';
  const text = {
    'very-low': 'They tend to move in opposite directions — excellent for diversification.',
    low: 'They mostly move independently — good diversification.',
    moderate: 'They often move together, offering some diversification.',
    high: 'They usually move together — limited diversification benefit.',
    'very-high': 'They move almost in lock-step — owning both is nearly owning one.',
  }[level];
  return { level, text };
}

export function explainDiversification(enb: number, holdings: number): Explanation {
  const level: Level = enb < 1.5 ? 'very-low' : enb < 2.5 ? 'low' : enb < 4 ? 'moderate' : enb < 6 ? 'high' : 'very-high';
  return {
    level,
    text:
      enb < 1.5
        ? `Although you own ${holdings} holding${holdings === 1 ? '' : 's'}, it behaves like a single bet — one hidden driver (usually "the stock market") explains almost all the risk.`
        : `Your ${holdings} holdings behave like about ${number(enb, 1)} truly independent bets.`,
  };
}

export function explainRiskVsMoney(name: string, weight: number, riskShare: number): string | null {
  if (riskShare > weight * 1.4 && riskShare > 0.15) return `${name} is ${pct(weight, 0)} of your money but ${pct(riskShare, 0)} of your risk.`;
  if (riskShare < weight * 0.6 && weight > 0.1) return `${name} is ${pct(weight, 0)} of your money but only ${pct(riskShare, 0)} of your risk — a stabiliser.`;
  return null;
}

export interface WeightChange {
  name: string;
  from: number;
  to: number;
  sharpe?: number;
  vol?: number;
  avgCorr?: number;
}

/** Why did the optimiser move money? One reason per material change. */
export function explainWeightChanges(changes: WeightChange[], threshold = 0.03): string[] {
  const out: string[] = [];
  const sorted = [...changes].sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  for (const c of sorted) {
    const d = c.to - c.from;
    if (Math.abs(d) < threshold) continue;
    let why = '';
    if (d > 0) {
      if (c.avgCorr !== undefined && c.avgCorr < 0.3) why = 'it moves differently from your other holdings, so it smooths the ride';
      else if (c.sharpe !== undefined && c.sharpe > 0.8) why = 'it has delivered strong returns for its level of risk';
      else if (c.vol !== undefined && c.vol < 0.1) why = 'it is low-risk and steadies the portfolio';
      else why = 'it improves the overall return-to-risk balance';
      out.push(`${c.from < 0.005 ? 'Add' : 'Increase'} ${c.name} (${pct(c.from, 0)} → ${pct(c.to, 0)}): ${why}.`);
    } else {
      if (c.vol !== undefined && c.vol > 0.35) why = 'it is very volatile and adds more risk than return';
      else if (c.avgCorr !== undefined && c.avgCorr > 0.7) why = 'it largely duplicates what your other holdings already do';
      else if (c.sharpe !== undefined && c.sharpe < 0.3) why = 'it has not paid enough for the risk it carries';
      else why = 'its risk is better spent elsewhere';
      out.push(`${c.to < 0.005 ? 'Remove' : 'Reduce'} ${c.name} (${pct(c.from, 0)} → ${pct(c.to, 0)}): ${why}.`);
    }
  }
  return out;
}

export function explainRegime(regime: 'calm' | 'turbulent', probability: number, market: string): string {
  const sure = probability > 0.9 ? 'clearly' : probability > 0.7 ? 'most likely' : 'probably';
  return regime === 'calm'
    ? `${market} is ${sure} in a calm regime (${pct(probability, 0)} confidence): daily moves are small and trends tend to persist.`
    : `${market} is ${sure} in a turbulent regime (${pct(probability, 0)} confidence): expect large daily swings. Historically a bad time to panic-sell and a good time to rebalance.`;
}

export function moodLabel(score: number): { label: string; key: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed' } {
  if (score < 20) return { label: 'Extreme fear', key: 'extreme-fear' };
  if (score < 40) return { label: 'Fear', key: 'fear' };
  if (score <= 60) return { label: 'Neutral', key: 'neutral' };
  if (score <= 80) return { label: 'Greed', key: 'greed' };
  return { label: 'Extreme greed', key: 'extreme-greed' };
}

export function explainMood(score: number, market: string): string {
  const { label } = moodLabel(score);
  if (score < 25) return `${market} sentiment: ${label.toLowerCase()}. Investors are scared — historically, long-term buyers have been rewarded for staying the course in moments like this.`;
  if (score < 45) return `${market} sentiment: ${label.toLowerCase()}. Caution is elevated; volatility is above normal.`;
  if (score <= 60) return `${market} sentiment: ${label.toLowerCase()}. No strong emotion either way.`;
  if (score <= 80) return `${market} sentiment: ${label.toLowerCase()}. Prices are rising with confidence — a good moment to check your portfolio hasn't drifted too far into stocks.`;
  return `${market} sentiment: ${label.toLowerCase()}. Optimism is running hot; this is when rebalancing discipline matters most.`;
}

/** Probability → human odds ("about 3 in 4"). */
export function odds(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p >= 0.985) return 'almost certainly';
  if (p <= 0.015) return 'almost never';
  const pairs: [number, string][] = [
    [0.05, '1 in 20'], [0.1, '1 in 10'], [0.2, '1 in 5'], [0.25, '1 in 4'], [0.33, '1 in 3'], [0.5, '1 in 2'],
    [0.67, '2 in 3'], [0.75, '3 in 4'], [0.8, '4 in 5'], [0.9, '9 in 10'], [0.95, '19 in 20'],
  ];
  let best = pairs[0];
  for (const pr of pairs) if (Math.abs(pr[0] - p) < Math.abs(best[0] - p)) best = pr;
  return `about ${best[1]}`;
}
