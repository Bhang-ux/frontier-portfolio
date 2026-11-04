/**
 * Portfolio Health Score — a 0–100 composite that turns a dozen risk
 * statistics into one grade and a short list of concrete fixes.
 *
 * Each component maps a metric through a monotone piecewise-linear curve
 * (anchors chosen from widely used rules of thumb), so the score is
 * explainable line by line, stable to small input changes, and unit-tested.
 */

/** Piecewise-linear interpolation through (x, y) anchors (x ascending). */
export function curve(x: number, anchors: [number, number][]): number {
  if (!Number.isFinite(x)) return anchors[0][1];
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return anchors[anchors.length - 1][1];
}

export interface HealthInput {
  names: string[];
  weights: number[];
  assetClasses: string[];
  /** Percent risk contributions (sum to 1). */
  riskShare: number[];
  sharpe: number;
  volatility: number;
  maxDrawdown: number;
  enb: number;
  avgCorrelation: number;
  benchmark?: { sharpe: number; maxDrawdown: number; name: string };
  /** Target equity share from the investor's risk profile (0–1). */
  targetEquity?: number;
}

export type HealthStatus = 'good' | 'ok' | 'warn' | 'bad';

export interface HealthComponent {
  key: 'diversification' | 'concentration' | 'efficiency' | 'resilience' | 'balance';
  label: string;
  score: number;
  weight: number;
  status: HealthStatus;
  summary: string;
}

export interface HealthReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  headline: string;
  components: HealthComponent[];
  suggestions: string[];
}

