import { ArrowRight, Gauge, Radar, Sparkles, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { AssetSnapshot, MarketSummary } from '@frontier/contracts';
import { useHistories, useIntraday, useMarketData } from '@/lib/data';
import { useLiveTicks } from '@/lib/live';
import { fmtChange, fmtPrice, pct, signedPct, timeAgo } from '@/lib/format';
import { Card, CardHeader, Delta, Segmented, cx } from '@/components/ui/primitives';
import { AssetName, DataState, RegimePill, SectionTitle, SignalBadge } from '@/components/domain/common';
import { ChartCard, Columns, DivergingLegend, MoodGauge, Sparkline } from '@/components/charts/charts';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { diverging, inkOn, useSize, useTheme } from '@/components/charts/core';

const TICKER = ['GSPC', 'IXIC', 'NSEI', 'BSESN', 'BTC-USD', 'ETH-USD', 'GC', 'USDINR', 'VIX', 'TNX'];

function useLiveAsset(a: AssetSnapshot | undefined) {
  const live = useLiveTicks();
  if (!a) return undefined;
  const t = live[a.meta.id];
  if (!t) return a;
  return {
    ...a,
    quote: { ...a.quote, price: t.price, changePct: t.changePct24h, change: t.price - t.open24h },
  };
}

function TickerItem({ a }: { a: AssetSnapshot }) {
  const live = useLiveAsset(a)!;
  const isLive = live !== a;
  return (
    <Link
      to={`/asset/${encodeURIComponent(a.meta.id)}`}
      className="flex min-w-[148px] flex-col gap-0.5 rounded-xl px-3 py-2 transition hover:bg-surface-2"
    >
      <span className="flex items-center gap-1.5 text-xs text-ink-3">
        {a.meta.short}
        {isLive && (
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-good text-good" title="Streaming live" />
        )}
      </span>
      <span className="num text-[15px] font-semibold text-ink">{fmtPrice(live)}</span>
      <span
        className={cx(
          'num text-xs font-medium',
          live.quote.changePct > 0 ? 'text-pos' : live.quote.changePct < 0 ? 'text-neg' : 'text-ink-3',
        )}
      >
        {fmtChange(live)}
        {isLive ? ' 24h' : ''}
      </span>
    </Link>
  );
}

function ResponsiveSpark({ values, height }: { values: number[]; height: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 && <Sparkline values={values} width={width} height={height} />}
    </div>
  );
}

