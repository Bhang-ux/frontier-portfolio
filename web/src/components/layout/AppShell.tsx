import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BarChart3,
  Compass,
  FlaskConical,
  GraduationCap,
  History,
  Home,
  LineChart,
  Moon,
  PieChart,
  Search,
  Sparkles,
  Sun,
  Target,
  Menu,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { toast, Toaster } from 'sonner';
import { useManifest, useMarketData } from '@/lib/data';
import { useSettings } from '@/lib/store';
import { timeAgo } from '@/lib/format';
import { cx, Kbd, Segmented } from '@/components/ui/primitives';
import { Logo } from './Logo';

export const NAV = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/start', label: 'Get started', icon: Sparkles },
  { to: '/portfolio', label: 'My portfolio', icon: PieChart },
  { to: '/optimize', label: 'Optimizer', icon: Target },
  { to: '/simulate', label: 'Future planner', icon: LineChart },
  { to: '/backtest', label: 'Strategy lab', icon: FlaskConical },
  { to: '/markets', label: 'Markets', icon: BarChart3 },
  { to: '/learn', label: 'Learn', icon: GraduationCap },
];

function useThemeEffect() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      const t = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#070a12' : '#f5f6f8');
    };
    apply();
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Toast when a fresher dataset is published while the page is open. */
function useFreshnessToasts() {
  const { data } = useManifest();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    if (last.current && last.current !== data.generatedAt) {
      toast.success('Fresh market data', { description: `Prices and analytics updated ${timeAgo(data.generatedAt)}.` });
    }
    last.current = data.generatedAt;
  }, [data]);
}

export function FreshnessPill() {
  const { data } = useManifest();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <span className="chip">Loading data…</span>;
  if (data.synthetic)
    return (
      <span className="chip border-[color-mix(in_oklab,var(--warning)_50%,transparent)] text-ink" title="Synthetic demo data — not real prices">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" /> Demo data
      </span>
    );
  const ageH = (Date.now() - Date.parse(data.generatedAt)) / 3_600_000;
  const fresh = ageH < 3;
  return (
    <span className="chip" title={`Data generated ${new Date(data.generatedAt).toLocaleString()}`}>
      <span className={cx('live-dot h-1.5 w-1.5 rounded-full', fresh ? 'bg-good text-good' : 'bg-[var(--warning)] text-[var(--warning)]')} />
      <span className="hidden sm:inline">{fresh ? 'Live' : 'Updated'}</span> · {timeAgo(data.generatedAt)}
    </span>
  );
}

