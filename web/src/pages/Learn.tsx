import { BookOpen, Cpu, Database, GitBranch, Search, ShieldCheck, Workflow } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useManifest } from '@/lib/data';
import { useSettings } from '@/lib/store';
import { timeAgo } from '@/lib/format';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';

interface Term {
  term: string;
  tag: 'Basics' | 'Risk' | 'Optimisation' | 'Planning' | 'Markets';
  short: string;
  analogy?: string;
  detail: string;
  formula?: string;
}

const TERMS: Term[] = [
  { term: 'Index fund / ETF', tag: 'Basics', short: 'One purchase that owns hundreds of companies at once, for a tiny yearly fee.', analogy: 'Instead of betting on one horse, you own a slice of the whole race.', detail: 'Exchange-traded funds track an index (e.g. the Nifty 50 or S&P 500) and trade like shares. Low cost and broad diversification make them the best building blocks for most investors.' },
  { term: 'Diversification', tag: 'Basics', short: 'Spreading money across things that don’t all fall at the same time.', analogy: 'An umbrella seller and a sunglasses seller in one shop earn something whatever the weather.', detail: 'The risk of a mix is less than the average risk of its parts whenever correlations are below 1. It is the only “free lunch” in finance (Markowitz, 1952).', formula: 'σₚ² = Σᵢ Σⱼ wᵢ wⱼ σᵢ σⱼ ρᵢⱼ' },
  { term: 'Compound annual growth rate (CAGR)', tag: 'Basics', short: 'The steady yearly growth rate that gets you from the start value to the end value.', detail: 'Unlike a simple average of yearly returns, CAGR accounts for compounding — a +50% year followed by a −50% year is a 25% loss, not 0%.', formula: 'CAGR = (End / Start)^(1/years) − 1' },
  { term: 'Inflation & real returns', tag: 'Planning', short: 'Prices rise over time, so ₹100 tomorrow buys less than ₹100 today.', detail: 'A 7% return with 5% inflation is only about a 2% gain in purchasing power. Turn on “today’s money” in the Future planner to see real values.', formula: 'real ≈ (1 + nominal) / (1 + inflation) − 1' },
  { term: 'Volatility', tag: 'Risk', short: 'How much the value typically swings in a year.', analogy: 'A calm lake versus a stormy sea — both may end at the same place, but one is a much rougher ride.', detail: 'The annualised standard deviation of returns. Roughly two years in three fall within ±1 volatility of the average return. Frontier estimates it from daily data.', formula: 'σ_annual = σ_daily × √252' },
  { term: 'Drawdown', tag: 'Risk', short: 'How far the value has fallen from its previous peak.', analogy: 'Hiking: the drawdown is how far you are below the highest point you have already reached.', detail: 'Maximum drawdown is the deepest such fall. It is the statistic that best predicts whether an investor will panic and sell — size your risk so you could live through it.', formula: 'DDₜ = Vₜ / maxₛ≤ₜ Vₛ − 1' },
  { term: 'Value at Risk (VaR)', tag: 'Risk', short: 'A loss you only exceed on bad days — e.g. 1 day in 20.', detail: 'Frontier reports historical 1-day VaR at 95%, plus parametric and Cornish–Fisher versions (which adjust for skew and fat tails) in Pro mode.', formula: 'VaR₉₅ = −quantile₅%(r)' },
  { term: 'Expected shortfall (CVaR)', tag: 'Risk', short: 'The average loss on those bad days.', detail: 'VaR says where the bad days start; CVaR says how bad they are on average. It is the coherent risk measure preferred by regulators (Basel III) and can be optimised directly (Rockafellar & Uryasev, 2000).', formula: 'CVaR₉₅ = −E[r | r ≤ quantile₅%]' },
  { term: 'Sharpe ratio', tag: 'Risk', short: 'Return earned per unit of risk taken, after subtracting what cash pays.', analogy: 'Miles per gallon for investments.', detail: 'Above 1 is very good over long periods; a broad stock index historically sits around 0.3–0.6. The Sortino ratio is a variant that only penalises downside volatility.', formula: 'Sharpe = (R − r_f) / σ' },
  { term: 'Beta', tag: 'Risk', short: 'How strongly something moves with the overall market.', detail: 'Beta 1.3 means a 10% market move tends to come with a 13% move in the asset. Frontier estimates betas on weekly returns, which avoids distortions from markets closing at different times.', formula: 'β = Cov(r, r_m) / Var(r_m)' },
  { term: 'Correlation', tag: 'Risk', short: 'Whether two assets tend to move together (+1), independently (0) or oppositely (−1).', detail: 'The heart of diversification. Correlations rise in crises — exactly when you need diversification most — which is why stress tests matter.' },
  { term: 'Effective number of bets', tag: 'Risk', short: 'How many genuinely independent sources of risk your portfolio holds.', detail: 'Ten tech stocks are closer to one bet than ten. Meucci’s ENB applies principal-component analysis to the covariance matrix and measures the entropy of the risk spread across uncorrelated components.', formula: 'ENB = exp(−Σ pₖ ln pₖ)' },
  { term: 'Factor exposure', tag: 'Risk', short: 'Which broad forces (market, size, value, rates…) actually drive your returns.', detail: 'A regression of your portfolio on factor returns. Frontier builds factors from liquid ETF spreads (e.g. small caps minus large caps) so they refresh daily.' },
  { term: 'Efficient frontier', tag: 'Optimisation', short: 'The set of portfolios with the best possible return for each level of risk.', detail: 'Anything below the curve is inefficient: you could earn more for the same risk. The line from the risk-free rate that just touches the frontier (the capital market line) marks the tangency, or maximum-Sharpe, portfolio.' },
  { term: 'Mean–variance optimisation', tag: 'Optimisation', short: 'Choosing weights to trade off expected return against risk.', detail: 'Frontier solves the constrained problem with an accelerated projected-gradient method over the exact capped-simplex projection, validated against CVXPY. Its weakness: it maximises estimation error, so inputs must be estimated robustly.', formula: 'max_w  μᵀw − (λ/2) wᵀΣw  s.t. Σw = 1, l ≤ w ≤ u' },
  { term: 'Ledoit–Wolf shrinkage', tag: 'Optimisation', short: 'A smarter way to estimate how assets move together from limited data.', detail: 'Blends the noisy sample covariance with a simple structured target (constant correlation) using the statistically optimal weight. Dramatically stabilises optimised portfolios.', formula: 'Σ̂ = δF + (1 − δ)S' },
  { term: 'Bayes–Stein shrinkage', tag: 'Optimisation', short: 'Pulls each asset’s historical return towards a common average to reduce noise.', detail: 'Historical average returns are extremely noisy — a decade is barely enough to tell a 6% asset from a 10% one. Jorion’s (1986) estimator shrinks them towards the minimum-variance portfolio’s return.' },
  { term: 'Black–Litterman', tag: 'Optimisation', short: 'Blend market-implied returns with your own views, weighted by confidence.', detail: 'Start from equilibrium returns implied by a reference portfolio, then update them with views (“A beats B by 2%”) in a Bayesian way. Produces intuitive, well-diversified portfolios.', formula: 'μ_BL = π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − Pπ)' },
  { term: 'Risk parity', tag: 'Optimisation', short: 'Size each holding so all contribute the same amount of risk.', detail: 'Needs no return forecasts — only risk estimates — so it is robust. Solved with Spinu’s convex formulation by cyclical coordinate descent.', formula: 'wᵢ (Σw)ᵢ = σₚ² / n' },
  { term: 'Hierarchical risk parity (HRP)', tag: 'Optimisation', short: 'Groups similar assets into a family tree, then splits risk between branches.', detail: 'López de Prado’s (2016) method uses clustering instead of matrix inversion, so it never blows up on near-duplicate assets and tends to hold up well out of sample.' },
  { term: 'Walk-forward backtest', tag: 'Optimisation', short: 'Testing a strategy using only data that would have been available at the time.', detail: 'At each rebalance date the strategy sees only the past, chooses weights, and is judged on the future. The honest way to compare methods — in-sample, every optimiser looks perfect.' },
  { term: 'Monte Carlo simulation', tag: 'Planning', short: 'Simulating thousands of possible futures to see the range of outcomes.', detail: 'Frontier supports normal returns, fat-tailed Student-t returns and a stationary block bootstrap of your portfolio’s own history, with contributions, step-ups, fees, inflation and withdrawals.' },
  { term: 'SIP (systematic investment plan)', tag: 'Planning', short: 'Investing a fixed amount every month, automatically.', detail: 'Removes timing decisions and emotions, and buys more units when prices are low (rupee/dollar-cost averaging). Consistency matters more than the starting amount.' },
  { term: 'Rebalancing', tag: 'Planning', short: 'Periodically restoring your target mix.', detail: 'Keeps risk from drifting and enforces “buy low, sell high”. The Strategy lab compares calendar and threshold rules on your own portfolio, after costs.' },
  { term: 'Market regime', tag: 'Markets', short: 'Whether the market is currently in a calm or a turbulent state.', detail: 'A two-state Gaussian Hidden Markov Model, fitted with the Baum–Welch algorithm, infers the hidden state from daily returns. Frontier reports filtered (real-time) probabilities to avoid look-ahead bias.' },
  { term: 'Momentum & trend', tag: 'Markets', short: 'Assets that have risen recently have tended to keep rising for a while.', detail: 'One of the most documented market anomalies (Jegadeesh & Titman, 1993). Frontier’s trend score combines moving-average trend, 12-1 month momentum, risk-adjusted return and an overheating check. It describes, it does not predict.' },
];

