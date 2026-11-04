import { Copy, FilePlus2, Link2, Target, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { Currency } from '@frontier/contracts';
import { explain } from '@frontier/quant';
import { useMarketData, type MarketData } from '@/lib/data';
import { useDebounced } from '@/lib/hooks';
import {
  BENCHMARK,
  FACTORS,
  SHOCKS,
  assetInfo,
  decodePortfolio,
  normalized,
  shareUrl,
  useSeriesInputs,
} from '@/lib/portfolio';
import { EXAMPLES, usePortfolios, useSettings, type Portfolio } from '@/lib/store';
import { useAnalysis } from '@/lib/worker';
import {
  CLASS_LABEL,
  OTHER_COLOR,
  classColor,
  compactMoney,
  money,
  number,
  pct,
  seriesColor,
  signedPct,
} from '@/lib/format';
import type { AnalyzeRequest, AnalyzeResult } from '@/workers/quant.worker';
import {
  BarList,
  ChartCard,
  Donut,
  Heatmap,
  Histogram,
  DivergingLegend,
  type Slice,
} from '@/components/charts/charts';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import {
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Segmented,
  Skeleton,
  Stat,
  cx,
} from '@/components/ui/primitives';
import { DataState, SectionTitle } from '@/components/domain/common';
import { HoldingsEditor } from '@/components/portfolio/HoldingsEditor';
import { HealthCard } from '@/components/portfolio/HealthCard';

export const COV_LABEL: Record<string, string> = {
  'ledoit-wolf': 'Ledoit–Wolf (constant-correlation) shrinkage',
  'ledoit-wolf-identity': 'Ledoit–Wolf (identity) shrinkage',
  sample: 'the sample covariance',
  ewma: 'EWMA (λ = 0.94)',
  denoised: 'random-matrix denoising',
};

export const LOOKBACKS = [
  { value: 1, label: '1Y' },
  { value: 3, label: '3Y' },
  { value: 5, label: '5Y' },
  { value: 10, label: '10Y' },
  { value: 0, label: 'Max' },
];

export default function PortfolioPage() {
  const md = useMarketData();
  return (
    <DataState isLoading={md.isLoading} error={md.error}>
      {md.data && <PortfolioView data={md.data} />}
    </DataState>
  );
}

function useSharedImport() {
  const create = usePortfolios((s) => s.create);
  useEffect(() => {
    const m = location.hash.match(/#p=([^&]+)/);
    if (!m) return;
    const p = decodePortfolio(m[1]);
    history.replaceState(null, '', location.pathname);
    if (p) {
      create(p);
      toast.success('Shared portfolio imported', { description: p.name });
    } else toast.error('That share link is invalid or damaged.');
  }, [create]);
}

function Toolbar({ p }: { p: Portfolio }) {
  const { portfolios, select, create, duplicate, remove, update } = usePortfolios();
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input !w-auto max-w-[240px] !py-1.5"
        value={p.id}
        onChange={(e) => select(e.target.value)}
        aria-label="Choose portfolio"
      >
        {portfolios.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      {renaming ? (
        <input
          autoFocus
          className="input !w-56 !py-1.5"
          defaultValue={p.name}
          onBlur={(e) => {
            update(p.id, { name: e.target.value.trim() || p.name });
            setRenaming(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Portfolio name"
        />
      ) : (
        <button className="btn-quiet !px-2.5 !py-1.5 text-[13px]" onClick={() => setRenaming(true)}>
          Rename
        </button>
      )}
      <button
        className="btn-quiet !px-2.5 !py-1.5 text-[13px]"
        onClick={() =>
          create({ ...EXAMPLES[p.currency], name: 'New portfolio', origin: 'custom', holdings: [] })
        }
        title="New portfolio"
      >
        <FilePlus2 size={15} /> New
      </button>
      <button
        className="btn-quiet !px-2.5 !py-1.5 text-[13px]"
        onClick={() => duplicate(p.id)}
        title="Duplicate"
      >
        <Copy size={15} />
      </button>
      <button
        className="btn-quiet !px-2.5 !py-1.5 text-[13px]"
        onClick={async () => {
          const url = shareUrl(p);
          try {
            await navigator.clipboard.writeText(url);
            toast.success('Share link copied', {
              description: 'Anyone with the link can open a copy of this portfolio. Nothing is uploaded.',
            });
          } catch {
            prompt('Copy this link:', url);
          }
        }}
        title="Copy share link"
      >
        <Link2 size={15} /> Share
      </button>
      <button
        className="btn-quiet !px-2.5 !py-1.5 text-[13px] hover:!text-neg"
        onClick={() => confirm(`Delete “${p.name}”?`) && remove(p.id)}
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function PortfolioView({ data }: { data: MarketData }) {
  useSharedImport();
  const p = usePortfolios((s) => s.active());
  const { setHoldings, update } = usePortfolios();
  const { lookback, covariance, profile, set } = useSettings();
  const holdings = useDebounced(p.holdings, 350);
  const amount = useDebounced(p.amount, 350);
  const base: Currency = p.currency;
  const bench = BENCHMARK[base];
  const factorDefs = FACTORS[base];
  // Derive everything the analysis needs once per (holdings, data, currency) change.
  const { valid, shockDefs, factorIds, ids } = useMemo(() => {
    const valid = normalized(holdings).filter((h) => data.assets.has(h.id));
    const shockDefs = SHOCKS[base].filter((s) => data.assets.has(s.id));
    const proxyIds = valid
      .map((h) => data.assets.get(h.id)?.meta.proxy)
      .filter((x): x is string => !!x && data.assets.has(x));
    const factorIds = [
      ...new Set(
        FACTORS[base].flatMap((f) => [f.long, f.short]).filter((x): x is string => !!x && data.assets.has(x)),
      ),
    ];
    const ids = [
      ...new Set([
        ...valid.map((h) => h.id),
        BENCHMARK[base].id,
        ...proxyIds,
        ...factorIds,
        ...shockDefs.map((s) => s.id),
      ]),
    ];
    return { valid, shockDefs, factorIds, ids };
  }, [holdings, data.assets, base]);
  const inputs = useSeriesInputs(ids, data.assets, base);
  const rf = data.snapshot.riskFree[base].rate;

  const req = useMemo<AnalyzeRequest | null>(() => {
    if (!inputs.ready || valid.length === 0) return null;
    const metaOf = (id: string) => data.assets.get(id)!;
    const proxies: AnalyzeRequest['proxies'] = {};
    for (const h of valid) {
      const pid = metaOf(h.id).meta.proxy;
      if (pid && inputs.inputs[pid]) proxies[h.id] = inputs.inputs[pid];
    }
    return {
      assets: valid.map((h) => inputs.inputs[h.id]),
      info: valid.map((h) => assetInfo(metaOf(h.id))),
      weights: valid.map((h) => h.weight),
      base,
      fx: inputs.fx,
      benchmark: valid.length === 1 && valid[0].id === bench.id ? undefined : inputs.inputs[bench.id],
      benchmarkName: bench.name,
      lookbackYears: lookback,
      riskFree: rf,
      amount,
      covariance,
      proxies,
      factorSeries: factorIds.map((id) => inputs.inputs[id]).filter(Boolean),
      factors: factorDefs,
      shockDrivers: shockDefs.map((s) => ({ ...s, series: inputs.inputs[s.id] })),
      targetEquity: profile ? [0.25, 0.4, 0.6, 0.75, 0.9][profile.level - 1] : undefined,
    };
  }, [
    inputs,
    valid,
    data.assets,
    base,
    bench,
    lookback,
    rf,
    amount,
    covariance,
    factorIds,
    factorDefs,
    shockDefs,
    profile,
  ]);
  const analysis = useAnalysis(req);

  const switchCurrency = (c: Currency) => {
    if (c === p.currency) return;
    const fx = data.snapshot.fx.USDINR.rate;
    update(p.id, { currency: c, amount: c === 'INR' ? p.amount * fx : p.amount / fx });
  };

  return (
    <div>
      <PageHeader
        eyebrow="My portfolio"
        title={p.name}
        subtitle={
          analysis.data
            ? `${valid.length} holdings · ${money(p.amount, base, 0)} · analysed over ${number(analysis.data.window.years, 1)} years (${analysis.data.window.start} → ${analysis.data.window.end}), in ${base}.`
            : 'Add what you own (or want to own) and Frontier analyses it with the same tools institutions use.'
        }
        right={<Toolbar p={p} />}
      />
      {p.origin === 'example' && (
        <div className="mb-4">
          <Callout title="This is an example portfolio">
            Edit the holdings below to match yours, or{' '}
            <Link className="font-semibold text-accent underline-offset-2 hover:underline" to="/start">
              answer 7 questions
            </Link>{' '}
            to get a portfolio built for you.
          </Callout>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
        <Card className="card-pad">
          <CardHeader
            title="Holdings"
            subtitle="Weights are shares of your total money."
            right={
              <div className="flex flex-wrap gap-2">
                <Segmented
                  size="sm"
                  label="Portfolio currency"
                  value={base}
                  onChange={switchCurrency}
                  options={[
                    { value: 'INR', label: '₹' },
                    { value: 'USD', label: '$' },
                  ]}
                />
              </div>
            }
          />
          <HoldingsEditor
            holdings={p.holdings}
            assets={data.assets}
            amount={p.amount}
            currency={base}
            onChange={(h) => setHoldings(p.id, h)}
            onAmount={(v) => update(p.id, { amount: v })}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-ink-3">
              History window
              <Segmented
                size="sm"
                label="History window"
                value={lookback}
                onChange={(v) => set({ lookback: v })}
                options={LOOKBACKS}
              />
            </div>
            <Link to="/optimize" className="btn-primary !py-1.5 text-[13px]">
              <Target size={15} /> Optimise this portfolio
            </Link>
          </div>
        </Card>
        {analysis.data ? <HealthCard h={analysis.data.health} /> : <Skeleton className="h-[420px]" />}
      </div>

      {valid.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            title="No holdings yet"
            action={
              <Link className="btn-primary" to="/start">
                Build one for me
              </Link>
            }
          >
            Add assets with the button above — try a broad index fund like the Nifty 50 or S&P 500 ETF to
            start.
          </EmptyState>
        </Card>
      ) : analysis.error ? (
        <Card className="mt-4 card-pad">
          <Callout tone="warn" title="Could not analyse this mix">
            {analysis.error.message}
          </Callout>
        </Card>
      ) : !analysis.data ? (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <div className={cx('transition-opacity', analysis.isFetching && 'opacity-60')}>
          <Results a={analysis.data} p={p} data={data} valid={valid} base={base} benchName={bench.name} />
        </div>
      )}
    </div>
  );
}

function summaryParagraph(
  a: AnalyzeResult,
  p: Portfolio,
  base: Currency,
  benchName: string,
  names: Map<string, string>,
): string[] {
  const m = a.metrics;
  const bm = a.benchmarkMetrics;
  const out: string[] = [];
  const end = p.amount * Math.pow(1 + m.cagr, a.window.years);
  out.push(
    `Over the last ${number(a.window.years, 1)} years this mix grew ${pct(m.cagr)} a year${bm ? ` (${benchName}: ${pct(bm.cagr)})` : ''} — ${money(p.amount, base, 0)} held throughout would have become about ${money(end, base, 0)}.`,
  );
  out.push(explain.explainVolatility(m.volatility).text);
  out.push(
    `The deepest fall was ${pct(m.maxDrawdown, 0)}${bm ? ` vs ${pct(bm.maxDrawdown, 0)} for ${benchName}` : ''}.`,
  );
  const top = a.perAsset.reduce((b, x) => (x.riskShare > b.riskShare ? x : b), a.perAsset[0]);
  const rv = explain.explainRiskVsMoney(names.get(top.id) ?? top.id, top.weight, top.riskShare);
  if (rv) out.push(rv);
  out.push(explain.explainDiversification(a.risk.enb, a.perAsset.length).text);
  return out;
}

function Results({
  a,
  p,
  data,
  valid,
  base,
  benchName,
}: {
  a: AnalyzeResult;
  p: Portfolio;
  data: MarketData;
  valid: { id: string; weight: number }[];
  base: Currency;
  benchName: string;
}) {
  const m = a.metrics;
  const bm = a.benchmarkMetrics;
  const names = new Map(valid.map((h) => [h.id, data.assets.get(h.id)?.meta.short ?? h.id]));
  const [rollKey, setRollKey] = useState<'vol' | 'sharpe' | 'beta'>('vol');
  const fmtM = (v: number) => compactMoney(v, base);
  const sortedHold = [...valid].sort((x, y) => y.weight - x.weight);
  const slices: Slice[] = sortedHold
    .slice(0, 7)
    .map((h, i) => ({ key: h.id, label: names.get(h.id)!, value: h.weight, color: seriesColor(i) }));
  const rest = sortedHold.slice(7).reduce((s, h) => s + h.weight, 0);
  if (rest > 0) slices.push({ key: 'other', label: 'Other', value: rest, color: OTHER_COLOR });
  const byClass = new Map<string, number>();
  valid.forEach((h) => {
    const c = data.assets.get(h.id)!.meta.assetClass;
    byClass.set(c, (byClass.get(c) ?? 0) + h.weight);
  });
  const varMoney = m.varHistorical * p.amount;
  const years = [...new Set(a.monthly.map((r) => r.year))].sort();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yearlyMap = new Map(a.yearly.map((y) => [y.year, y.ret]));
  const cal = years.map((y) => [
    ...months.map((_, mo) => a.monthly.find((r) => r.year === y && r.period === mo)?.ret ?? null),
    yearlyMap.get(y) ?? null,
  ]);
  const roll =
    rollKey === 'vol' ? a.rolling.vol : rollKey === 'sharpe' ? a.rolling.sharpe : (a.rolling.beta ?? []);

  return (
    <>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card className="card-pad">
          <CardHeader title="In plain English" subtitle="What the numbers below mean for you." />
          <ul className="space-y-2.5 text-[14px] leading-relaxed text-ink-2">
            {summaryParagraph(a, p, base, benchName, names).map((s) => (
              <li key={s} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Annual return"
            value={pct(m.cagr)}
            sub={bm ? `${benchName}: ${pct(bm.cagr)}` : 'compound, per year'}
            explain={explain.explainCagr(m.cagr, Math.min(a.window.years, 5), 10_000, base).text}
            info="Compound annual growth rate (CAGR): the constant yearly return that would turn the starting value into the ending value."
          />
          <Stat
            label="Volatility"
            value={pct(m.volatility)}
            sub="typical yearly swing"
            explain={explain.explainVolatility(m.volatility).text}
            info="Annualised standard deviation of daily returns. About 2 years in 3 land within ±1 volatility of the average return."
          />
          <Stat
            label="Sharpe ratio"
            value={number(m.sharpe)}
            sub={bm ? `${benchName}: ${number(bm.sharpe)}` : 'return per unit of risk'}
            explain={explain.explainSharpe(m.sharpe).text}
            info="(Return − risk-free rate) ÷ volatility. Above 1 is very good; below 0 means cash did better."
          />
          <Stat
            label="Worst fall"
            value={pct(-m.maxDrawdown)}
            tone="neg"
            sub={bm ? `${benchName}: ${pct(-bm.maxDrawdown)}` : 'maximum drawdown'}
            explain={explain.explainDrawdown(m.maxDrawdown, p.amount, base).text}
            info="The largest peak-to-trough decline over the period — the most painful stretch an investor would have lived through."
          />
          <Stat
            label="Bad-day loss (VaR 95%)"
            value={money(varMoney, base, 0)}
            sub={`${pct(m.varHistorical, 2)} of value`}
            explain={explain.explainVaR(m.varHistorical, p.amount, base).text}
            info="Historical 1-day Value at Risk: on 95% of days the loss was smaller than this."
          />
          <Stat
            label="Expected shortfall"
            value={pct(m.cvarHistorical, 2)}
            sub="avg. loss on the worst 5% of days"
            explain={explain.explainCVaR(m.cvarHistorical, p.amount, base).text}
            info="Conditional VaR (CVaR): the average loss on the days that breach VaR. Captures tail risk that VaR ignores."
          />
          <Stat
            label={`Beta vs ${benchName}`}
            value={m.beta !== null ? number(m.beta) : '—'}
            sub={m.correlation !== null ? `correlation ${number(m.correlation)}` : undefined}
            explain={m.beta !== null ? explain.explainBeta(m.beta, benchName).text : undefined}
            info="Sensitivity to the benchmark: beta 1.2 means the portfolio tends to move 1.2% for every 1% move in the market."
          />
          <Stat
            label="Independent bets"
            value={number(a.risk.enb, 1)}
            sub={`of ${valid.length} holdings`}
            explain={explain.explainDiversification(a.risk.enb, valid.length).text}
            info="Effective Number of Bets (Meucci 2009): how many truly independent sources of risk the portfolio contains, from a PCA of the covariance matrix."
          />
        </div>
      </div>

      <SectionTitle>Performance</SectionTitle>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Growth of ${compactMoney(p.amount, base)}`}
          subtitle={`Your mix vs ${benchName}, rebalanced daily to your target weights.`}
          table={{
            columns: ['Date', 'Portfolio', benchName],
            rows: a.equity.dates
              .filter((_, i) => i % 20 === 0)
              .map((d, k) => [
                new Date(d * 86_400_000).toISOString().slice(0, 10),
                money(a.equity.portfolio[k * 20], base, 0),
                a.equity.benchmark ? money(a.equity.benchmark[k * 20], base, 0) : '—',
              ]),
          }}
        >
          <TimeSeriesChart
            ariaLabel="Portfolio growth versus benchmark"
            dates={a.equity.dates}
            height={280}
            yFormat={fmtM}
            tooltipFormat={(v) => money(v, base, 0)}
            series={[
              {
                key: 'p',
                label: 'Your portfolio',
                values: a.equity.portfolio,
                color: 'var(--s1)',
                area: true,
              },
              ...(a.equity.benchmark
                ? [{ key: 'b', label: benchName, values: a.equity.benchmark, color: 'var(--s2)' }]
                : []),
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Drawdowns"
          subtitle="How far below its previous peak the portfolio was at each moment."
          table={{
            columns: ['Date', 'Portfolio'],
            rows: a.drawdown.dates
              .filter((_, i) => i % 20 === 0)
              .map((d, k) => [
                new Date(d * 86_400_000).toISOString().slice(0, 10),
                pct(a.drawdown.portfolio[k * 20]),
              ]),
          }}
        >
          <TimeSeriesChart
            ariaLabel="Drawdown chart"
            dates={a.drawdown.dates}
            height={280}
            baseline={0}
            yFormat={(v) => pct(v, 0)}
            tooltipFormat={(v) => pct(v, 1)}
            series={[
              {
                key: 'p',
                label: 'Your portfolio',
                values: a.drawdown.portfolio,
                color: 'var(--s1)',
                area: true,
              },
              ...(a.drawdown.benchmark
                ? [{ key: 'b', label: benchName, values: a.drawdown.benchmark, color: 'var(--s2)' }]
                : []),
            ]}
          />
        </ChartCard>
      </div>

      <SectionTitle>Where your money — and your risk — sits</SectionTitle>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.25fr]">
        <ChartCard
          title="Allocation"
          subtitle="By holding and by asset class."
          table={{
            columns: ['Holding', 'Weight'],
            rows: sortedHold.map((h) => [names.get(h.id)!, pct(h.weight)]),
          }}
        >
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <Donut
              slices={slices}
              size={190}
              center={
                <>
                  <div className="text-xs text-ink-3">Total</div>
                  <div className="text-lg font-semibold">{compactMoney(p.amount, base)}</div>
                </>
              }
            />
            <div className="w-full min-w-0 flex-1 space-y-4">
              <ul className="space-y-1.5 text-[13px]">
                {slices.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-ink-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                      <span className="truncate">{s.label}</span>
                    </span>
                    <span className="num font-medium text-ink">{pct(s.value)}</span>
                  </li>
                ))}
              </ul>
              <div>
                <div className="label mb-2">By asset class</div>
                <BarList
                  rows={[...byClass.entries()]
                    .sort((x, y) => y[1] - x[1])
                    .map(([c, w]) => ({
                      key: c,
                      label: CLASS_LABEL[c as keyof typeof CLASS_LABEL] ?? c,
                      value: w,
                      color: classColor(c),
                    }))}
                />
              </div>
            </div>
          </div>
        </ChartCard>
        <ChartCard
          title="Money vs risk"
          subtitle="A holding's share of your money is often very different from its share of your risk."
          table={{
            columns: ['Holding', 'Money', 'Risk'],
            rows: a.perAsset.map((x) => [names.get(x.id)!, pct(x.weight), pct(x.riskShare)]),
          }}
        >
          <BarList
            labels={['Share of money', 'Share of risk']}
            colors={['var(--s7)', 'var(--s2)']}
            rows={[...a.perAsset]
              .sort((x, y) => y.riskShare - x.riskShare)
              .map((x) => ({ key: x.id, label: names.get(x.id)!, value: x.weight, value2: x.riskShare }))}
          />
          <p className="mt-3 text-xs text-ink-3">
            Risk share = each holding's contribution to total volatility (Euler decomposition, Ledoit–Wolf
            covariance). It accounts for both how volatile a holding is and how it moves with everything else.
          </p>
        </ChartCard>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="How your holdings move together"
          subtitle="Correlation from −1 (opposite) to +1 (lock-step). Ordered by hierarchical clustering so similar assets sit together."
          footer={<DivergingLegend min="−1" max="+1" label="Correlation" />}
          table={{
            columns: ['', ...a.correlation.ids.map((id) => names.get(id)!)],
            rows: a.correlation.ids.map((id, i) => [
              names.get(id)!,
              ...a.correlation.matrix[i].map((v) => v.toFixed(2)),
            ]),
          }}
        >
          <Heatmap
            ariaLabel="Correlation matrix"
            rows={a.correlation.ids.map((id) => names.get(id)!)}
            cols={a.correlation.ids.map((id) => names.get(id)!)}
            colLabels={a.correlation.ids.map((id) => data.assets.get(id)!.meta.symbol.replace('.NS', ''))}
            values={a.correlation.matrix}
          />
        </ChartCard>
        <ChartCard
          title="Daily returns distribution"
          subtitle={`Each bar counts days with a given return. The line shows what a normal ("bell curve") market would look like — real markets have fatter tails (excess kurtosis ${number(m.kurtosis, 1)}).`}
        >
          <Histogram
            ariaLabel="Histogram of daily returns"
            edges={a.distribution.edges}
            counts={a.distribution.counts}
            overlay={a.distribution.normal}
            markers={[{ value: -a.distribution.var95, label: 'VaR 95%' }]}
            height={240}
          />
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-ink-3">
            <div>
              Best day <span className="num block text-sm font-semibold text-pos">{signedPct(m.best)}</span>
            </div>
            <div>
              Worst day <span className="num block text-sm font-semibold text-neg">{signedPct(m.worst)}</span>
            </div>
            <div>
              Up days <span className="num block text-sm font-semibold text-ink">{pct(m.winRate, 0)}</span>
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Rolling 1-year statistics"
          subtitle="Risk is not constant — it clusters in time."
          right={
            <Segmented
              size="sm"
              label="Rolling statistic"
              value={rollKey}
              onChange={setRollKey}
              options={[
                { value: 'vol', label: 'Volatility' },
                { value: 'sharpe', label: 'Sharpe' },
                ...(a.rolling.beta ? [{ value: 'beta' as const, label: 'Beta' }] : []),
              ]}
            />
          }
        >
          <TimeSeriesChart
            ariaLabel={`Rolling ${rollKey}`}
            dates={a.rolling.dates}
            height={240}
            baseline={rollKey === 'vol' ? undefined : 0}
            yFormat={(v) => (rollKey === 'vol' ? pct(v, 0) : v.toFixed(1))}
            tooltipFormat={(v) => (rollKey === 'vol' ? pct(v, 1) : v.toFixed(2))}
            series={[
              {
                key: rollKey,
                label: rollKey === 'vol' ? 'Volatility' : rollKey === 'sharpe' ? 'Sharpe ratio' : 'Beta',
                values: roll,
                color: 'var(--s1)',
                area: rollKey === 'vol',
              },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Monthly returns"
          subtitle="Each cell is one calendar month; the last column is the full year."
          footer={<DivergingLegend min="−8%" max="+8%" />}
          table={{
            columns: ['Year', ...months, 'Year'],
            rows: years.map((y, i) => [y, ...cal[i].map((v) => (v === null ? '' : signedPct(v)))]),
          }}
        >
          <Heatmap
            ariaLabel="Calendar of monthly returns"
            rows={years.map(String)}
            cols={[...months, 'Year']}
            values={cal}
            scale={0.08}
            format={(v) => (v * 100).toFixed(1)}
            minCell={24}
          />
        </ChartCard>
      </div>

      <SectionTitle>Stress tests</SectionTitle>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="If history repeated"
          subtitle="Your current mix, replayed through real crises (buy-and-hold over each episode)."
          table={{
            columns: ['Episode', 'Dates', 'Return', 'Data coverage'],
            rows: a.stress.map((s) => [
              s.scenario.name,
              `${s.scenario.start} → ${s.scenario.end}`,
              signedPct(s.portfolioReturn),
              pct(s.totalCoverage, 0),
            ]),
          }}
        >
          {a.stress.length ? (
            <BarList
              diverging
              rows={a.stress.map((s) => ({
                key: s.scenario.id,
                label: s.scenario.name,
                value: s.portfolioReturn,
                note: `${s.scenario.start.slice(0, 7)} → ${s.scenario.end.slice(0, 7)} · ${money(p.amount * s.portfolioReturn, base, 0)}${s.coverage < s.totalCoverage - 1e-9 ? ` · ${pct(s.totalCoverage - s.coverage, 0)} estimated via proxies` : ''}`,
              }))}
              format={(v) => signedPct(v, 0)}
            />
          ) : (
            <p className="text-sm text-ink-3">
              Your holdings don't have enough history to replay past crises.
            </p>
          )}
        </ChartCard>
        <ChartCard
          title="What-if shocks"
          subtitle="Estimated from how each holding has moved with the shocked asset (3-year weekly betas)."
          table={{
            columns: ['Scenario', 'Impact'],
            rows: a.shocks.map((s) => [s.name, signedPct(s.impact)]),
          }}
        >
          <BarList
            diverging
            rows={a.shocks.map((s) => ({
              key: s.id,
              label: s.name,
              value: s.impact,
              note: `${s.summary} ≈ ${money(p.amount * s.impact, base, 0)}`,
            }))}
            format={(v) => signedPct(v, 1)}
          />
        </ChartCard>
      </div>

      {a.factorModel && (
        <>
          <SectionTitle>What really drives your returns</SectionTitle>
          <ChartCard
            title="Factor exposures"
            subtitle={`A multi-factor regression on weekly returns explains ${pct(a.factorModel.rSquared, 0)} of your portfolio's ups and downs.`}
            table={{
              columns: ['Factor', 'Exposure (beta)', 't-stat', 'Share of variance'],
              rows: a.factorModel.exposures.map((f) => [
                f.label,
                f.beta.toFixed(2),
                f.tStat.toFixed(1),
                pct(f.varianceShare, 0),
              ]),
            }}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
              <BarList
                diverging
                rows={a.factorModel.exposures.map((f) => ({
                  key: f.key,
                  label: f.label,
                  value: f.beta,
                  note: f.significant
                    ? `statistically significant · explains ${pct(Math.max(0, f.varianceShare), 0)} of variance`
                    : 'weak evidence (|t| < 2)',
                  color: f.significant ? undefined : 'var(--text-3)',
                }))}
                format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)}
              />
              <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
                <p>
                  A beta of <strong>+1.0</strong> on the market factor means your portfolio tends to rise and
                  fall one-for-one with it. Positive values on a long/short factor (e.g.{' '}
                  <em>small vs large</em>) mean you lean towards the first side.
                </p>
                <p>
                  Alpha (return not explained by these factors):{' '}
                  <strong className={a.factorModel.alphaAnnual >= 0 ? 'text-pos' : 'text-neg'}>
                    {signedPct(a.factorModel.alphaAnnual)}
                  </strong>{' '}
                  a year (t = {a.factorModel.alphaTStat.toFixed(1)})
                  {Math.abs(a.factorModel.alphaTStat) < 2
                    ? ' — not statistically different from zero, which is normal.'
                    : '.'}
                </p>
                <p className="text-xs text-ink-3">
                  Factors are built from liquid ETF spreads so they update daily with the rest of the data.
                </p>
              </div>
            </div>
          </ChartCard>
        </>
      )}
      <p className="mt-6 text-xs text-ink-3">
        Methodology: returns in {base}{' '}
        {valid.some((h) => data.assets.get(h.id)?.meta.currency !== base)
          ? '(foreign holdings converted daily at USD/INR)'
          : ''}{' '}
        on a weekday calendar; covariance estimated with{' '}
        {COV_LABEL[useSettings.getState().covariance] ?? 'Ledoit–Wolf shrinkage'}; risk-free rate{' '}
        {pct(data.snapshot.riskFree[base].rate, 2)} ({data.snapshot.riskFree[base].source}). Past performance
        does not predict future results.
      </p>
    </>
  );
}
