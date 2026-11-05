import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AssetSnapshot } from '@frontier/contracts';
import { useMarketData } from '@/lib/data';
import { useLiveTicks } from '@/lib/live';
import { useSettings } from '@/lib/store';
import { fmtChange, fmtPrice, number, pct, signedPct, tone } from '@/lib/format';
import { Sparkline } from '@/components/charts/charts';
import { Card, PageHeader, Segmented, Switch, cx } from '@/components/ui/primitives';
import { AssetName, DataState, SignalBadge, WatchStar } from '@/components/domain/common';

type SortKey = 'name' | 'd1' | 'm1' | 'ytd' | 'y1' | 'y5' | 'vol' | 'sharpe' | 'score';
type ClassFilter = 'all' | 'india' | 'global' | 'bonds' | 'commodities' | 'crypto' | 'reference';

const classMatch = (a: AssetSnapshot, f: ClassFilter) => {
  switch (f) {
    case 'all':
      return true;
    case 'india':
      return a.meta.investable && a.meta.assetClass === 'equity' && a.meta.region === 'IN';
    case 'global':
      return a.meta.investable && a.meta.assetClass === 'equity' && a.meta.region !== 'IN';
    case 'bonds':
      return a.meta.assetClass === 'bond' || a.meta.assetClass === 'cash';
    case 'commodities':
      return a.meta.assetClass === 'commodity' || a.meta.assetClass === 'real-estate';
    case 'crypto':
      return a.meta.assetClass === 'crypto';
    case 'reference':
      return !a.meta.investable;
  }
};

