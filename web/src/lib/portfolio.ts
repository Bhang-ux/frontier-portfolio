/**
 * Glue between stored portfolios, published data and the analytics worker:
 * which histories to load, FX conversion inputs, benchmark & factor choices
 * per base currency, stress proxies, and share-by-URL encoding.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { useMemo } from 'react';
import type { AssetSnapshot, Currency } from '@frontier/contracts';
import type { Series } from '@frontier/quant';
import { useHistories } from './data';
import type { Holding, Portfolio } from './store';
import type { AssetInfo, FactorDef, SeriesInput } from '../workers/quant.worker';

export const BENCHMARK: Record<Currency, { id: string; name: string }> = {
  INR: { id: 'NIFTYBEES.NS', name: 'Nifty 50' },
  USD: { id: 'SPY', name: 'S&P 500' },
};

export const FACTORS: Record<Currency, FactorDef[]> = {
  USD: [
    { key: 'mkt', label: 'Stock market (S&P 500)', long: 'SPY', excess: true },
    { key: 'size', label: 'Small vs large companies', long: 'IWM', short: 'SPY' },
    { key: 'value', label: 'Value vs growth', long: 'IWD', short: 'IWF' },
    { key: 'mom', label: 'Momentum', long: 'MTUM', short: 'SPY' },
    { key: 'rates', label: 'Interest-rate sensitivity', long: 'IEF', short: 'SHY' },
    { key: 'gold', label: 'Gold', long: 'GLD' },
    { key: 'usd', label: 'US dollar', long: 'UUP' },
  ],
  INR: [
    { key: 'mkt', label: 'Indian market (Nifty 50)', long: 'NIFTYBEES.NS', excess: true },
    { key: 'mid', label: 'Next-50 vs top-50 companies', long: 'JUNIORBEES.NS', short: 'NIFTYBEES.NS' },
    { key: 'banks', label: 'Banks vs market', long: 'BANKBEES.NS', short: 'NIFTYBEES.NS' },
    { key: 'ustech', label: 'US tech vs Indian market', long: 'MON100.NS', short: 'NIFTYBEES.NS' },
    { key: 'gold', label: 'Gold', long: 'GOLDBEES.NS' },
    { key: 'usd', label: 'US dollar vs rupee', long: 'USDINR' },
  ],
};

export const SHOCKS: Record<Currency, { id: string; name: string; shock: number; summary: string }[]> = {
  USD: [
    {
      id: 'SPY',
      name: 'US stocks fall 20%',
      shock: -0.2,
      summary: 'A typical bear-market decline in the S&P 500.',
    },
    {
      id: 'TLT',
      name: 'Interest rates jump',
      shock: -0.15,
      summary: 'Long-term Treasuries drop 15%, as in 2022.',
    },
    {
      id: 'GLD',
      name: 'Gold slumps 15%',
      shock: -0.15,
      summary: 'Gold loses its shine in a strong-dollar boom.',
    },
    {
      id: 'BTC-USD',
      name: 'Crypto crash',
      shock: -0.5,
      summary: 'Bitcoin halves — it has done so several times.',
    },
    { id: 'NIFTYBEES.NS', name: 'Indian stocks fall 20%', shock: -0.2, summary: 'A sharp Nifty sell-off.' },
  ],
  INR: [
    {
      id: 'NIFTYBEES.NS',
      name: 'Indian stocks fall 20%',
      shock: -0.2,
      summary: 'A sharp Nifty sell-off, like early 2020.',
    },
    { id: 'SPY', name: 'US stocks fall 20%', shock: -0.2, summary: 'A US bear market, measured in rupees.' },
    { id: 'GOLDBEES.NS', name: 'Gold slumps 15%', shock: -0.15, summary: 'Gold prices fall in rupee terms.' },
    {
      id: 'USDINR',
      name: 'Rupee strengthens 10%',
      shock: -0.1,
      summary: 'The dollar falls 10% against the rupee — bad for US holdings.',
    },
    { id: 'BTC-USD', name: 'Crypto crash', shock: -0.5, summary: 'Bitcoin halves.' },
  ],
};

export function normalized(holdings: Holding[]): Holding[] {
  const pos = holdings.filter((h) => h.weight > 0);
  const s = pos.reduce((a, b) => a + b.weight, 0);
  return s > 0 ? pos.map((h) => ({ ...h, weight: h.weight / s })) : pos;
}

export const assetInfo = (a: AssetSnapshot): AssetInfo => ({
  id: a.meta.id,
  name: a.meta.short,
  assetClass: a.meta.assetClass,
  region: a.meta.region,
});

/** Load histories for `ids` (+ USD/INR when needed) and package them for the worker. */
export function useSeriesInputs(
  ids: string[],
  assets: Map<string, AssetSnapshot> | undefined,
  base: Currency,
) {
  const needFx = ids.some((id) => assets?.get(id)?.meta.currency !== base);
  const all = useMemo(() => [...new Set([...ids, ...(needFx ? ['USDINR'] : [])])], [ids, needFx]);
  const h = useHistories(all);
  return useMemo(() => {
    const inputs: Record<string, SeriesInput> = {};
    for (const id of ids) {
      const s = h.data[id];
      const a = assets?.get(id);
      if (s && a) inputs[id] = { id, currency: a.meta.currency, series: s };
    }
    const ready = ids.every((id) => inputs[id]) && (!needFx || !!h.data.USDINR);
    return {
      inputs,
      fx: needFx ? (h.data.USDINR as Series | undefined) : undefined,
      ready,
      isLoading: h.isLoading,
      error: h.error,
    };
  }, [h.data, h.isLoading, h.error, ids, assets, needFx]);
}

// ─── share links ────────────────────────────────────────────────────────────
interface SharedPayload {
  n: string;
  c: Currency;
  a: number;
  h: [string, number][];
}

export function encodePortfolio(p: Portfolio): string {
  const payload: SharedPayload = {
    n: p.name,
    c: p.currency,
    a: Math.round(p.amount),
    h: p.holdings.map((h) => [h.id, Math.round(h.weight * 10000) / 10000]),
  };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodePortfolio(code: string): Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'> | null {
  try {
    const raw = decompressFromEncodedURIComponent(code);
    if (!raw) return null;
    const d = JSON.parse(raw) as SharedPayload;
    if (!Array.isArray(d.h) || (d.c !== 'USD' && d.c !== 'INR')) return null;
    const holdings = d.h
      .filter(([id, w]) => typeof id === 'string' && Number.isFinite(w) && w > 0)
      .slice(0, 40)
      .map(([id, weight]) => ({ id, weight }));
    if (!holdings.length) return null;
    return {
      name: String(d.n ?? 'Shared portfolio').slice(0, 80),
      currency: d.c,
      amount: Number.isFinite(d.a) && d.a > 0 ? d.a : 10000,
      holdings,
      origin: 'shared',
    };
  } catch {
    return null;
  }
}

export function shareUrl(p: Portfolio): string {
  return `${location.origin}${import.meta.env.BASE_URL}portfolio#p=${encodePortfolio(p)}`;
}
