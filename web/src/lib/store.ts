/**
 * Client state (Zustand + localStorage persistence).
 *
 * Portfolios never leave the browser: there is no backend, no account and
 * no tracking. Sharing works by encoding a portfolio into the URL hash.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Currency } from '@frontier/contracts';
import type { CovarianceMethod } from '@frontier/quant';

export type Mode = 'beginner' | 'pro';
export type Theme = 'dark' | 'light' | 'system';
export type ReturnModel = 'shrunk' | 'historical' | 'capm' | 'ewma' | 'equilibrium';

export interface RiskProfile {
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  market: 'US' | 'IN';
  horizon: number;
  monthly: number;
  initial: number;
  goal?: number;
  takenAt: number;
}

export interface Settings {
  currency: Currency;
  mode: Mode;
  theme: Theme;
  lookback: number;
  covariance: CovarianceMethod;
  returnModel: ReturnModel;
  profile: RiskProfile | null;
  watchlist: string[];
}

const inIndia = (() => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta' || navigator.language.endsWith('-IN');
  } catch {
    return false;
  }
})();

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  toggleWatch: (id: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      currency: inIndia ? 'INR' : 'USD',
      mode: 'beginner',
      theme: 'dark',
      lookback: 5,
      covariance: 'ledoit-wolf',
      returnModel: 'shrunk',
      profile: null,
      watchlist: [],
      set: (patch) => set(patch),
      toggleWatch: (id) => {
        const w = get().watchlist;
        set({ watchlist: w.includes(id) ? w.filter((x) => x !== id) : [...w, id] });
      },
    }),
    { name: 'frontier-settings', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

export interface Holding {
  id: string;
  weight: number;
}

export interface Portfolio {
  id: string;
  name: string;
  currency: Currency;
  /** Total current value, in `currency`. Used for money-denominated insights. */
  amount: number;
  holdings: Holding[];
  origin: 'example' | 'advisor' | 'custom' | 'optimizer' | 'shared';
  createdAt: number;
  updatedAt: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const EXAMPLES: Record<Currency, Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>> = {
  INR: {
    name: 'Example: Indian starter mix',
    currency: 'INR',
    amount: 500_000,
    origin: 'example',
    holdings: [
      { id: 'NIFTYBEES.NS', weight: 0.4 },
      { id: 'JUNIORBEES.NS', weight: 0.15 },
      { id: 'MON100.NS', weight: 0.15 },
      { id: 'HDFCBANK.NS', weight: 0.1 },
      { id: 'GOLDBEES.NS', weight: 0.1 },
      { id: 'CASH-INR', weight: 0.1 },
    ],
  },
  USD: {
    name: 'Example: US starter mix',
    currency: 'USD',
    amount: 25_000,
    origin: 'example',
    holdings: [
      { id: 'SPY', weight: 0.4 },
      { id: 'QQQ', weight: 0.15 },
      { id: 'NVDA', weight: 0.1 },
      { id: 'VEA', weight: 0.1 },
      { id: 'AGG', weight: 0.15 },
      { id: 'GLD', weight: 0.1 },
    ],
  },
};

const fresh = (p: Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>): Portfolio => ({
  ...p,
  holdings: p.holdings.map((h) => ({ ...h })),
  id: uid(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

interface PortfolioState {
  portfolios: Portfolio[];
  activeId: string;
  active: () => Portfolio;
  select: (id: string) => void;
  create: (p: Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>) => string;
  update: (id: string, patch: Partial<Omit<Portfolio, 'id'>>) => void;
  setHoldings: (id: string, holdings: Holding[]) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string;
}

const initial = fresh(EXAMPLES[inIndia ? 'INR' : 'USD']);

export const usePortfolios = create<PortfolioState>()(
  persist(
    (set, get) => ({
      portfolios: [initial],
      activeId: initial.id,
      active: () => get().portfolios.find((p) => p.id === get().activeId) ?? get().portfolios[0],
      select: (id) => set({ activeId: id }),
      create: (p) => {
        const np = fresh(p);
        set({ portfolios: [...get().portfolios, np], activeId: np.id });
        return np.id;
      },
      update: (id, patch) =>
        set({ portfolios: get().portfolios.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) }),
      setHoldings: (id, holdings) =>
        set({ portfolios: get().portfolios.map((p) => (p.id === id ? { ...p, holdings, updatedAt: Date.now(), origin: p.origin === 'example' ? 'custom' : p.origin } : p)) }),
      remove: (id) => {
        const rest = get().portfolios.filter((p) => p.id !== id);
        const list = rest.length ? rest : [fresh(EXAMPLES[get().active().currency])];
        set({ portfolios: list, activeId: get().activeId === id ? list[0].id : get().activeId });
      },
      duplicate: (id) => {
        const src = get().portfolios.find((p) => p.id === id);
        if (!src) return id;
        return get().create({ ...src, name: `${src.name} (copy)`, origin: 'custom' });
      },
    }),
    { name: 'frontier-portfolios', version: 1, storage: createJSONStorage(() => localStorage), partialize: (s) => ({ portfolios: s.portfolios, activeId: s.activeId }) },
  ),
);

/** Normalise weights to sum to 1 (drops non-positive entries). */
export function normalizeHoldings(h: Holding[]): Holding[] {
  const pos = h.filter((x) => x.weight > 0);
  const s = pos.reduce((a, b) => a + b.weight, 0);
  return s > 0 ? pos.map((x) => ({ ...x, weight: x.weight / s })) : pos;
}
