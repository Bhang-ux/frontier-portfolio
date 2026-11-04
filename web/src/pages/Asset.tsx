import { ArrowLeft, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { AssetSnapshot } from '@frontier/contracts';
import { calendarReturns, explain, lowerBound, sma, type Series } from '@frontier/quant';
import { useHistories, useMarketData } from '@/lib/data';
import { useLiveTicks } from '@/lib/live';
import { usePortfolios } from '@/lib/store';
import {
  CLASS_LABEL,
  REGION_LABEL,
  SIGNAL_LABEL,
  fmtChange,
  fmtPrice,
  number,
  pct,
  signedPct,
} from '@/lib/format';
import { ChartCard, Columns, ScoreRing } from '@/components/charts/charts';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import {
  Card,
  CardHeader,
  Delta,
  ProgressBar,
  Segmented,
  Skeleton,
  Stat,
  Switch,
  cx,
} from '@/components/ui/primitives';
import { DataState, SignalBadge, WatchStar } from '@/components/domain/common';

const RANGES = [
  { value: 30, label: '1M' },
  { value: 182, label: '6M' },
  { value: -1, label: 'YTD' },
  { value: 365, label: '1Y' },
  { value: 1826, label: '5Y' },
  { value: 0, label: 'Max' },
];

export default function AssetPage() {
  const { id = '' } = useParams();
  const md = useMarketData();
  const a = md.data?.assets.get(decodeURIComponent(id));
  return (
    <DataState isLoading={md.isLoading} error={md.error}>
      {md.data && !a ? (
        <Card className="card-pad mx-auto max-w-lg text-center">
          <div className="font-semibold">Unknown asset “{id}”</div>
          <Link to="/markets" className="btn-ghost mt-4">
            Browse markets
          </Link>
        </Card>
      ) : a ? (
        <AssetView a={a} />
      ) : null}
    </DataState>
  );
}

function AssetView({ a }: { a: AssetSnapshot }) {
  const nav = useNavigate();
  const live = useLiveTicks()[a.meta.id];
  const { data: hist } = useHistories([a.meta.id]);
  const series = hist[a.meta.id];
  const [range, setRange] = useState(365);
  const [ma, setMa] = useState(true);
  const [log, setLog] = useState(false);
  const p = usePortfolios((s) => s.active());
  const setHoldings = usePortfolios((s) => s.setHoldings);
  const held = p.holdings.some((h) => h.id === a.meta.id);
  const isLevel = a.meta.kind === 'rate' || a.meta.assetClass === 'volatility';
  const price = live?.price ?? a.quote.price;
  const change = live ? live.changePct24h : a.quote.changePct;

  const view = useMemo(() => {
    if (!series) return null;
    const end = series.dates[series.dates.length - 1];
    const start =
      range === 0
        ? series.dates[0]
        : range === -1
          ? Math.floor(Date.UTC(new Date(end * 86_400_000).getUTCFullYear(), 0, 1) / 86_400_000) - 1
          : end - range;
    const i0 = Math.max(0, lowerBound(series.dates, start) - 1);
    const s50 = sma(series.values, 50);
    const s200 = sma(series.values, 200);
    const slice = (x: (number | null)[]) =>
      x.slice(i0).map((v) => (v === null || Number.isNaN(v) ? null : v));
    let peak = -Infinity;
    const dd = series.values.map((v) => {
      peak = Math.max(peak, v);
      return v / peak - 1;
    });
    return {
      dates: series.dates.slice(i0),
      px: series.values.slice(i0),
      s50: slice(s50),
      s200: slice(s200),
      dd: dd.slice(i0),
    };
  }, [series, range]);
  const yearly = useMemo(() => (series ? calendarReturns(series as Series, 'Y').slice(-12) : []), [series]);
  const st = a.stats;
  const r = st.returns;
  const add = () => {
    if (held) return nav('/portfolio');
    setHoldings(p.id, [...p.holdings, { id: a.meta.id, weight: 0.05 }]);
    toast.success(`${a.meta.short} added to “${p.name}”`, {
      description: 'Added at 5% — adjust the weight on the portfolio page.',
      action: { label: 'Open', onClick: () => nav('/portfolio') },
    });
  };
  const rangeRet = view ? view.px[view.px.length - 1] / view.px[0] - 1 : null;

  return (
    <div>
      <button
        className="btn-quiet mb-3 !px-2 text-[13px]"
        onClick={() => (history.length > 1 ? nav(-1) : nav('/markets'))}
      >
        <ArrowLeft size={15} /> Back
      </button>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="chip font-mono">{a.meta.symbol}</span>
            <span className="chip">{CLASS_LABEL[a.meta.assetClass]}</span>
            <span className="chip">{REGION_LABEL[a.meta.region] ?? a.meta.region}</span>
            {a.meta.sector && <span className="chip">{a.meta.sector}</span>}
            {live && (
              <span className="chip">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-good text-good" /> Live
              </span>
            )}
            <WatchStar id={a.meta.id} />
          </div>
          <h1 className="text-[30px] font-semibold tracking-tight sm:text-[36px]">{a.meta.name}</h1>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="text-[30px] font-semibold">{fmtPrice(a, price)}</span>
            {isLevel ? (
              <span className="num text-[15px] text-ink-2">{fmtChange(a)}</span>
            ) : (
              <Delta value={change} className="text-[16px]" suffix={live ? ' 24h' : ''} />
            )}
            <span className="text-xs text-ink-3">
              as of {new Date(live ? live.ts : a.quote.asOf).toLocaleString()}
            </span>
          </div>
        </div>
        {a.meta.investable && (
          <button className="btn-primary self-start lg:self-auto" onClick={add}>
            <Plus size={16} /> {held ? 'In your portfolio — open' : `Add to “${p.name}”`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <ChartCard
          title="Price history"
          subtitle={
            view && rangeRet !== null
              ? `${signedPct(rangeRet)} over this period${isLevel ? '' : ' (total return, dividends reinvested)'}.`
              : undefined
          }
          right={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Segmented size="sm" label="Chart range" value={range} onChange={setRange} options={RANGES} />
            </div>
          }
          footer={
            !isLevel && (
              <div className="flex flex-wrap gap-4">
                <Switch checked={ma} onChange={setMa} label="50 & 200-day averages" />
                <Switch checked={log} onChange={setLog} label="Log scale" />
              </div>
            )
          }
        >
          {view ? (
            <TimeSeriesChart
              ariaLabel={`${a.meta.short} price history`}
              dates={view.dates}
              height={400}
              log={log}
              yFormat={(v) =>
                a.meta.kind === 'rate'
                  ? `${v.toFixed(1)}%`
                  : v >= 1000
                    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
                    : v.toFixed(v < 10 ? 2 : 1)
              }
              series={[
                {
                  key: 'px',
                  label: isLevel ? 'Level' : 'Price (adjusted)',
                  values: view.px,
                  color: 'var(--s1)',
                  area: !log,
                },
                ...(ma && !isLevel
                  ? [
                      {
                        key: 's50',
                        label: '50-day average',
                        values: view.s50,
                        color: 'var(--s2)',
                        width: 1.5,
                      },
                      {
                        key: 's200',
                        label: '200-day average',
                        values: view.s200,
                        color: 'var(--s3)',
                        width: 1.5,
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <Skeleton className="h-[400px]" />
          )}
        </ChartCard>
        <div className="flex flex-col gap-4">
          <Card className="card-pad">
            <CardHeader title="The short story" />
            <p className="text-[14px] leading-relaxed text-ink-2">{a.meta.description}</p>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{a.summary}</p>
            {a.meta.role && (
              <p className="mt-3 text-[13px] text-ink-3">
                Typical role in a portfolio: <span className="font-medium text-ink-2">{a.meta.role}</span>
              </p>
            )}
          </Card>
          {a.signals && <SignalCard a={a} />}
        </div>
      </div>

      {!isLevel && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="1-year return"
              value={signedPct(r.y1)}
              explain={r.y1 !== null ? explain.explainCagr(r.y1, 1, 10_000, a.meta.currency).text : undefined}
            />
            <Stat
              label="5-year return / yr"
              value={signedPct(r.y5)}
              sub={r.y10 !== null ? `10Y: ${signedPct(r.y10)}/yr` : undefined}
              explain={
                r.y5 !== null
                  ? explain.explainCagr(r.y5, 5, 10_000, a.meta.currency).text
                  : 'Not enough history yet.'
              }
            />
            <Stat
              label="Volatility (1Y)"
              value={pct(st.vol1y)}
              explain={st.vol1y !== null ? explain.explainVolatility(st.vol1y).text : undefined}
            />
            <Stat
              label="Sharpe (3Y)"
              value={number(st.sharpe3y)}
              sub={`1Y: ${number(st.sharpe1y)}`}
              explain={st.sharpe3y !== null ? explain.explainSharpe(st.sharpe3y).text : undefined}
            />
            <Stat
              label="Worst fall (all data)"
              value={pct(st.maxDrawdownAll !== null ? -st.maxDrawdownAll : null, 0)}
              tone="neg"
              sub={
                st.currentDrawdown && st.currentDrawdown > 0.005
                  ? `now ${pct(st.currentDrawdown, 0)} below its peak`
                  : 'at or near its all-time high'
              }
              explain={
                st.maxDrawdownAll !== null
                  ? explain.explainDrawdown(st.maxDrawdownAll, 10_000, a.meta.currency).text
                  : undefined
              }
            />
            <Stat
              label="Beta"
              value={number(st.beta)}
              sub={st.correlation !== null ? `correlation ${number(st.correlation)}` : undefined}
              explain={
                st.beta !== null
                  ? explain.explainBeta(st.beta, a.meta.region === 'IN' ? 'the Nifty' : 'the S&P 500').text
                  : undefined
              }
            />
            <Stat
              label="Bad day (VaR 95%)"
              value={pct(st.var95, 2)}
              sub={`avg. worst-5% day: ${pct(st.cvar95, 2)}`}
              explain={
                st.var95 !== null
                  ? `On 1 trading day in 20, it lost at least ${pct(st.var95, 1)}.`
                  : undefined
              }
            />
            <Stat
              label="52-week range"
              value={
                <span className="text-[18px]">
                  {st.low52 !== null && st.high52 !== null
                    ? `${fmtPrice(a, st.low52)} – ${fmtPrice(a, st.high52)}`
                    : '—'}
                </span>
              }
              sub={st.fromHigh52 !== null ? `${pct(-st.fromHigh52, 0)} below the high` : undefined}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard
              title="Drawdowns"
              subtitle="How far below its previous peak it traded — the pain an owner felt."
            >
              {view ? (
                <TimeSeriesChart
                  ariaLabel="Drawdowns"
                  dates={view.dates}
                  height={220}
                  baseline={0}
                  yFormat={(v) => pct(v, 0)}
                  series={[{ key: 'dd', label: 'Drawdown', values: view.dd, color: 'var(--s8)', area: true }]}
                />
              ) : (
                <Skeleton className="h-[220px]" />
              )}
            </ChartCard>
            <ChartCard
              title="Calendar-year returns"
              subtitle="Total return in each year (the first and current years are partial)."
              table={{ columns: ['Year', 'Return'], rows: yearly.map((y) => [y.year, signedPct(y.ret)]) }}
            >
              <Columns
                ariaLabel="Calendar year returns"
                height={220}
                items={yearly.map((y) => ({
                  key: String(y.year),
                  label: `’${String(y.year).slice(2)}`,
                  value: y.ret,
                }))}
                format={(v) => `${(v * 100).toFixed(0)}%`}
              />
            </ChartCard>
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-ink-3">
        Source: {a.source === 'yahoo' ? 'Yahoo Finance' : a.source}. History {a.history.start} →{' '}
        {a.history.end} ({a.history.points.toLocaleString()} observations). Statistics use dividend-adjusted
        prices.
      </p>
    </div>
  );
}

function SignalCard({ a }: { a: AssetSnapshot }) {
  const s = a.signals!;
  const color =
    s.label === 'strong' || s.label === 'positive'
      ? 'var(--good)'
      : s.label === 'neutral'
        ? 'var(--warning)'
        : 'var(--serious)';
  const parts = [
    ['Trend', s.components.trend, 'Price vs its 50 & 200-day averages'],
    ['Momentum', s.components.momentum, '12-month return vs similar assets'],
    ['Quality', s.components.quality, 'Risk-adjusted return vs similar assets'],
    ['Not overheated', s.components.stretch, 'Penalises extreme RSI readings'],
  ] as const;
  return (
    <Card className="card-pad">
      <CardHeader
        title="Trend & momentum score"
        subtitle="What the recent price action says — not a prediction."
        right={<SignalBadge s={s} />}
      />
      <div className="flex gap-4">
        <ScoreRing
          value={s.score}
          size={104}
          color={color}
          label={
            <>
              <span className="text-[24px] font-semibold leading-none">{s.score}</span>
              <span className="text-[11px] text-ink-3">{SIGNAL_LABEL[s.label]}</span>
            </>
          }
        />
        <ul className="min-w-0 flex-1 space-y-2">
          {parts.map(([label, v, hint]) => (
            <li key={label} title={hint}>
              <div className="mb-0.5 flex justify-between text-xs">
                <span className="text-ink-2">{label}</span>
                <span className="num text-ink-3">{Math.round(v * 100)}</span>
              </div>
              <ProgressBar value={v} height={5} />
            </li>
          ))}
        </ul>
      </div>
      <ul className="mt-4 space-y-1.5 text-[13px]">
        {s.reasons.map((r) => (
          <li key={r.key} className="flex gap-2 text-ink-2">
            <span
              className={cx(
                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                r.tone === 'positive' ? 'bg-pos' : r.tone === 'negative' ? 'bg-neg' : 'bg-ink-3',
              )}
              aria-hidden
            />
            {r.text}
          </li>
        ))}
      </ul>
      {s.rsi14 !== null && (
        <p className="mt-3 text-xs text-ink-3">
          RSI(14) {number(s.rsi14, 0)} · 50-day avg {fmtPrice(a, s.sma50 ?? NaN)} · 200-day avg{' '}
          {fmtPrice(a, s.sma200 ?? NaN)}
        </p>
      )}
    </Card>
  );
}