const statusOf = (s: number): HealthStatus => (s >= 80 ? 'good' : s >= 60 ? 'ok' : s >= 40 ? 'warn' : 'bad');
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function portfolioHealth(h: HealthInput): HealthReport {
  const n = h.weights.length;
  const suggestions: string[] = [];
  const idxMaxW = h.weights.reduce((b, w, i) => (w > h.weights[b] ? i : b), 0);
  const idxMaxR = h.riskShare.reduce((b, r, i) => (r > h.riskShare[b] ? i : b), 0);
  const maxW = h.weights[idxMaxW] ?? 1;
  const maxR = h.riskShare[idxMaxR] ?? 1;

  // 1. Diversification — independent bets & correlation
  const divScore = 0.6 * curve(h.enb, [[1, 0], [2, 40], [3, 65], [5, 90], [7, 100]]) + 0.4 * curve(-h.avgCorrelation, [[-0.9, 20], [-0.7, 50], [-0.5, 75], [-0.3, 100]]);
  if (divScore < 60)
    suggestions.push(
      n <= 2
        ? 'Add more holdings from different asset classes — one or two assets leave you exposed to a single bad outcome.'
        : `Your holdings tend to move together (avg. correlation ${h.avgCorrelation.toFixed(2)}). Add something that zigs when stocks zag — high-quality bonds or gold.`,
    );

  // 2. Concentration — money and risk
  const concScore =
    0.5 * curve(maxW, [[0.15, 100], [0.25, 80], [0.4, 50], [0.6, 25], [1, 0]]) +
    0.5 * curve(maxR, [[0.2, 100], [0.35, 70], [0.5, 40], [0.8, 10], [1, 0]]);
  if (maxW > 0.35) suggestions.push(`${h.names[idxMaxW]} is ${pct(maxW)} of your money. Consider capping any single holding at 20–25%.`);
  else if (maxR > 0.4 && h.riskShare[idxMaxR] > h.weights[idxMaxR] * 1.5)
    suggestions.push(`${h.names[idxMaxR]} is only ${pct(h.weights[idxMaxR])} of your money but drives ${pct(maxR)} of your risk. Trimming it would smooth the ride.`);

  // 3. Efficiency — reward per unit of risk
  let effScore = curve(h.sharpe, [[-0.2, 0], [0, 25], [0.4, 55], [0.7, 75], [1, 90], [1.5, 100]]);
  if (h.benchmark) effScore = Math.max(0, Math.min(100, effScore + curve(h.sharpe - h.benchmark.sharpe, [[-0.5, -12], [0, 0], [0.5, 10]])));
  if (effScore < 50) suggestions.push('You are taking risk without being paid for it. The Optimizer can find a mix with a better return-to-risk trade-off.');

  // 4. Resilience — depth of the worst fall
  let resScore = curve(h.maxDrawdown, [[0.1, 100], [0.2, 80], [0.35, 55], [0.5, 30], [0.7, 5], [0.9, 0]]);
  if (h.benchmark && h.benchmark.maxDrawdown > 0) {
    const ratio = h.maxDrawdown / h.benchmark.maxDrawdown;
    resScore = Math.max(0, Math.min(100, resScore + curve(ratio, [[0.5, 10], [1, 0], [1.5, -15]])));
  }
  if (resScore < 45) suggestions.push(`At its worst this mix fell ${pct(h.maxDrawdown)}. Ask yourself honestly whether you would hold on through that — if not, add defensive assets.`);

  // 5. Balance — fit to the investor's profile & presence of diversifiers
  const share = (cls: string[]) => h.weights.reduce((s, w, i) => (cls.includes(h.assetClasses[i]) ? s + w : s), 0);
  const equity = share(['equity', 'real-estate']);
  const defensive = share(['bond', 'cash', 'commodity']);
  const crypto = share(['crypto']);
  let balScore: number;
  if (h.targetEquity !== undefined) {
    const gap = Math.abs(equity + crypto - h.targetEquity);
    balScore = curve(gap, [[0, 100], [0.1, 80], [0.2, 55], [0.35, 25], [0.6, 0]]);
    if (gap > 0.15)
      suggestions.push(
        equity + crypto > h.targetEquity
          ? `You hold ${pct(equity + crypto)} in growth assets, more than the ~${pct(h.targetEquity)} your risk profile suggests.`
          : `You hold only ${pct(equity + crypto)} in growth assets versus ~${pct(h.targetEquity)} for your profile — you may be leaving long-term growth on the table.`,
      );
  } else {
    balScore = defensive >= 0.1 ? 90 : equity > 0.95 ? 55 : 75;
  }
  if (crypto > 0.1) {
    balScore = Math.max(0, balScore - curve(crypto, [[0.1, 0], [0.25, 25], [0.5, 50]]));
    suggestions.push(`Crypto is ${pct(crypto)} of the portfolio. It can fall 70%+ — most guidelines keep it to 5% or less.`);
  }

  const components: HealthComponent[] = [
    { key: 'diversification', label: 'Diversification', score: divScore, weight: 0.25, status: statusOf(divScore), summary: `${h.enb.toFixed(1)} independent bets; holdings' average correlation ${h.avgCorrelation.toFixed(2)}.` },
    { key: 'concentration', label: 'Concentration', score: concScore, weight: 0.2, status: statusOf(concScore), summary: `Largest position ${pct(maxW)} of money; largest risk share ${pct(maxR)}.` },
    { key: 'efficiency', label: 'Return per unit of risk', score: effScore, weight: 0.2, status: statusOf(effScore), summary: `Sharpe ratio ${h.sharpe.toFixed(2)}${h.benchmark ? ` vs ${h.benchmark.sharpe.toFixed(2)} for ${h.benchmark.name}` : ''}.` },
    { key: 'resilience', label: 'Crash resilience', score: resScore, weight: 0.2, status: statusOf(resScore), summary: `Worst peak-to-trough fall ${pct(h.maxDrawdown)}${h.benchmark ? ` vs ${pct(h.benchmark.maxDrawdown)} for ${h.benchmark.name}` : ''}.` },
    { key: 'balance', label: 'Balance', score: balScore, weight: 0.15, status: statusOf(balScore), summary: `${pct(equity)} stocks & property, ${pct(defensive)} bonds/cash/commodities${crypto > 0 ? `, ${pct(crypto)} crypto` : ''}.` },
  ];
  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  const weakest = [...components].sort((a, b) => a.score - b.score)[0];
  const headline =
    grade === 'A'
      ? 'Excellent — well diversified with a sensible risk/return balance.'
      : grade === 'B'
        ? `Solid overall. Biggest opportunity: ${weakest.label.toLowerCase()}.`
        : grade === 'C'
          ? `Workable, but ${weakest.label.toLowerCase()} needs attention.`
          : `Needs work — start with ${weakest.label.toLowerCase()}.`;
  return { score, grade, headline, components, suggestions: suggestions.slice(0, 4) };
}