export default function MarketsPage() {
  const md = useMarketData();
  const nav = useNavigate();
  const live = useLiveTicks();
  const watch = useSettings((s) => s.watchlist);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState<'all' | 'US' | 'IN' | 'GLOBAL'>('all');
  const [cls, setCls] = useState<ClassFilter>('all');
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });

  const rows = useMemo(() => {
    const list = md.data?.snapshot.assets ?? [];
    const needle = q.trim().toLowerCase();
    const val = (a: AssetSnapshot): number | string => {
      switch (sort.key) {
        case 'name':
          return a.meta.short.toLowerCase();
        case 'vol':
          return a.stats.vol1y ?? -Infinity;
        case 'sharpe':
          return a.stats.sharpe1y ?? -Infinity;
        case 'score':
          return a.signals?.score ?? -Infinity;
        default:
          return a.stats.returns[sort.key] ?? -Infinity;
      }
    };
    return list
      .filter((a) =>
        region === 'all'
          ? true
          : region === 'GLOBAL'
            ? !['US', 'IN'].includes(a.meta.region)
            : a.meta.region === region,
      )
      .filter((a) => classMatch(a, cls))
      .filter((a) => !onlyWatch || watch.includes(a.meta.id))
      .filter(
        (a) =>
          !needle ||
          `${a.meta.symbol} ${a.meta.name} ${a.meta.short} ${a.meta.sector ?? ''}`
            .toLowerCase()
            .includes(needle),
      )
      .sort((x, y) => {
        const a = val(x);
        const b = val(y);
        return (a < b ? -1 : a > b ? 1 : 0) * sort.dir;
      });
  }, [md.data, q, region, cls, onlyWatch, watch, sort]);

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={cx('px-3 py-2.5 font-medium', className)}
      aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        className={cx('inline-flex items-center gap-1 hover:text-ink', sort.key === k && 'text-ink')}
        onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : -1 })}
      >
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  return (
    <DataState isLoading={md.isLoading} error={md.error}>
      <PageHeader
        eyebrow="Markets"
        title="Every asset, ranked and explained"
        subtitle={`${md.data?.snapshot.assets.length ?? ''} instruments across US and Indian markets, refreshed automatically. Click any row for the full story.`}
      />
      <Card className="mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            className="input !pl-9"
            placeholder="Search name, ticker or sector…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter assets"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            label="Region"
            value={region}
            onChange={setRegion}
            options={[
              { value: 'all', label: 'All' },
              { value: 'US', label: 'US' },
              { value: 'IN', label: 'India' },
              { value: 'GLOBAL', label: 'Global' },
            ]}
          />
          <select
            className="input !w-auto !py-1.5 text-[13px]"
            value={cls}
            onChange={(e) => setCls(e.target.value as ClassFilter)}
            aria-label="Asset type"
          >
            <option value="all">All types</option>
            <option value="india">Indian stock funds</option>
            <option value="global">US & global stocks</option>
            <option value="bonds">Bonds & cash</option>
            <option value="commodities">Gold, silver & oil</option>
            <option value="crypto">Crypto</option>
            <option value="reference">Indices, rates & FX</option>
          </select>
          <Switch checked={onlyWatch} onChange={setOnlyWatch} label="Watchlist" />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-left text-xs text-ink-3">
              <tr>
                <th className="w-8 px-3" aria-label="Watchlist" />
                <Th k="name">Asset</Th>
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <Th k="d1" className="text-right">
                  1D
                </Th>
                <Th k="m1" className="text-right">
                  1M
                </Th>
                <Th k="ytd" className="text-right">
                  YTD
                </Th>
                <Th k="y1" className="text-right">
                  1Y
                </Th>
                <Th k="y5" className="hidden text-right xl:table-cell">
                  5Y/yr
                </Th>
                <Th k="vol" className="hidden text-right lg:table-cell">
                  Volatility
                </Th>
                <Th k="sharpe" className="hidden text-right lg:table-cell">
                  Sharpe
                </Th>
                <Th k="score">Trend</Th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">90 days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const t = live[a.meta.id];
                const shown = t
                  ? { ...a, quote: { ...a.quote, price: t.price, changePct: t.changePct24h } }
                  : a;
                return (
                  <tr
                    key={a.meta.id}
                    className="cursor-pointer border-t border-line transition hover:bg-surface-2"
                    onClick={() => nav(`/asset/${encodeURIComponent(a.meta.id)}`)}
                  >
                    <td className="px-3" onClick={(e) => e.stopPropagation()}>
                      <WatchStar id={a.meta.id} />
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      <AssetName a={a} link={false} />
                    </td>
                    <td className="num px-3 py-2.5 text-right font-medium">{fmtPrice(shown)}</td>
                    <td className={cx('num px-3 py-2.5 text-right', tone(shown.quote.changePct))}>
                      {fmtChange(shown)}
                    </td>
                    <td className={cx('num px-3 py-2.5 text-right', tone(a.stats.returns.m1))}>
                      {signedPct(a.stats.returns.m1)}
                    </td>
                    <td className={cx('num px-3 py-2.5 text-right', tone(a.stats.returns.ytd))}>
                      {signedPct(a.stats.returns.ytd)}
                    </td>
                    <td className={cx('num px-3 py-2.5 text-right', tone(a.stats.returns.y1))}>
                      {signedPct(a.stats.returns.y1)}
                    </td>
                    <td
                      className={cx(
                        'num hidden px-3 py-2.5 text-right xl:table-cell',
                        tone(a.stats.returns.y5),
                      )}
                    >
                      {signedPct(a.stats.returns.y5)}
                    </td>
                    <td className="num hidden px-3 py-2.5 text-right text-ink-2 lg:table-cell">
                      {pct(a.stats.vol1y, 0)}
                    </td>
                    <td className="num hidden px-3 py-2.5 text-right text-ink-2 lg:table-cell">
                      {number(a.stats.sharpe1y)}
                    </td>
                    <td className="px-3 py-2.5">
                      <SignalBadge s={a.signals} compact />
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <Sparkline values={a.spark} width={88} height={26} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-10 text-center text-sm text-ink-3">No assets match these filters.</div>
          )}
        </div>
      </Card>
      <p className="mt-3 text-xs text-ink-3">
        Returns in each asset’s own currency. Trend = Frontier’s 0–100 trend & momentum score (describes the
        recent past; not a forecast). Crypto prices stream live when your connection allows.
      </p>
    </DataState>
  );
}
