import { CalendarClock, Dices, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Currency } from '@frontier/contracts';
import { explain, type McMethod } from '@frontier/quant';
import { useMarketData, type MarketData } from '@/lib/data';
import { useDebounced } from '@/lib/hooks';
import { normalized, useSeriesInputs } from '@/lib/portfolio';
import { usePortfolios, useSettings } from '@/lib/store';
import { useMonthlyReturns, useSimulation } from '@/lib/worker';
import { CURRENCY_SYMBOL, compactMoney, money, number, odds, pct } from '@/lib/format';
import { ChartCard, Columns, FanChart } from '@/components/charts/charts';
import { Callout, Card, CardHeader, PageHeader, Segmented, Skeleton, Stat, Switch, cx } from '@/components/ui/primitives';
import { Slider } from '@/components/ui/Slider';
import { DataState } from '@/components/domain/common';

export default function SimulatePage() {
  const md = useMarketData();
  return <DataState isLoading={md.isLoading} error={md.error}>{md.data && <Simulator data={md.data} />}</DataState>;
}

function MoneyInput({ label, value, onChange, currency, step = 1000 }: { label: string; value: number; onChange: (v: number) => void; currency: Currency; step?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-3">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">{CURRENCY_SYMBOL[currency]}</span>
        <input className="input num !pl-7" type="number" min={0} step={step} value={Math.round(value)} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      </div>
    </label>
  );
}

