import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { Activity, Plus, Search, ShieldAlert, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AssetSnapshot, RegimeInfo, Signals } from '@frontier/contracts';
import { useMarketData } from '@/lib/data';
import { CLASS_LABEL, SIGNAL_LABEL, classColor, pct } from '@/lib/format';
import { useSettings } from '@/lib/store';
import { cx, Skeleton } from '@/components/ui/primitives';

export function PageLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-5 w-[min(560px,90%)]" />
      <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function DataState({
  isLoading,
  error,
  children,
}: {
  isLoading: boolean;
  error: Error | null;
  children: ReactNode;
}) {
  if (error)
    return (
      <div className="card card-pad mx-auto mt-6 max-w-xl text-center">
        <ShieldAlert className="mx-auto mb-2 text-ink-3" />
        <div className="font-semibold">Market data is unavailable right now</div>
        <p className="mt-1 text-sm text-ink-3">
          {error.message}. The next automatic refresh will retry — or reload the page.
        </p>
      </div>
    );
  if (isLoading) return <PageLoading />;
  return <>{children}</>;
}

/** Signal badge: colour + icon + word (never colour alone). */
export function SignalBadge({ s, compact = false }: { s: Signals | null; compact?: boolean }) {
  if (!s) return <span className="text-xs text-ink-3">—</span>;
  const good = s.label === 'strong' || s.label === 'positive';
  const bad = s.label === 'weak' || s.label === 'negative';
  const Icon = good ? TrendingUp : bad ? TrendingDown : Activity;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold',
        good
          ? 'border-[color-mix(in_oklab,var(--pos)_35%,transparent)] bg-pos-soft text-pos'
          : bad
            ? 'border-[color-mix(in_oklab,var(--neg)_35%,transparent)] bg-neg-soft text-neg'
            : 'border-line bg-surface-2 text-ink-2',
      )}
      title={`Trend & momentum score ${s.score}/100`}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden />
      {compact ? s.score : `${SIGNAL_LABEL[s.label]} · ${s.score}`}
    </span>
  );
}

export function RegimePill({ r }: { r: RegimeInfo | null }) {
  if (!r) return null;
  const calm = r.current === 'calm';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        calm
          ? 'border-[color-mix(in_oklab,var(--good)_40%,transparent)] text-ink'
          : 'border-[color-mix(in_oklab,var(--serious)_55%,transparent)] text-ink',
      )}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: calm ? 'var(--good)' : 'var(--serious)' }}
        aria-hidden
      />
      {calm ? 'Calm regime' : 'Turbulent regime'} · {pct(r.probability, 0)}
    </span>
  );
}

export function ClassDot({ cls }: { cls: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: classColor(cls) }}
      aria-hidden
    />
  );
}

export function AssetName({
  a,
  link = true,
  sub = true,
}: {
  a: AssetSnapshot;
  link?: boolean;
  sub?: boolean;
}) {
  const body = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-ink">{a.meta.short}</span>
      {sub && (
        <span className="flex items-center gap-1.5 truncate text-xs text-ink-3">
          <ClassDot cls={a.meta.assetClass} />
          <span className="font-mono">{a.meta.symbol}</span>
          <span>· {CLASS_LABEL[a.meta.assetClass]}</span>
        </span>
      )}
    </span>
  );
  return link ? (
    <Link
      to={`/asset/${encodeURIComponent(a.meta.id)}`}
      className="min-w-0 hover:underline hover:decoration-line-strong"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export function WatchStar({ id }: { id: string }) {
  const on = useSettings((s) => s.watchlist.includes(id));
  const toggle = useSettings((s) => s.toggleWatch);
  return (
    <button
      onClick={() => toggle(id)}
      aria-pressed={on}
      aria-label={on ? 'Remove from watchlist' : 'Add to watchlist'}
      className="text-ink-3 transition hover:text-[var(--warning)]"
    >
      <Star size={15} fill={on ? 'var(--warning)' : 'none'} stroke={on ? 'var(--warning)' : 'currentColor'} />
    </button>
  );
}

/** Searchable popover to add an investable asset. */
export function AssetPicker({
  exclude = [],
  onPick,
  label = 'Add asset',
  filter,
}: {
  exclude?: string[];
  onPick: (id: string) => void;
  label?: string;
  filter?: (a: AssetSnapshot) => boolean;
}) {
  const { data } = useMarketData();
  const [open, setOpen] = useState(false);
  const list = (data?.investable ?? []).filter((a) => !exclude.includes(a.meta.id) && (!filter || filter(a)));
  const groups = new Map<string, AssetSnapshot[]>();
  for (const a of list) {
    const k =
      a.meta.kind === 'cash'
        ? 'Cash'
        : a.meta.assetClass === 'crypto'
          ? 'Crypto'
          : a.meta.assetClass === 'bond'
            ? a.meta.currency === 'INR'
              ? 'Indian bond funds'
              : 'US Treasuries'
            : a.meta.assetClass === 'commodity'
              ? 'Gold & silver'
              : a.meta.currency === 'INR'
                ? a.meta.region === 'IN'
                  ? 'Indian stock funds'
                  : 'Global stock funds (₹)'
                : 'US stocks';
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="btn-ghost">
        <Plus size={16} /> {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl"
        >
          <Command label="Find an asset">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={15} className="text-ink-3" />
              <Command.Input
                autoFocus
                placeholder="Type a name or ticker…"
                className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-1.5">
              <Command.Empty className="p-4 text-center text-sm text-ink-3">No match.</Command.Empty>
              {[...groups.entries()].map(([g, items]) => (
                <Command.Group
                  key={g}
                  heading={g}
                  className="[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {items.map((a) => (
                    <Command.Item
                      key={a.meta.id}
                      value={`${a.meta.symbol} ${a.meta.name} ${a.meta.short}`}
                      onSelect={() => {
                        onPick(a.meta.id);
                        setOpen(false);
                      }}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] aria-selected:bg-surface-2"
                    >
                      <ClassDot cls={a.meta.assetClass} />
                      <span className="min-w-0 flex-1 truncate text-ink">{a.meta.short}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-3">{a.meta.symbol}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-end justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{children}</h2>
      {right}
    </div>
  );
}