const TAGS = ['All', 'Basics', 'Risk', 'Optimisation', 'Planning', 'Markets'] as const;

function Arch({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <div className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold text-ink">{icon}{title}</div>
      <div className="text-[13px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

export default function LearnPage() {
  const pro = useSettings((s) => s.mode) === 'pro';
  const manifest = useManifest().data;
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<(typeof TAGS)[number]>('All');
  const list = useMemo(() => TERMS.filter((t) => (tag === 'All' || t.tag === tag) && `${t.term} ${t.short} ${t.detail}`.toLowerCase().includes(q.toLowerCase())), [q, tag]);
  return (
    <div>
      <PageHeader eyebrow="Learn" title={<>Investing, <span className="gradient-text">explained</span></>} subtitle="Every concept Frontier uses, in plain English first — with the maths underneath when you switch to Pro mode." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input !pl-9" placeholder="Search concepts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search glossary" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button key={t} onClick={() => setTag(t)} className={t === tag ? 'chip !border-accent !bg-accent-soft !text-ink' : 'chip hover:!text-ink'} aria-pressed={t === tag}>{t}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <Card key={t.term} className="card-pad" as="article">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{t.term}</h2>
              <span className="chip shrink-0">{t.tag}</span>
            </div>
            <p className="text-[14px] font-medium leading-snug text-ink">{t.short}</p>
            {t.analogy && <p className="mt-2 text-[13px] italic leading-snug text-ink-2">{t.analogy}</p>}
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{t.detail}</p>
            {pro && t.formula && <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink-2">{t.formula}</p>}
          </Card>
        ))}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card className="card-pad">
          <CardHeader title="How Frontier works" subtitle="A serverless, zero-cost architecture that refreshes itself." icon={<Workflow size={16} className="text-accent" />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Arch icon={<GitBranch size={15} className="text-accent" />} title="1 · Scheduled pipeline">GitHub Actions runs a TypeScript ETL on a cron schedule: it downloads ~100 instruments from Yahoo Finance and FRED, cleans them, and computes statistics, signals, regimes and model portfolios.</Arch>
            <Arch icon={<ShieldCheck size={15} className="text-accent" />} title="2 · Validation gate">A schema and freshness check must pass before anything is published. If an upstream source breaks, the live site simply keeps its last good data.</Arch>
            <Arch icon={<Database size={15} className="text-accent" />} title="3 · Static data API">Results are published as content-hashed JSON next to the app on GitHub Pages’ CDN. Your browser polls a tiny manifest and only downloads what changed.</Arch>
            <Arch icon={<Cpu size={15} className="text-accent" />} title="4 · In-browser quant engine">Optimisation, simulation and backtests run in a Web Worker on your device with the same zero-dependency TypeScript engine the pipeline uses — so your portfolio never leaves your computer.</Arch>
          </div>
          {manifest && (
            <p className="mt-4 text-xs text-ink-3">
              Current dataset: generated {timeAgo(manifest.generatedAt)} in {(manifest.pipeline.durationMs / 1000).toFixed(1)}s · sources {Object.entries(manifest.pipeline.sources).map(([k, v]) => `${k} ${v}`).join(', ')}{manifest.pipeline.failures.length ? ` · ${manifest.pipeline.failures.length} instruments temporarily unavailable` : ''}.
            </p>
          )}
        </Card>
        <Card className="card-pad">
          <CardHeader title="Methodology notes" icon={<BookOpen size={16} className="text-accent" />} />
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
            <li>Prices are dividend- and split-adjusted (total return). Holdings in another currency are converted daily using USD/INR.</li>
            <li>Markets are aligned on a weekday calendar with forward-filled holidays; annualisation uses the calendar actually observed.</li>
            <li>Risk-free rates: US 13-week T-bill and India’s 3-month interbank rate (FRED/OECD).</li>
            <li>Covariances default to Ledoit–Wolf shrinkage; expected returns default to Bayes–Stein shrinkage.</li>
            <li>Every algorithm is unit-tested against Python reference implementations (scikit-learn, PyPortfolioOpt, CVXPY).</li>
            <li>Model portfolios are forecast-free: the risk profile sets the stock/bond/gold split and risk is equalised within each sleeve.</li>
          </ul>
          <p className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-3">
            <strong className="text-ink-2">Important:</strong> Frontier is an educational tool. Nothing here is investment, tax or legal advice, or a recommendation to buy or sell any security. Past performance does not guarantee future results. Consider speaking to a registered adviser.
          </p>
        </Card>
      </div>
    </div>
  );
}