function Simulator({ data }: { data: MarketData }) {
  const p = usePortfolios((s) => s.active());
  const prof = useSettings((s) => s.profile);
  const cur: Currency = p.currency;
  const inr = cur === 'INR';
  const [source, setSource] = useState<'portfolio' | 'custom'>('portfolio');
  const [method, setMethod] = useState<McMethod>('bootstrap');
  const [initial, setInitial] = useState(prof?.initial ?? p.amount);
  const [monthly, setMonthly] = useState(prof?.monthly ?? (inr ? 10_000 : 500));
  const [stepUp, setStepUp] = useState(0.05);
  const [years, setYears] = useState(prof?.horizon ?? 15);
  const [goal, setGoal] = useState(prof?.goal ?? (inr ? 5_000_000 : 500_000));
  const [inflation, setInflation] = useState(inr ? 0.05 : 0.025);
  const [fee, setFee] = useState(0.003);
  const [real, setReal] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [wAmount, setWAmount] = useState(inr ? 40_000 : 3_000);
  const [wStart, setWStart] = useState(prof?.horizon ?? 15);
  const [customMu, setCustomMu] = useState(0.09);
  const [customSigma, setCustomSigma] = useState(0.15);

  const holdings = useMemo(() => normalized(p.holdings).filter((h) => data.assets.has(h.id)), [p.holdings, data.assets]);
  const ids = useMemo(() => holdings.map((h) => h.id), [holdings]);
  const inputs = useSeriesInputs(ids, data.assets, cur);
  const hist = useMonthlyReturns(source === 'portfolio' && inputs.ready && holdings.length ? { assets: ids.map((id) => inputs.inputs[id]), weights: holdings.map((h) => h.weight), base: cur, fx: inputs.fx, lookbackYears: 0 } : null);
  const mu = source === 'portfolio' ? hist.data?.mu : customMu;
  const sigma = source === 'portfolio' ? hist.data?.sigma : customSigma;
  const effMethod: McMethod = source === 'custom' && method === 'bootstrap' ? 'gbm' : method;
  const params = useDebounced({ initial, monthly, stepUp, years, goal, inflation, fee, real, withdraw, wAmount, wStart, effMethod, mu, sigma }, 300);
  const totalYears = params.withdraw ? Math.max(params.years, params.wStart + 25) : params.years;
  const sim = useSimulation(
    params.mu !== undefined && params.sigma !== undefined && (params.effMethod !== 'bootstrap' || (hist.data?.returns.length ?? 0) >= 12)
      ? {
          method: params.effMethod,
          mu: params.mu,
          sigma: params.sigma,
          monthlyReturns: params.effMethod === 'bootstrap' ? hist.data?.returns : undefined,
          blockLength: 6,
          years: totalYears,
          initial: params.initial,
          monthlyContribution: params.monthly,
          contributionGrowth: params.stepUp,
          monthlyWithdrawal: params.withdraw ? params.wAmount : 0,
          withdrawalStartYear: params.withdraw ? params.wStart : undefined,
          inflation: params.inflation,
          annualFee: params.fee,
          goal: params.withdraw ? undefined : params.goal,
          real: params.real,
          paths: 6000,
          seed: 42,
        }
      : null,
  );
  const r = sim.data;
  const fmt = (v: number) => compactMoney(v, cur);
  const yearly = r ? Array.from({ length: Math.floor(r.months / 12) }, (_, i) => (i + 1) * 12).filter((_m, i, arr) => arr.length <= 12 || i % Math.ceil(arr.length / 12) === 0) : [];

  return (
    <div>
      <PageHeader
        eyebrow="Future planner"
        title={<>See thousands of possible <span className="gradient-text">futures</span></>}
        subtitle="Monte Carlo simulation replays your portfolio through thousands of plausible market paths — so you can plan for a range, not a single guess."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="card-pad">
            <CardHeader title="Return assumptions" icon={<Dices size={16} className="text-accent" />} />
            <Segmented size="sm" label="Return source" value={source} onChange={setSource} options={[{ value: 'portfolio', label: `My portfolio` }, { value: 'custom', label: 'Custom' }]} />
            {source === 'portfolio' ? (
              <p className="mt-3 text-[13px] text-ink-2">
                Using <strong>{p.name}</strong>{hist.data ? <> — {pct(hist.data.mu, 1)} average return and {pct(hist.data.sigma, 1)} volatility over {number(hist.data.years, 0)} years of history.</> : '…'}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <Slider label="Expected return / year" value={customMu} min={0} max={0.25} step={0.005} onChange={setCustomMu} format={(v) => pct(v, 1)} />
                <Slider label="Volatility / year" value={customSigma} min={0.01} max={0.6} step={0.005} onChange={setCustomSigma} format={(v) => pct(v, 1)} />
              </div>
            )}
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-ink-3">Simulation engine</div>
              <Segmented
                size="sm"
                label="Simulation engine"
                value={effMethod}
                onChange={setMethod}
                options={[...(source === 'portfolio' ? [{ value: 'bootstrap' as const, label: 'History replay' }] : []), { value: 'gbm', label: 'Normal' }, { value: 'student-t', label: 'Fat tails' }]}
              />
              <p className="mt-1.5 text-xs text-ink-3">
                {effMethod === 'bootstrap' ? 'Stitches together random 6-month blocks of your portfolio’s real history — keeps crashes, streaks and fat tails.' : effMethod === 'gbm' ? 'Bell-curve monthly returns (geometric Brownian motion) — the textbook model.' : 'Student-t shocks with 5 degrees of freedom: same average and volatility, but rare extreme months are more common.'}
              </p>
            </div>
          </Card>
          <Card className="card-pad">
            <CardHeader title="Your plan" icon={<CalendarClock size={16} className="text-accent" />} />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MoneyInput label="Start with" value={initial} onChange={setInitial} currency={cur} />
                <MoneyInput label="Add every month" value={monthly} onChange={setMonthly} currency={cur} step={500} />
              </div>
              <Slider label="Yearly increase in monthly amount" value={stepUp} min={0} max={0.15} step={0.01} onChange={setStepUp} format={(v) => pct(v, 0)} />
              <Slider label="Years" value={years} min={1} max={40} step={1} onChange={setYears} format={(v) => `${v} years`} />
              {!withdraw && <MoneyInput label="Goal" value={goal} onChange={setGoal} currency={cur} step={50_000} />}
              <Slider label="Inflation" value={inflation} min={0} max={0.1} step={0.0025} onChange={setInflation} format={(v) => pct(v, 1)} />
              <Slider label="Annual fees" value={fee} min={0} max={0.02} step={0.0005} onChange={setFee} format={(v) => pct(v, 2)} />
              <Switch checked={real} onChange={setReal} label="Show in today’s money (inflation-adjusted)" />
              <Switch checked={withdraw} onChange={setWithdraw} label="Model retirement withdrawals" />
              {withdraw && (
                <div className="space-y-4 rounded-xl border border-line p-3">
                  <MoneyInput label="Monthly withdrawal (today’s money)" value={wAmount} onChange={setWAmount} currency={cur} step={1000} />
                  <Slider label="Start withdrawing after" value={wStart} min={0} max={40} step={1} onChange={setWStart} format={(v) => `${v} years`} />
                  <p className="text-xs text-ink-3">Contributions stop and withdrawals (rising with inflation) begin after year {wStart}; the simulation runs 25 years beyond.</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {hist.error && <Callout tone="warn">{hist.error.message}</Callout>}
          {!r ? (
            <Skeleton className="h-[460px]" />
          ) : (
            <div className={cx('flex flex-col gap-4 transition-opacity', sim.isFetching && 'opacity-60')}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Typical outcome" value={fmt(r.final.p50)} sub={`median after ${totalYears} years`} explain={`Half of the simulated futures end above ${money(r.final.p50, cur, 0)} and half below.`} />
                <Stat label="Bad case (1 in 10)" value={fmt(r.final.p10)} sub="10th percentile" explain="In 1 future out of 10 you would end with this much or less. Plan so that you could live with this." />
                {withdraw ? (
                  <Stat label="Money runs out" value={pct(r.probDepletion, 0)} sub="of simulated futures" tone={r.probDepletion > 0.2 ? 'neg' : undefined} explain={r.probDepletion < 0.05 ? 'Your withdrawals look sustainable in almost every scenario.' : `In ${odds(r.probDepletion)} futures the money runs out — consider withdrawing less or investing longer.`} />
                ) : (
                  <Stat label="Chance of reaching goal" value={r.probGoal !== null ? pct(r.probGoal, 0) : '—'} sub={r.probGoal !== null ? odds(r.probGoal) : undefined} explain={r.medianMonthsToGoal !== null ? `Typically reached after ${number(r.medianMonthsToGoal / 12, 1)} years.` : 'Most simulated futures fall short — try investing more each month or for longer.'} />
                )}
                <Stat label="You put in" value={fmt(r.totalInvested)} sub={`chance of ending below that: ${pct(r.probLoss, 0)}`} explain={`Median compound growth ${pct(r.medianCagr, 1)}/yr after fees. Worst drop along the way: typically ${pct(r.medianMaxDrawdown, 0)}, in bad cases ${pct(r.worstMaxDrawdown, 0)}.`} />
              </div>
              <ChartCard
                title="Range of outcomes over time"
                subtitle={`${real ? 'In today’s money' : 'Nominal values'} · 6,000 simulated paths · the darker band holds half of all outcomes, the lighter one 90%.`}
                table={{ columns: ['Year', 'Poor (10%)', 'Median', 'Great (90%)', 'Invested'], rows: yearly.map((m) => [m / 12, money(r.bands.p10[m], cur, 0), money(r.bands.p50[m], cur, 0), money(r.bands.p90[m], cur, 0), money(r.invested[m], cur, 0)]) }}
              >
                <FanChart bands={r.bands} invested={r.invested} goal={withdraw ? undefined : goal} format={fmt} ariaLabel="Fan chart of projected portfolio value" height={340} />
              </ChartCard>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="Where you could end up" subtitle="Distribution of the final value across all simulated futures (1st–99th percentile)." table={{ columns: ['From', 'To', 'Futures'], rows: r.histogram.counts.map((c, i) => [money(r.histogram.edges[i], cur, 0), money(r.histogram.edges[i + 1], cur, 0), c]) }}>
                  <Columns ariaLabel="Histogram of final values" height={220} items={r.histogram.counts.map((c, i) => ({ key: String(i), label: i % 8 === 0 ? fmt(r.histogram.edges[i]) : '', value: c / 6000, color: (r.histogram.edges[i] + r.histogram.edges[i + 1]) / 2 < r.totalInvested ? 'var(--s8)' : 'var(--s1)' }))} format={(v) => pct(v, 1)} />
                </ChartCard>
                <Card className="card-pad">
                  <CardHeader title="In plain English" icon={<Info size={16} className="text-accent" />} />
                  <ul className="space-y-2.5 text-[14px] leading-relaxed text-ink-2">
                    <li>Investing {money(initial, cur, 0)} now and {money(monthly, cur, 0)} a month{stepUp > 0 ? ` (raised ${pct(stepUp, 0)} each year)` : ''} for {years} years, you put in {money(r.totalInvested, cur, 0)} in total.</li>
                    <li>The typical result is <strong>{money(r.final.p50, cur, 0)}</strong>{real ? ' in today’s money' : ''} — but 1 future in 10 ends below {money(r.final.p10, cur, 0)}, and 1 in 10 above {money(r.final.p90, cur, 0)}.</li>
                    {!withdraw && r.probGoal !== null && <li>You reach your goal of {money(goal, cur, 0)} in {pct(r.probGoal, 0)} of futures — {odds(r.probGoal)}.</li>}
                    <li>{explain.explainDrawdown(r.medianMaxDrawdown).text.replace('At its worst it fell', 'Along the way, a typical future sees a fall of')}</li>
                    <li className="text-xs text-ink-3">Fees of {pct(fee, 2)} a year cost far more than they sound: they compound against you every month.</li>
                  </ul>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