function ThemeButton() {
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  const isDark = theme === 'dark' || (theme === 'system' && !matchMedia('(prefers-color-scheme: light)').matches);
  return (
    <button className="btn-quiet !p-2" onClick={() => set({ theme: isDark ? 'light' : 'dark' })} aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`} title="Toggle theme">
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function Topbar({ onSearch, onMenu }: { onSearch: () => void; onMenu: () => void }) {
  const { currency, mode, set } = useSettings();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:px-6">
        <button className="btn-quiet !p-2 lg:hidden" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="lg:hidden">
          <Logo compact />
        </div>
        <button onClick={onSearch} className="ml-auto flex h-9 min-w-0 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-[13px] text-ink-3 transition hover:border-line-strong sm:ml-0 sm:w-72" aria-label="Search assets and pages">
          <Search size={15} />
          <span className="hidden truncate sm:inline">Search assets, pages, actions…</span>
          <span className="ml-auto hidden sm:inline">
            <Kbd>⌘K</Kbd>
          </span>
        </button>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Segmented size="sm" label="Explanation level" value={mode} onChange={(v) => set({ mode: v })} options={[{ value: 'beginner', label: 'Beginner', title: 'Plain-English explanations everywhere' }, { value: 'pro', label: 'Pro', title: 'Dense numbers, fewer explanations' }]} />
          <Segmented size="sm" label="Currency" value={currency} onChange={(v) => set({ currency: v })} options={[{ value: 'INR', label: '₹ INR' }, { value: 'USD', label: '$ USD' }]} />
        </div>
        <FreshnessPill />
        <ThemeButton />
      </div>
    </header>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) => cx('group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition', isActive ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
        >
          {({ isActive }) => (
            <>
              <Icon size={18} className={isActive ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2'} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-line px-3 py-4 lg:flex">
      <div className="mb-6 px-2">
        <Logo />
      </div>
      <SideNav />
      <div className="mt-auto rounded-2xl border border-line bg-surface p-3.5 text-[12px] leading-relaxed text-ink-3">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink-2">
          <Compass size={14} /> Educational tool
        </div>
        Frontier explains markets and portfolios. It is not financial advice — past performance does not guarantee future results.
      </div>
    </aside>
  );
}

function MobileNav() {
  const items = [NAV[0], NAV[2], NAV[3], NAV[4], NAV[6]];
  return (
    <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="grid grid-cols-5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium', isActive ? 'text-accent' : 'text-ink-3')}>
            <Icon size={19} />
            {label.split(' ')[0]}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const { data } = useMarketData();
  const settings = useSettings();
  const go = (to: string) => {
    onOpenChange(false);
    nav(to);
  };
  const item = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-ink-2 aria-selected:bg-surface-2 aria-selected:text-ink';
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Search Frontier" className="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl" overlayClassName="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm">
      <Dialog.Title className="sr-only">Search Frontier</Dialog.Title>
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search size={16} className="text-ink-3" />
        <Command.Input autoFocus placeholder="Search 100+ assets, pages and actions…" className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">Nothing found.</Command.Empty>
        <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2">
          {NAV.map((n) => (
            <Command.Item key={n.to} value={`page ${n.label}`} onSelect={() => go(n.to)} className={item}>
              <n.icon size={16} /> {n.label}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2">
          <Command.Item value="action toggle theme dark light" onSelect={() => { settings.set({ theme: settings.theme === 'light' ? 'dark' : 'light' }); onOpenChange(false); }} className={item}>
            <Moon size={16} /> Toggle dark / light theme
          </Command.Item>
          <Command.Item value="action currency rupee dollar inr usd" onSelect={() => { settings.set({ currency: settings.currency === 'INR' ? 'USD' : 'INR' }); onOpenChange(false); }} className={item}>
            <History size={16} /> Switch default currency to {settings.currency === 'INR' ? 'USD' : 'INR'}
          </Command.Item>
          <Command.Item value="action mode beginner pro" onSelect={() => { settings.set({ mode: settings.mode === 'pro' ? 'beginner' : 'pro' }); onOpenChange(false); }} className={item}>
            <GraduationCap size={16} /> Switch to {settings.mode === 'pro' ? 'Beginner' : 'Pro'} mode
          </Command.Item>
        </Command.Group>
        {data && (
          <Command.Group heading="Assets" className="[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2">
            {data.snapshot.assets.map((a) => (
              <Command.Item key={a.meta.id} value={`${a.meta.symbol} ${a.meta.name} ${a.meta.short}`} onSelect={() => go(`/asset/${encodeURIComponent(a.meta.id)}`)} className={item}>
                <span className="w-24 shrink-0 truncate font-mono text-[12px] text-ink-3">{a.meta.symbol}</span>
                <span className="truncate">{a.meta.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function SyntheticBanner() {
  const { data } = useManifest();
  if (!data?.synthetic) return null;
  return (
    <div className="border-b border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-4 py-2 text-center text-[13px] text-ink" role="status">
      <strong>Demo mode:</strong> you are looking at synthetic data generated for development. Prices are not real.
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  useThemeEffect();
  useFreshnessToasts();
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMenu(false);
  }, [loc.pathname]);
  const theme = useSettings((s) => s.theme);
  return (
    <div className="flex min-h-dvh">
      <div className="aurora" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <SyntheticBanner />
        <Topbar onSearch={() => setSearch(true)} onMenu={() => setMenu(true)} />
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          {children ?? <Outlet />}
        </main>
        <footer className="mx-auto mb-20 w-full max-w-[1440px] px-4 text-[12px] text-ink-3 sm:px-6 lg:mb-6">
          <div className="flex flex-col gap-1 border-t border-line pt-4 sm:flex-row sm:justify-between">
            <span>Frontier is an educational tool, not investment advice. Data: Yahoo Finance, FRED, Binance (crypto live). Prices may be delayed.</span>
            <span>Computed entirely in your browser · no account · no tracking</span>
          </div>
        </footer>
      </div>
      <MobileNav />
      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col gap-4 border-r border-line bg-bg p-4">
            <div className="flex items-center justify-between">
              <Logo />
              <button className="btn-quiet !p-2" onClick={() => setMenu(false)} aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            <SideNav onNavigate={() => setMenu(false)} />
            <MobileSettings />
          </div>
        </div>
      )}
      <CommandPalette open={search} onOpenChange={setSearch} />
      <Toaster theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" richColors closeButton />
    </div>
  );
}

function MobileSettings() {
  const { currency, mode, set } = useSettings();
  return (
    <div className="mt-auto flex flex-col gap-3">
      <Segmented size="sm" label="Explanation level (mobile)" value={mode} onChange={(v) => set({ mode: v })} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'pro', label: 'Pro' }]} />
      <Segmented size="sm" label="Currency (mobile)" value={currency} onChange={(v) => set({ currency: v })} options={[{ value: 'INR', label: '₹ INR' }, { value: 'USD', label: '$ USD' }]} />
    </div>
  );
}
