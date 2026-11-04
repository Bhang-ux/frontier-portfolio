import { FlaskConical, Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Currency } from '@frontier/contracts';
import type { StrategySpec } from '@frontier/quant';
import { useMarketData, type MarketData } from '@/lib/data';
import { normalized, useSeriesInputs } from '@/lib/portfolio';
import { usePortfolios, useSettings } from '@/lib/store';
import { useRebalanceStudy, useWalkForward } from '@/lib/worker';
import { money, number, pct, seriesColor } from '@/lib/format';
import { ChartCard } from '@/components/charts/charts';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { Callout, Card, CardHeader, PageHeader, Segmented, Skeleton, cx } from '@/components/ui/primitives';
import { Slider } from '@/components/ui/Slider';
import { DataState, SectionTitle } from '@/components/domain/common';
import { WalkForwardView } from '@/components/portfolio/WalkForwardView';
import { LOOKBACKS } from './Portfolio';

export default function BacktestPage() {
  const md = useMarketData();
  return (
    <DataState isLoading={md.isLoading} error={md.error}>
      {md.data && <Lab data={md.data} />}
    </DataState>
  );
}

function Lab({ data }: { data: MarketData }) {
  const p = usePortfolios((s) => s.active());
  const { covariance } = useSettings();
  const base: Currency = p.currency;
  const holdings = useMemo(
    () => normalized(p.holdings).filter((h) => data.assets.has(h.id)),
    [p.holdings, data.assets],
  );
  const ids = useMemo(() => holdings.map((h) => h.id), [holdings]);
  const inputs = useSeriesInputs(ids, data.assets, base);
  const rf = data.snapshot.riskFree[base].rate;
  const [cost, setCost] = useState(10);
  const [lookback, setLookback] = useState(10);
  const [wfRebal, setWfRebal] = useState<'monthly' | 'quarterly'>('quarterly');
  const [maxW, setMaxW] = useState(0.5);

  const study = useRebalanceStudy(
    inputs.ready && holdings.length
      ? {
          assets: ids.map((id) => inputs.inputs[id]),
          weights: holdings.map((h) => h.weight),
          base,
          fx: inputs.fx,
          lookbackYears: lookback,
          riskFree: rf,
          costBps: cost,
          amount: p.amount,
        }
      : null,
  );
  const strategies: StrategySpec[] = [
    {
      id: 'current',
      label: 'Your weights (fixed)',
      objective: 'equal-weight',
      fixedWeights: holdings.map((h) => h.weight),
    },
    { id: 'equal-weight', label: 'Equal weight', objective: 'equal-weight' },
    { id: 'min-variance', label: 'Lowest risk', objective: 'min-variance' },
    { id: 'max-sharpe', label: 'Best risk/return', objective: 'max-sharpe' },
    { id: 'risk-parity', label: 'Risk parity', objective: 'risk-parity' },
    { id: 'hrp', label: 'HRP', objective: 'hrp' },
    { id: 'max-diversification', label: 'Most diversified', objective: 'max-diversification' },
  ];
  const wf = useWalkForward(
    inputs.ready && holdings.length >= 2
      ? {
          assets: ids.map((id) => inputs.inputs[id]),
          base,
          fx: inputs.fx,
          riskFree: rf,
          covariance,
          lookbackDays: 252,
          rebalance: wfRebal,
          maxWeight: Math.max(maxW, 1 / holdings.length),
          strategies,
          costBps: cost,
        }
      : null,
  );
  const best = study.data
    ? [...study.data.rules].sort((a, b) => b.metrics.sharpe - a.metrics.sharpe)[0]
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Strategy lab"
        title={
          <>
            Test ideas on <span className="gradient-text">real history</span> before risking real money
          </>
        }
        subtitle={`Experiments run on “${p.name}” (${holdings.length} holdings) using dividend-adjusted prices and realistic trading costs.`}
        right={
          <Link to="/portfolio" className="btn-ghost text-[13px]">
            Change portfolio
          </Link>
        }
      />
      <Card className="mb-4 card-pad">
        <div className="grid gap-4 md:grid-cols-3">
          <Slider
            label="Trading cost per trade"
            value={cost}
            min={0}
            max={100}
            step={1}
            onChange={setCost}
            format={(v) => `${v} bp (${(v / 100).toFixed(2)}%)`}
          />
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink-2">History window</div>
            <Segmented
              size="sm"
              label="Lab history"
              value={lookback}
              onChange={setLookback}
              options={LOOKBACKS.filter((l) => l.value !== 1)}
            />
          </div>
          <Slider
            label="Max weight per asset (strategies)"
            value={maxW}
            min={0.1}
            max={1}
            step={0.05}
            onChange={setMaxW}
            format={(v) => pct(Math.max(v, holdings.length ? 1 / holdings.length : 1), 0)}
          />
        </div>
      </Card>

      {holdings.length === 0 && <Callout>Add holdings on the portfolio page to run experiments.</Callout>}

      <SectionTitle>Experiment 1 · How often should you rebalance?</SectionTitle>
      {study.error ? (
        <Callout tone="warn">{study.error.message}</Callout>
      ) : !study.data ? (
        <Skeleton className="h-[380px]" />
      ) : (
        <div
          className={cx('grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]', study.isFetching && 'opacity-60')}
        >
          <ChartCard
            title={`Growth of ${money(p.amount, base, 0)}`}
            subtitle="Same target weights, five different rebalancing habits."
          >
            <TimeSeriesChart
              ariaLabel="Rebalancing rules compared"
              dates={study.data.dates}
              height={300}
              yFormat={(v) => money(v, base, 0)}
              series={study.data.rules.map((r, i) => ({
                key: r.key,
                label: r.label,
                values: r.equity,
                color: seriesColor(i),
              }))}
            />
          </ChartCard>
          <Card className="card-pad">
            <CardHeader title="Results" icon={<Repeat size={16} className="text-accent" />} />
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-left text-xs text-ink-3">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rule</th>
                    <th className="px-3 py-2 text-right font-medium">Return/yr</th>
                    <th className="px-3 py-2 text-right font-medium">Worst fall</th>
                    <th className="px-3 py-2 text-right font-medium">Trades</th>
                    <th className="px-3 py-2 text-right font-medium">Costs</th>
                  </tr>
                </thead>
                <tbody>
                  {study.data.rules.map((r) => (
                    <tr key={r.key} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">
                        {r.label}
                        {r === best && (
                          <span className="ml-1.5 rounded bg-pos-soft px-1 text-[10px] font-bold text-pos">
                            BEST
                          </span>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-right">{pct(r.metrics.cagr)}</td>
                      <td className="num px-3 py-2 text-right text-neg">{pct(-r.metrics.maxDrawdown, 0)}</td>
                      <td className="num px-3 py-2 text-right">{r.rebalances}</td>
                      <td className="num px-3 py-2 text-right text-ink-2">{money(r.costs, base, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              <strong>Why rebalance?</strong> Without it, your winners grow into a bigger share and your risk
              quietly drifts up. Rebalancing sells a little of what went up and buys what went down — a
              disciplined “buy low, sell high”. Too often wastes money on costs; once a year, or when a
              holding drifts 5% off target, is a common sweet spot.
            </p>
            {best && (
              <p className="mt-2 text-xs text-ink-3">
                Best risk-adjusted here: <strong>{best.label}</strong> (Sharpe {number(best.metrics.sharpe)}).
              </p>
            )}
          </Card>
        </div>
      )}

      <SectionTitle
        right={
          <Segmented
            size="sm"
            label="Re-optimise"
            value={wfRebal}
            onChange={setWfRebal}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'quarterly', label: 'Quarterly' },
            ]}
          />
        }
      >
        Experiment 2 · Which allocation method wins out of sample?
      </SectionTitle>
      <Card className="card-pad">
        <CardHeader
          title="Walk-forward tournament"
          subtitle="Each method only ever sees the trailing 12 months, then lives with its choice until the next re-optimisation — no peeking at the future."
          icon={<FlaskConical size={16} className="text-accent" />}
        />
        {holdings.length < 2 ? (
          <p className="text-sm text-ink-3">Needs at least two holdings.</p>
        ) : wf.error ? (
          <Callout tone="warn">{wf.error.message}</Callout>
        ) : !wf.data ? (
          <Skeleton className="h-[360px]" />
        ) : (
          <div className={cx(wf.isFetching && 'opacity-60')}>
            <WalkForwardView wf={wf.data} base={base} />
          </div>
        )}
      </Card>
    </div>
  );
}
