import type { AssetClass, AssetSnapshot, Currency } from '@frontier/contracts';
import { explain } from '@frontier/quant';

export const { pct, signedPct, money, compactMoney, number, odds } = explain;

export const CLASS_LABEL: Record<AssetClass, string> = {
  equity: 'Stocks',
  bond: 'Bonds',
  commodity: 'Commodities',
  'real-estate': 'Real estate',
  crypto: 'Crypto',
  cash: 'Cash',
  currency: 'Currency',
  volatility: 'Volatility',
  rate: 'Interest rates',
};

/** Fixed class → categorical slot (colour follows the entity, never its rank). */
const CLASS_ORDER: AssetClass[] = ['equity', 'bond', 'commodity', 'real-estate', 'cash', 'crypto', 'currency', 'volatility', 'rate'];
export const classColor = (c: string) => `var(--s${(CLASS_ORDER.indexOf(c as AssetClass) % 8) + 1})`;
export const classRank = (c: string) => CLASS_ORDER.indexOf(c as AssetClass);

export const seriesColor = (i: number) => (i < 8 ? `var(--s${i + 1})` : 'var(--text-3)');
export const OTHER_COLOR = 'var(--text-3)';

export const REGION_LABEL: Record<string, string> = { US: 'United States', IN: 'India', DEV: 'Developed ex-US', EM: 'Emerging markets', GLOBAL: 'Global' };

export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', INR: '₹' };

/** Format an instrument's price according to its kind. */
export function fmtPrice(a: AssetSnapshot, value = a.quote.price): string {
  if (a.meta.kind === 'rate') return `${number(value, 2)}%`;
  if (a.meta.assetClass === 'volatility') return number(value, 2);
  if (a.meta.kind === 'fx') return `₹${number(value, 2)}`;
  if (a.meta.kind === 'index') return number(value, value > 1000 ? 0 : 2);
  return money(value, a.meta.currency, value >= 1000 ? 0 : 2);
}

/** Change label: basis points for yields, percent otherwise. */
export function fmtChange(a: AssetSnapshot): string {
  if (a.meta.kind === 'rate') {
    const bp = Math.round(a.quote.change * 100);
    return `${bp > 0 ? '+' : bp < 0 ? '−' : ''}${Math.abs(bp)} bp`;
  }
  return signedPct(a.quote.changePct, 2);
}

export const tone = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) || x === 0 ? 'text-ink-2' : x > 0 ? 'text-pos' : 'text-neg');

export function timeAgo(iso: string | number, now = Date.now()): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const fmtDate = (day: number | string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  const d = typeof day === 'number' ? new Date(day * 86_400_000) : new Date(day);
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
};

export const SIGNAL_LABEL = { strong: 'Strong', positive: 'Positive', neutral: 'Neutral', negative: 'Negative', weak: 'Weak' } as const;