function MarketCard({ m, assets }: { m: MarketSummary; assets: Map<string, AssetSnapshot> }) {
  const intraday = useIntraday();
  const idx = assets.get(m.benchmarkId);
  const series = intraday.data?.series[m.benchmarkId];
  const up = idx ? idx.quote.changePct >= 0 : true;
  return (
    <Card className="card-pad flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label">{m.name}</div>
          {idx && (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[22px] font-semibold tracking-tight">{idx.meta.short}</span>
              <span className="num text-[15px] text-ink-2">{fmtPrice(idx)}</span>
              <Delta value={idx.quote.changePct} />
            </div>
          )}
        </div>
        <RegimePill r={m.regime} />
      </div>
      <p className="text-[14px] leading-relaxed text-ink-2">{m.headline}</p>
      {series && series.t.length > 3 ? (
        <TimeSeriesChart
          ariaLabel={`${idx?.meta.short} today`}
          dates={series.t}
          intraday
          height={150}
          xLabel={(i) =>
            new Date(series.t[i] * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
          baseline={series.previousClose}
          series={[
            {
              key: 'p',
              label: idx?.meta.short ?? '',
              values: series.p,
              color: up ? 'var(--s1)' : 'var(--s8)',
              area: true,
            },
          ]}
          yFormat={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        />
      ) : idx ? (
        <div>
          <div className="mb-1 text-xs text-ink-3">Last 90 trading days</div>
          <ResponsiveSpark values={idx.spark} height={110} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[200px_1fr]">
        {m.mood && (
          <div className="flex flex-col items-center">
            <MoodGauge value={m.mood.score} label={m.mood.label} size={190} />
            <div className="-mt-1 text-sm font-semibold">{m.mood.label}</div>
          </div>
        )}
        <ul className="space-y-1.5 text-[13px] text-ink-2">
          {m.mood?.components.slice(0, 4).map((c) => (
            <li key={c.key} className="flex gap-2">
              <span className="num w-8 shrink-0 text-right font-semibold text-ink">{c.score}</span>
              <span>
                <span className="font-medium text-ink">{c.label}:</span> {c.detail}
              </span>
            </li>
          ))}
          <li className="pt-1 text-xs text-ink-3">
            Breadth: {m.breadth.advancers} up · {m.breadth.decliners} down · {m.breadth.aboveSma200}/
            {m.breadth.total} above their 200-day average
          </li>
        </ul>
      </div>
    </Card>
  );
}

type Period = 'd1' | 'm1' | 'ytd' | 'y1';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'd1', label: '1D' },
  { value: 'm1', label: '1M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'y1', label: '1Y' },
];

function MarketMap({ assets }: { assets: AssetSnapshot[] }) {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('d1');
  const [region, setRegion] = useState<'US' | 'IN'>('US');
  const groups = useMemo(() => {
    const list = assets.filter(
      (a) => a.meta.region === region && (a.meta.kind === 'stock' || a.meta.tags?.includes('sector')),
    );
    const by = new Map<string, AssetSnapshot[]>();
    for (const a of list) {
      const k = a.meta.tags?.includes('sector') ? 'Sector funds' : (a.meta.sector ?? 'Other');
      by.set(k, [...(by.get(k) ?? []), a]);
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [assets, region]);
  const scale = period === 'd1' ? 0.03 : period === 'm1' ? 0.1 : 0.3;
  const all = groups.flatMap(([, g]) => g);
  return (
    <ChartCard
      title="Market map"
      subtitle="Every tile is a company or sector fund, coloured by its return. Blue = up, red = down."
      right={
        <div className="flex flex-wrap gap-2">
          <Segmented
            size="sm"
            label="Map region"
            value={region}
            onChange={setRegion}
            options={[
              { value: 'US', label: 'US' },
              { value: 'IN', label: 'India' },
            ]}
          />
          <Segmented size="sm" label="Map period" value={period} onChange={setPeriod} options={PERIODS} />
        </div>
      }
      table={{
        columns: ['Asset', 'Group', 'Return'],
        rows: all.map((a) => [a.meta.short, a.meta.sector ?? '', signedPct(a.stats.returns[period])]),
      }}
      footer={<DivergingLegend min={signedPct(-scale, 0)} max={signedPct(scale, 0)} label="Colour scale" />}
    >
      <div className="space-y-3">
        {groups.map(([g, list]) => (
          <div key={g}>
            <div className="mb-1.5 text-xs font-medium text-ink-3">{g}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5">
              {list.map((a) => {
                const v = a.stats.returns[period];
                const fill = v === null ? 'var(--surface-2)' : diverging(v / scale, theme);
                const ink = v === null ? 'var(--text-2)' : inkOn(fill);
                return (
                  <Link
                    key={a.meta.id}
                    to={`/asset/${encodeURIComponent(a.meta.id)}`}
                    className="group rounded-lg px-2.5 py-2 transition hover:brightness-110"
                    style={{ background: fill, color: ink }}
                    title={`${a.meta.name}: ${signedPct(v)}`}
                  >
                    <div className="truncate text-[12px] font-semibold">
                      {a.meta.symbol.replace('.NS', '')}
                    </div>
                    <div className="num text-[12px] opacity-90">{signedPct(v)}</div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

const SCOREBOARD = [
  ['SPY', 'US', 'US stocks'],
  ['VEA', 'Intl', 'International stocks'],
  ['VWO', 'EM', 'Emerging markets'],
  ['NIFTYBEES.NS', 'India', 'Indian stocks'],
  ['AGG', 'Bonds', 'US bonds'],
  ['TLT', 'Long', 'Long Treasuries'],
  ['GLD', 'Gold', 'Gold'],
  ['VNQ', 'REIT', 'Real estate'],
  ['BTC-USD', 'BTC', 'Bitcoin'],
  ['CASH-USD', 'Cash', 'Cash'],
] as const;

function Scoreboard({ assets }: { assets: Map<string, AssetSnapshot> }) {
  const [period, setPeriod] = useState<'m1' | 'ytd' | 'y1' | 'y3'>('ytd');
  const items = SCOREBOARD.flatMap(([id, label, long]) => {
    const a = assets.get(id);
    const v = a?.stats.returns[period];
    return a && v !== null && v !== undefined ? [{ key: id, label, long, value: v }] : [];
  });
  return (
    <ChartCard
      title="Cross-asset scoreboard"
      subtitle={
        period === 'y3'
          ? 'Annualised return over 3 years, local currency.'
          : 'Total return in local currency.'
      }
      right={
        <Segmented
          size="sm"
          label="Scoreboard period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'm1', label: '1M' },
            { value: 'ytd', label: 'YTD' },
            { value: 'y1', label: '1Y' },
            { value: 'y3', label: '3Y/yr' },
          ]}
        />
      }
      table={{ columns: ['Asset class', 'Return'], rows: items.map((i) => [i.long, signedPct(i.value)]) }}
    >
      <Columns
        items={items}
        height={230}
        format={(v) => signedPct(v, 0)}
        ariaLabel="Returns by asset class"
      />
    </ChartCard>
  );
}

function RegimeHistory({ m }: { m: MarketSummary }) {
  const { data } = useHistories([m.benchmarkId]);
  const hist = data[m.benchmarkId];
  const chart = useMemo(() => {
    if (!hist || !m.regime) return null;
    const start = Date.parse(m.regime.history.dates[0]) / 86_400_000;
    const i0 = hist.dates.findIndex((d) => d >= start);
    const dates = hist.dates.slice(i0);
    const values = hist.values.slice(i0);
    // map weekly regime probabilities onto the daily index → shaded bands
    const bands: { from: number; to: number; color: string }[] = [];
    let open: number | null = null;
    let w = 0;
    for (let i = 0; i < dates.length; i++) {
      while (
        w + 1 < m.regime.history.dates.length &&
        Date.parse(m.regime.history.dates[w + 1]) / 86_400_000 <= dates[i]
      )
        w++;
      const turb = m.regime.history.turbulent[w] > 0.5;
      if (turb && open === null) open = i;
      if ((!turb || i === dates.length - 1) && open !== null) {
        bands.push({ from: open, to: i, color: 'color-mix(in oklab, var(--serious) 16%, transparent)' });
        open = null;
      }
    }
    return { dates, values, bands };
  }, [hist, m.regime]);
  if (!m.regime) return null;
  const r = m.regime;
  return (
    <ChartCard
      title={`${m.name}: market regimes over 5 years`}
      subtitle="A Hidden Markov Model reads daily returns and infers whether the market is in a calm or a turbulent state. Shaded = turbulent."
      table={
        chart
          ? {
              columns: ['Week', 'P(turbulent)'],
              rows: r.history.dates.map((d, i) => [d, pct(r.history.turbulent[i], 0)]),
            }
          : undefined
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {r.states.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="text-xs capitalize text-ink-3">{s.label} state</div>
            <div className="num mt-0.5 text-[15px] font-semibold">{pct(s.volAnnual, 0)} vol</div>
            <div className="text-xs text-ink-3">lasts ~{Math.round(s.expectedDurationDays)} days</div>
          </div>
        ))}
        <div className="col-span-2 rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
          {r.text} <span className="text-ink-3">Current state since {r.since}.</span>
        </div>
      </div>
      {chart ? (
        <TimeSeriesChart
          ariaLabel={`${m.name} index with regime shading`}
          dates={chart.dates}
          series={[{ key: 'px', label: 'Index level', values: chart.values, color: 'var(--s1)' }]}
          bands={chart.bands}
          height={240}
          yFormat={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        />
      ) : (
        <div className="skeleton h-[240px]" />
      )}
    </ChartCard>
  );
}

export default function Today() {
  const { data, isLoading, error } = useMarketData();
  return (
    <DataState isLoading={isLoading} error={error}>
      {data && <TodayView data={data} />}
    </DataState>
  );
}

function TodayView({ data }: { data: NonNullable<ReturnType<typeof useMarketData>['data']> }) {
  const { snapshot, assets } = data;
  const ticker = TICKER.map((id) => assets.get(id)).filter((a): a is AssetSnapshot => !!a);
  const leaders = data.investable
    .filter((a) => a.signals && a.meta.kind !== 'cash')
    .sort((a, b) => b.signals!.score - a.signals!.score)
    .slice(0, 8);
  const gainers = snapshot.movers.gainers.map((id) => assets.get(id)).filter((a): a is AssetSnapshot => !!a);
  const losers = snapshot.movers.losers.map((id) => assets.get(id)).filter((a): a is AssetSnapshot => !!a);
  const date = new Date(snapshot.generatedAt).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <div>
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative mb-6 overflow-hidden rounded-[28px] border border-line bg-surface p-6 sm:p-9"
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.35),transparent)] blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(45,212,191,0.22),transparent)] blur-2xl"
          aria-hidden
        />
        <div className="relative max-w-3xl">
          <div className="label mb-3 flex items-center gap-2">
            <Zap size={13} className="text-accent" /> Market briefing · {date} · updated{' '}
            {timeAgo(snapshot.generatedAt)}
          </div>
          <h1 className="text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-[48px]">
            Invest with <span className="gradient-text">clarity</span>, not guesswork.
          </h1>
          <div className="mt-4 space-y-1.5 text-[15.5px] leading-relaxed text-ink-2">
            {snapshot.markets.map((m) => (
              <p key={m.key}>{m.headline}</p>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/start" className="btn-primary !px-5 !py-2.5">
              <Sparkles size={16} /> Find my portfolio in 60 seconds
            </Link>
            <Link to="/portfolio" className="btn-ghost !px-5 !py-2.5">
              Analyse my portfolio <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </motion.section>

      <Card className="mb-6 overflow-x-auto p-1.5">
        <div className="flex min-w-max gap-1">
          {ticker.map((a) => (
            <TickerItem key={a.meta.id} a={a} />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {snapshot.markets.map((m) => (
          <MarketCard key={m.key} m={m} assets={assets} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <MarketMap assets={snapshot.assets} />
        <div className="flex flex-col gap-4">
          <Scoreboard assets={assets} />
          <Card className="card-pad">
            <CardHeader
              title="Today's biggest movers"
              subtitle="Investable assets, last session."
              icon={<Gauge size={16} className="text-accent" />}
            />
            <div className="grid grid-cols-2 gap-4">
              {[
                ['Gainers', gainers],
                ['Decliners', losers],
              ].map(([label, list]) => (
                <div key={label as string}>
                  <div className="label mb-2">{label as string}</div>
                  <ul className="space-y-2">
                    {(list as AssetSnapshot[]).map((a) => (
                      <li key={a.meta.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <AssetName a={a} sub={false} />
                        <Delta value={a.stats.returns.d1} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <SectionTitle
        right={
          <Link to="/markets" className="btn-quiet text-[13px]">
            All markets <ArrowRight size={14} />
          </Link>
        }
      >
        Strongest trends right now
      </SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {leaders.map((a) => (
          <Card key={a.meta.id} className="card-pad flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <AssetName a={a} />
              <SignalBadge s={a.signals} compact />
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="num text-[17px] font-semibold">{fmtPrice(a)}</div>
                <div className="text-xs text-ink-3">1Y {signedPct(a.stats.returns.y1)}</div>
              </div>
              <Sparkline values={a.spark} />
            </div>
            <p className="line-clamp-2 text-[12.5px] leading-snug text-ink-3">
              {a.signals?.reasons[0]?.text}
            </p>
          </Card>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
        <Radar size={13} /> Trend scores describe recent price behaviour (trend, momentum, risk-adjusted
        return). They are not predictions.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4">
        {snapshot.markets
          .filter((m) => m.regime)
          .slice(0, 1)
          .map((m) => (
            <RegimeHistory key={m.key} m={m} />
          ))}
      </div>
    </div>
  );
}
