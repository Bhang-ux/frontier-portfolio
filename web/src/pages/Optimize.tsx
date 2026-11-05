import { ArrowRight, Check, FlaskConical, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { AssetSnapshot, Currency } from '@frontier/contracts';
import { rebalancePlan, type Objective, type StrategySpec, type View } from '@frontier/quant';
import { useMarketData, type MarketData } from '@/lib/data';
import { useDebounced } from '@/lib/hooks';
import { BENCHMARK, assetInfo, normalized, useSeriesInputs } from '@/lib/portfolio';
import { usePortfolios, useSettings, type ReturnModel } from '@/lib/store';
import { useOptimization, useWalkForward } from '@/lib/worker';
import { money, number, pct, seriesColor, signedPct } from '@/lib/format';
import type { OptimizeRequest } from '@/workers/quant.worker';
import { FrontierChart } from '@/components/charts/FrontierChart';
import { ChartCard } from '@/components/charts/charts';
import {
  Callout,
  Card,
  CardHeader,
  PageHeader,
  Segmented,
  Skeleton,
  Switch,
  cx,
} from '@/components/ui/primitives';
import { Slider } from '@/components/ui/Slider';
import { AssetPicker, ClassDot, DataState, SectionTitle } from '@/components/domain/common';
import { WalkForwardView } from '@/components/portfolio/WalkForwardView';
import { COV_LABEL, LOOKBACKS } from './Portfolio';

const OBJECTIVES: { value: Objective; title: string; blurb: string }[] = [
  {
    value: 'max-sharpe',
    title: 'Best risk/return',
    blurb: 'The classic (Markowitz): the most return for each unit of risk.',
  },
  { value: 'min-variance', title: 'Lowest risk', blurb: 'The calmest possible mix, whatever the return.' },
  { value: 'risk-parity', title: 'Risk parity', blurb: 'Every holding contributes the same amount of risk.' },
  {
    value: 'hrp',
    title: 'Hierarchical risk parity',
    blurb: 'Clusters look-alike assets, then balances risk. Robust to bad estimates.',
  },
  {
    value: 'max-diversification',
    title: 'Most diversified',
    blurb: 'Holdings that move as independently as possible.',
  },
  {
    value: 'min-cvar',
    title: 'Smallest crash losses',
    blurb: 'Minimises the average loss on the worst 5% of days (CVaR).',
  },
  { value: 'target-return', title: 'Hit a target return', blurb: 'Least risk for the return you ask for.' },
  { value: 'target-volatility', title: 'Cap my risk', blurb: 'Most return without exceeding a risk level.' },
  {
    value: 'equal-weight',
    title: 'Equal weight',
    blurb: 'The simple 1/N baseline that is surprisingly hard to beat.',
  },
];

const RETURN_MODELS: { value: ReturnModel; label: string; blurb: string }[] = [
  {
    value: 'shrunk',
    label: 'Shrunk history',
    blurb: 'Bayes–Stein: past returns pulled towards their average to cut noise (recommended).',
  },
  { value: 'historical', label: 'Raw history', blurb: 'Assumes the past average repeats. Very noisy.' },
  { value: 'capm', label: 'CAPM', blurb: 'Return from market beta only.' },
  { value: 'ewma', label: 'Recent momentum', blurb: 'Exponentially weighted — recent months count more.' },
  {
    value: 'equilibrium',
    label: 'Equilibrium',
    blurb: 'Returns implied by an equal-weight market (Black–Litterman prior).',
  },
];

export default function OptimizePage() {
  const md = useMarketData();
  return (
    <DataState isLoading={md.isLoading} error={md.error}>
      {md.data && <OptimizeView data={md.data} />}
    </DataState>
  );
}

interface ViewDraft {
  kind: 'absolute' | 'relative';
  a: string;
  b?: string;
  value: number;
  confidence: number;
}

function OptimizeView({ data }: { data: MarketData }) {
  const nav = useNavigate();
  const p = usePortfolios((s) => s.active());
  const { setHoldings, create } = usePortfolios();
  const settings = useSettings();
  const pro = settings.mode === 'pro';
  const base: Currency = p.currency;
  const current = useMemo(
    () => normalized(p.holdings).filter((h) => data.assets.has(h.id)),
    [p.holdings, data.assets],
  );
  const [universe, setUniverse] = useState<string[]>(() => current.map((h) => h.id));
  const [objective, setObjective] = useState<Objective>('max-sharpe');
  const [maxW, setMaxW] = useState(0.4);
  const [minW, setMinW] = useState(0);
  const [stockCap, setStockCap] = useState(1);
  const [cryptoCap, setCryptoCap] = useState(0.1);
  const [targetRet, setTargetRet] = useState(0.1);
  const [targetVol, setTargetVol] = useState(0.12);
  const [views, setViews] = useState<ViewDraft[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [fractional, setFractional] = useState(true);
  const [runWF, setRunWF] = useState(false);

  const ids = useMemo(() => universe.filter((id) => data.assets.has(id)), [universe, data.assets]);
  const marketId = BENCHMARK[base].id;
  const inputs = useSeriesInputs(
    useMemo(() => [...ids, marketId], [ids, marketId]),
    data.assets,
    base,
  );
  const rf = data.snapshot.riskFree[base].rate;
  const feasibleMax = Math.max(maxW, ids.length ? 1 / ids.length : 1);
  const settled = useDebounced(
    { objective, maxW: feasibleMax, minW, stockCap, cryptoCap, targetRet, targetVol, views },
    250,
  );

  const req = useMemo<OptimizeRequest | null>(() => {
    if (!inputs.ready || ids.length < 2) return null;
    const blViews: View[] = settled.views
      .filter(
        (v) => ids.includes(v.a) && (v.kind === 'absolute' || (v.b && ids.includes(v.b) && v.b !== v.a)),
      )
      .map((v) => ({
        pick: ids.map((id) => (id === v.a ? 1 : id === v.b && v.kind === 'relative' ? -1 : 0)),
        value: v.value,
        confidence: v.confidence,
      }));
    return {
      assets: ids.map((id) => inputs.inputs[id]),
      info: ids.map((id) => assetInfo(data.assets.get(id)!)),
      base,
      fx: inputs.fx,
      lookbackYears: settings.lookback,
      riskFree: rf,
      covariance: settings.covariance,
      returnModel: settings.returnModel,
      objective: settled.objective,
      maxWeight: settled.maxW,
      minWeight: Math.min(settled.minW, 1 / ids.length),
      classCaps: { equity: settled.stockCap, crypto: settled.cryptoCap },
      currentWeights: ids.map((id) => current.find((h) => h.id === id)?.weight ?? 0),
      targetReturn: settled.targetRet,
      targetVolatility: settled.targetVol,
      views: blViews,
      market: inputs.inputs[marketId],
    };
  }, [
    inputs,
    ids,
    data.assets,
    base,
    settings.lookback,
    settings.covariance,
    settings.returnModel,
    rf,
    settled,
    current,
    marketId,
  ]);
  const opt = useOptimization(req);
  const res = opt.data;

  // If the user picked a frontier point, it overrides the objective's solution.
  const chosen = useMemo(() => {
    if (!res) return null;
    if (picked !== null && res.frontier[picked]) {
      const f = res.frontier[picked];
      return {
        weights: f.weights,
        ret: f.ret,
        vol: f.vol,
        sharpe: (f.ret - rf) / f.vol,
        label: 'Picked on frontier',
      };
    }
    return {
      weights: res.result.weights,
      ret: res.result.expectedReturn,
      vol: res.result.volatility,
      sharpe: res.result.sharpe,
      label: OBJECTIVES.find((o) => o.value === res.result.objective)?.title ?? 'Optimised',
    };
  }, [res, picked, rf]);

  const wfReq = useMemo(() => {
    if (!runWF || !inputs.ready || ids.length < 2) return null;
    const strategies: StrategySpec[] = [
      { id: 'max-sharpe', label: 'Best risk/return', objective: 'max-sharpe' },
      { id: 'min-variance', label: 'Lowest risk', objective: 'min-variance' },
      { id: 'risk-parity', label: 'Risk parity', objective: 'risk-parity' },
      { id: 'hrp', label: 'HRP', objective: 'hrp' },
      { id: 'equal-weight', label: 'Equal weight', objective: 'equal-weight' },
    ];
    if (current.length)
      strategies.push({
        id: 'current',
        label: 'Your weights (fixed)',
        objective: 'equal-weight',
        fixedWeights: ids.map((id) => current.find((h) => h.id === id)?.weight ?? 0),
      });
    return {
      assets: ids.map((id) => inputs.inputs[id]),
      base,
      fx: inputs.fx,
      riskFree: rf,
      covariance: settings.covariance,
      lookbackDays: 252,
      rebalance: 'quarterly' as const,
      maxWeight: feasibleMax,
      strategies,
      costBps: 10,
    };
  }, [runWF, inputs, ids, base, rf, settings.covariance, feasibleMax, current]);
  const wf = useWalkForward(wfReq);

  const apply = (asNew: boolean) => {
    if (!chosen) return;
    const holdings = ids
      .map((id, i) => ({ id, weight: Math.round(chosen.weights[i] * 10000) / 10000 }))
      .filter((h) => h.weight >= 0.001);
    if (asNew)
      create({
        name: `${chosen.label} mix`,
        currency: base,
        amount: p.amount,
        holdings,
        origin: 'optimizer',
      });
    else setHoldings(p.id, holdings);
    toast.success(asNew ? 'Saved as a new portfolio' : 'Portfolio updated', {
      description: 'Open “My portfolio” to see the full analysis.',
    });
    nav('/portfolio');
  };

  const price = (a: AssetSnapshot) => {
    const fx = data.snapshot.fx.USDINR.rate;
    const px = a.quote.price;
    return a.meta.currency === base ? px : base === 'INR' ? px * fx : px / fx;
  };
  const plan = useMemo(() => {
    if (!chosen) return null;
    const prices: Record<string, number> = {};
    ids.forEach((id) => (prices[id] = price(data.assets.get(id)!)));
    const holdings = ids.map((id) => ({
      id,
      units: ((current.find((h) => h.id === id)?.weight ?? 0) * p.amount) / prices[id],
      price: prices[id],
    }));
    return rebalancePlan({
      holdings,
      targetWeights: Object.fromEntries(ids.map((id, i) => [id, chosen.weights[i]])),
      prices,
      fractional,
      minTrade: p.amount * 0.002,
      costBps: 10,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, ids, fractional, p.amount, base, data]);

  const names = (id: string) => data.assets.get(id)?.meta.short ?? id;

  return (
    <div>
      <PageHeader
        eyebrow="Optimizer"
        title={
          <>
            Find the <span className="gradient-text">best mix</span> of the assets you choose
          </>
        }
        subtitle="Modern portfolio theory, robust risk models and Bayesian return estimates — the toolkit of pension funds and quant desks — explained as you go."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="card-pad">
            <CardHeader
              title="1 · Assets to consider"
              subtitle="Start from your portfolio and add candidates."
              right={
                <button
                  className="btn-quiet !p-1.5"
                  title="Reset to my portfolio"
                  onClick={() => {
                    setUniverse(current.map((h) => h.id));
                    setPicked(null);
                  }}
                >
                  <RotateCcw size={15} />
                </button>
              }
            />
            <div className="mb-3 flex flex-wrap gap-1.5">
              {ids.map((id) => (
                <span key={id} className="chip !py-1 !pl-2 !pr-1">
                  <ClassDot cls={data.assets.get(id)!.meta.assetClass} />
                  {names(id)}
                  <button
                    aria-label={`Remove ${names(id)}`}
                    className="rounded-full p-0.5 hover:bg-surface-3"
                    onClick={() => {
                      setUniverse(universe.filter((x) => x !== id));
                      setPicked(null);
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <AssetPicker
              label="Add candidate"
              exclude={ids}
              onPick={(id) => {
                setUniverse([...universe, id]);
                setPicked(null);
              }}
            />
            {ids.length < 2 && (
              <p className="mt-2 text-xs text-[var(--warning)]">Choose at least two assets.</p>
            )}
          </Card>

          <Card className="card-pad">
            <CardHeader title="2 · What matters to you?" subtitle="Pick an objective." />
            <div role="radiogroup" aria-label="Objective" className="grid grid-cols-1 gap-1.5">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.value}
                  role="radio"
                  aria-checked={objective === o.value}
                  onClick={() => {
                    setObjective(o.value);
                    setPicked(null);
                  }}
                  className={cx(
                    'flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    objective === o.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cx(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      objective === o.value ? 'border-accent bg-accent text-white' : 'border-line-strong',
                    )}
                  >
                    {objective === o.value && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-semibold text-ink">{o.title}</span>
                    <span className="block text-xs leading-snug text-ink-3">{o.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            {objective === 'target-return' && (
              <div className="mt-4">
                <Slider
                  label="Target return per year"
                  value={targetRet}
                  min={0.02}
                  max={0.4}
                  step={0.005}
                  onChange={setTargetRet}
                  format={(v) => pct(v, 1)}
                />
              </div>
            )}
            {objective === 'target-volatility' && (
              <div className="mt-4">
                <Slider
                  label="Maximum volatility"
                  value={targetVol}
                  min={0.02}
                  max={0.5}
                  step={0.005}
                  onChange={setTargetVol}
                  format={(v) => pct(v, 1)}
                />
              </div>
            )}
          </Card>

          <Card className="card-pad">
            <CardHeader
              title="3 · Guard-rails"
              subtitle="Limits keep the optimiser from betting the farm on one asset."
            />
            <div className="space-y-4">
              <Slider
                label="Max in any one asset"
                value={maxW}
                min={0.05}
                max={1}
                step={0.01}
                onChange={(v) => {
                  setMaxW(v);
                  setPicked(null);
                }}
                format={(v) => pct(Math.max(v, ids.length ? 1 / ids.length : 1), 0)}
              />
              <Slider
                label="Min in every asset"
                value={minW}
                min={0}
                max={0.2}
                step={0.01}
                onChange={(v) => {
                  setMinW(v);
                  setPicked(null);
                }}
                format={(v) => pct(v, 0)}
              />
              <Slider
                label="Max in stocks overall"
                value={stockCap}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(v) => {
                  setStockCap(v);
                  setPicked(null);
                }}
                format={(v) => pct(v, 0)}
              />
              <Slider
                label="Max in crypto overall"
                value={cryptoCap}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => {
                  setCryptoCap(v);
                  setPicked(null);
                }}
                format={(v) => pct(v, 0)}
              />
            </div>
          </Card>

          <Card className="card-pad">
            <CardHeader title="4 · Estimates" subtitle="How the future is estimated from the past." />
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-xs font-medium text-ink-3">History window</div>
                <Segmented
                  size="sm"
                  label="Optimizer history"
                  value={settings.lookback}
                  onChange={(v) => settings.set({ lookback: v })}
                  options={LOOKBACKS}
                />
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-3">Expected returns</span>
                <select
                  className="input !py-1.5"
                  value={settings.returnModel}
                  onChange={(e) => settings.set({ returnModel: e.target.value as ReturnModel })}
                >
                  {RETURN_MODELS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-3">
                  {RETURN_MODELS.find((r) => r.value === settings.returnModel)?.blurb}
                </span>
              </label>
              {pro && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink-3">Risk model</span>
                  <select
                    className="input !py-1.5"
                    value={settings.covariance}
                    onChange={(e) =>
                      settings.set({ covariance: e.target.value as typeof settings.covariance })
                    }
                  >
                    {Object.entries(COV_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <ViewsEditor
                ids={ids}
                names={names}
                views={views}
                onChange={(v) => {
                  setViews(v);
                  setPicked(null);
                }}
              />
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {opt.error ? (
            <Card className="card-pad">
              <Callout tone="warn" title="These settings can't be satisfied">
                {opt.error.message}
              </Callout>
            </Card>
          ) : !res || !chosen ? (
            <Skeleton className="h-[520px]" />
          ) : (
            <>
              <ChartCard
                className={cx('transition-opacity', opt.isFetching && 'opacity-60')}
                title="The efficient frontier"
                subtitle={`Every dot is a possible portfolio. The blue curve is the best return achievable at each level of risk — click anywhere on it to choose that portfolio. Estimates use ${number(res.window.years, 1)} years of data (${res.window.start} → ${res.window.end}).`}
                right={
                  picked !== null ? (
                    <button className="btn-quiet !py-1 text-xs" onClick={() => setPicked(null)}>
                      Back to objective
                    </button>
                  ) : undefined
                }
                table={{
                  columns: ['Point', 'Return', 'Risk', 'Sharpe'],
                  rows: res.frontier.map((f, i) => [`#${i + 1}`, pct(f.ret), pct(f.vol), number(f.sharpe)]),
                }}
              >
                <FrontierChart
                  frontier={res.frontier}
                  cloud={res.cloud}
                  assets={res.assets.map((a) => ({
                    ...a,
                    label: data.assets.get(a.id)!.meta.symbol,
                  }))}
                  specials={res.specials.map((s) => ({ key: s.key, label: s.label, vol: s.vol, ret: s.ret }))}
                  current={res.current ? { vol: res.current.vol, ret: res.current.ret } : undefined}
                  selected={{ vol: chosen.vol, ret: chosen.ret, label: chosen.label }}
                  riskFree={rf}
                  onPick={setPicked}
                />
              </ChartCard>

              {res.result.warnings.length > 0 && picked === null && (
                <Callout tone="warn">{res.result.warnings.join(' ')}</Callout>
              )}

              <Card className="card-pad">
                <CardHeader
                  title={`Result: ${chosen.label}`}
                  subtitle="Expected figures are estimates from history, not promises."
                  right={
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-ghost !py-1.5 text-[13px]" onClick={() => apply(true)}>
                        <Save size={15} /> Save as new
                      </button>
                      <button className="btn-primary !py-1.5 text-[13px]" onClick={() => apply(false)}>
                        Apply to my portfolio <ArrowRight size={15} />
                      </button>
                    </div>
                  }
                />
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    [
                      'Expected return',
                      pct(chosen.ret),
                      res.current ? pct(res.current.ret) : null,
                      chosen.ret - (res.current?.ret ?? chosen.ret),
                      true,
                    ],
                    [
                      'Risk (volatility)',
                      pct(chosen.vol),
                      res.current ? pct(res.current.vol) : null,
                      chosen.vol - (res.current?.vol ?? chosen.vol),
                      false,
                    ],
                    [
                      'Sharpe ratio',
                      number(chosen.sharpe),
                      res.current ? number(res.current.sharpe) : null,
                      chosen.sharpe - (res.current?.sharpe ?? chosen.sharpe),
                      true,
                    ],
                    [
                      'Holdings used',
                      String(chosen.weights.filter((w) => w > 0.001).length),
                      String(current.length),
                      0,
                      true,
                    ],
                  ].map(([label, v, was, d, upGood]) => (
                    <div key={label as string} className="rounded-xl border border-line bg-surface-2 p-3">
                      <div className="text-xs text-ink-3">{label as string}</div>
                      <div className="mt-0.5 text-[20px] font-semibold">{v as string}</div>
                      {was !== null && (
                        <div className="text-xs text-ink-3">
                          yours: {was as string}
                          {Math.abs(d as number) > 1e-4 && (
                            <span
                              className={cx(
                                'ml-1 font-semibold',
                                (d as number) > 0 === upGood ? 'text-pos' : 'text-neg',
                              )}
                            >
                              ({(d as number) > 0 ? '▲' : '▼'})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-[13px]">
                    <thead className="bg-surface-2 text-left text-xs text-ink-3">
                      <tr>
                        <th className="px-3 py-2 font-medium">Asset</th>
                        <th className="px-3 py-2 text-right font-medium">Now</th>
                        <th className="px-3 py-2 text-right font-medium">Suggested</th>
                        <th className="w-[38%] px-3 py-2 font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ids
                        .map((id, i) => ({
                          id,
                          now: current.find((h) => h.id === id)?.weight ?? 0,
                          to: chosen.weights[i],
                        }))
                        .sort((x, y) => y.to - x.to)
                        .map((r, k) => (
                          <tr key={r.id} className="border-t border-line">
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-[3px]"
                                  style={{ background: seriesColor(k) }}
                                />
                                {names(r.id)}
                              </span>
                            </td>
                            <td className="num px-3 py-2 text-right text-ink-2">{pct(r.now, 1)}</td>
                            <td className="num px-3 py-2 text-right font-semibold">{pct(r.to, 1)}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="relative h-2 flex-1 rounded-full bg-surface-3">
                                  <div
                                    className="absolute top-0 h-2 rounded-full"
                                    style={{
                                      left: `${Math.min(r.now, r.to) * 100}%`,
                                      width: `${Math.max(Math.abs(r.to - r.now) * 100, 0.6)}%`,
                                      background: r.to >= r.now ? 'var(--s1)' : 'var(--s8)',
                                    }}
                                  />
                                </div>
                                <span
                                  className={cx(
                                    'num w-14 text-right text-xs font-semibold',
                                    r.to > r.now + 1e-4
                                      ? 'text-pos'
                                      : r.to < r.now - 1e-4
                                        ? 'text-neg'
                                        : 'text-ink-3',
                                  )}
                                >
                                  {signedPct(r.to - r.now, 1).replace('%', ' pp')}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {res.explanation.length > 0 && picked === null && (
                  <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3.5">
                    <div className="mb-2 text-[13px] font-semibold">Why these changes</div>
                    <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                      {res.explanation.slice(0, 6).map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {plan && (
                <Card className="card-pad">
                  <CardHeader
                    title="Trade list"
                    subtitle={`To move ${money(p.amount, base, 0)} from your current weights to the suggestion. Sells are listed first because they fund the buys.`}
                    right={<Switch checked={fractional} onChange={setFractional} label="Fractional units" />}
                  />
                  {plan.trades.length === 0 ? (
                    <p className="text-sm text-ink-3">Nothing to trade — you already hold this mix.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full text-[13px]">
                        <thead className="bg-surface-2 text-left text-xs text-ink-3">
                          <tr>
                            <th className="px-3 py-2 font-medium">Action</th>
                            <th className="px-3 py-2 font-medium">Asset</th>
                            <th className="px-3 py-2 text-right font-medium">Units</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.trades.map((t) => (
                            <tr key={t.id} className="border-t border-line">
                              <td className="px-3 py-2">
                                <span
                                  className={cx(
                                    'rounded-md px-1.5 py-0.5 text-xs font-bold',
                                    t.side === 'buy' ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg',
                                  )}
                                >
                                  {t.side === 'buy' ? 'BUY' : 'SELL'}
                                </span>
                              </td>
                              <td className="px-3 py-2">{names(t.id)}</td>
                              <td className="num px-3 py-2 text-right">
                                {fractional ? number(t.units, 3) : number(t.units, 0)}
                              </td>
                              <td className="num px-3 py-2 text-right font-semibold">
                                {money(t.value, base, 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-ink-3">
                    Turnover {pct(plan.turnover, 0)} · est. costs {money(plan.estimatedCost, base, 0)} (10 bp)
                    · cash left {money(plan.cashLeft, base, 0)}. Check taxes before selling — gains may be
                    taxable.
                  </p>
                </Card>
              )}
            </>
          )}

          <SectionTitle
            right={
              !runWF && (
                <button
                  className="btn-ghost text-[13px]"
                  disabled={ids.length < 2}
                  onClick={() => setRunWF(true)}
                >
                  <FlaskConical size={15} /> Run the test
                </button>
              )
            }
          >
            Would it actually have worked?
          </SectionTitle>
          <Card className="card-pad">
            {!runWF ? (
              <p className="text-[14px] leading-relaxed text-ink-2">
                Optimisers always look brilliant on the data they were fitted to. The honest test is{' '}
                <strong>walk-forward</strong>: every quarter, each strategy sees only the previous year of
                data, picks weights, and is then judged on what happened next. Run it to see which approach
                would have served you best — out of sample, after costs.
              </p>
            ) : wf.isLoading || !wf.data ? (
              <div className="space-y-3">
                <div className="text-sm text-ink-3">Replaying {ids.length} assets through every quarter…</div>
                <Skeleton className="h-[280px]" />
              </div>
            ) : wf.error ? (
              <Callout tone="warn">{wf.error.message}</Callout>
            ) : (
              <WalkForwardView wf={wf.data} base={base} />
            )}
          </Card>
          <p className="text-xs text-ink-3">
            Educational illustration, not advice. Optimised weights depend heavily on estimates of future
            returns, which are uncertain. Frontier shrinks those estimates and offers robust methods (risk
            parity, HRP) that do not need them.
          </p>
          <Link to="/learn" className="text-xs font-medium text-accent hover:underline">
            How do these methods work? →
          </Link>
        </div>
      </div>
    </div>
  );
}

function ViewsEditor({
  ids,
  names,
  views,
  onChange,
}: {
  ids: string[];
  names: (id: string) => string;
  views: ViewDraft[];
  onChange: (v: ViewDraft[]) => void;
}) {
  if (ids.length < 2) return null;
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[13px] font-semibold">Your views (Black–Litterman)</span>
        <button
          className="btn-quiet !px-2 !py-1 text-xs"
          onClick={() =>
            onChange([...views, { kind: 'absolute', a: ids[0], b: ids[1], value: 0.1, confidence: 0.5 }])
          }
        >
          <Plus size={13} /> Add view
        </button>
      </div>
      <p className="mb-2 text-xs text-ink-3">
        Have an opinion? Blend it with the data, weighted by how confident you are.
      </p>
      <div className="space-y-2.5">
        {views.map((v, i) => {
          const upd = (patch: Partial<ViewDraft>) =>
            onChange(views.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="space-y-2 rounded-lg bg-surface-2 p-2.5 text-xs">
              <div className="flex items-center gap-1.5">
                <select
                  className="input !w-auto !px-2 !py-1 text-xs"
                  value={v.kind}
                  onChange={(e) => upd({ kind: e.target.value as ViewDraft['kind'] })}
                  aria-label="Type of view"
                >
                  <option value="absolute">Return of</option>
                  <option value="relative">Outperformance of</option>
                </select>
                <select
                  className="input !px-2 !py-1 text-xs"
                  value={v.a}
                  onChange={(e) => upd({ a: e.target.value })}
                  aria-label="Asset"
                >
                  {ids.map((id) => (
                    <option key={id} value={id}>
                      {names(id)}
                    </option>
                  ))}
                </select>
                <button
                  className="ml-auto rounded p-1 text-ink-3 hover:text-neg"
                  onClick={() => onChange(views.filter((_, j) => j !== i))}
                  aria-label="Remove view"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {v.kind === 'relative' && (
                  <>
                    <span className="text-ink-3">over</span>
                    <select
                      className="input !w-auto !px-2 !py-1 text-xs"
                      value={v.b}
                      onChange={(e) => upd({ b: e.target.value })}
                      aria-label="Compared with"
                    >
                      {ids
                        .filter((id) => id !== v.a)
                        .map((id) => (
                          <option key={id} value={id}>
                            {names(id)}
                          </option>
                        ))}
                    </select>
                  </>
                )}
                <span className="text-ink-3">will be</span>
                <input
                  className="input num !w-20 !px-2 !py-1 text-xs"
                  type="number"
                  step={0.5}
                  value={Number((v.value * 100).toFixed(1))}
                  onChange={(e) => upd({ value: (Number(e.target.value) || 0) / 100 })}
                  aria-label="Expected return in percent"
                />
                <span className="text-ink-3">% a year</span>
              </div>
              <Slider
                label="Confidence"
                value={v.confidence}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(c) => upd({ confidence: c })}
                format={(c) => pct(c, 0)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
