/**
 * Data access: a static JSON "API" on the same origin, versioned by content
 * hash. The tiny manifest is polled; everything else is immutable per hash,
 * so it can be cached forever (HTTP cache, service worker and React Query).
 */
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  SCHEMA_VERSION,
  decodeHistory,
  type AssetSnapshot,
  type HistoryFile,
  type IntradayFile,
  type Manifest,
  type Snapshot,
} from '@frontier/contracts';
import type { Series } from '@frontier/quant';

const BASE = import.meta.env.BASE_URL;
export const dataUrl = (path: string) => `${BASE}data/${path}`;

export class DataError extends Error {}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new DataError(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

export const MANIFEST_POLL_MS = 120_000;

export function useManifest() {
  return useQuery({
    queryKey: ['manifest'],
    queryFn: () => fetchJson<Manifest>(dataUrl('manifest.json'), { cache: 'no-cache' }),
    refetchInterval: MANIFEST_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 3,
  });
}

export function useSnapshot() {
  const manifest = useManifest();
  const hash = manifest.data?.snapshot.hash;
  const snap = useQuery({
    queryKey: ['snapshot', hash],
    queryFn: async () => {
      const s = await fetchJson<Snapshot>(dataUrl(`${manifest.data!.snapshot.file}?v=${hash}`));
      if (s.schemaVersion !== SCHEMA_VERSION) throw new DataError('The data format changed — please reload the page.');
      return s;
    },
    enabled: !!hash,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: keepPreviousData,
  });
  return { manifest, snapshot: snap };
}

export interface MarketData {
  snapshot: Snapshot;
  manifest: Manifest;
  assets: Map<string, AssetSnapshot>;
  investable: AssetSnapshot[];
}

/** Snapshot plus convenient lookups; `data` is undefined while loading. */
export function useMarketData(): { data?: MarketData; isLoading: boolean; error: Error | null; isFetching: boolean } {
  const { manifest, snapshot } = useSnapshot();
  const data = useMemo<MarketData | undefined>(() => {
    if (!snapshot.data || !manifest.data) return undefined;
    const assets = new Map(snapshot.data.assets.map((a) => [a.meta.id, a]));
    return {
      snapshot: snapshot.data,
      manifest: manifest.data,
      assets,
      investable: snapshot.data.assets.filter((a) => a.meta.investable),
    };
  }, [snapshot.data, manifest.data]);
  return {
    data,
    isLoading: manifest.isLoading || snapshot.isLoading,
    error: (manifest.error as Error | null) ?? (snapshot.error as Error | null),
    isFetching: manifest.isFetching || snapshot.isFetching,
  };
}

/** Lazily load full daily histories for a set of instruments. */
export function useHistories(ids: string[]): { data: Record<string, Series>; isLoading: boolean; error: Error | null } {
  const manifest = useManifest();
  const uniq = useMemo(() => [...new Set(ids)].sort(), [ids]);
  return useQueries({
    queries: uniq.map((id) => {
      const hash = manifest.data?.histories[id]?.hash;
      return {
        queryKey: ['history', id, hash],
        queryFn: async () => decodeHistory(await fetchJson<HistoryFile>(dataUrl(`history/${encodeURIComponent(id)}.json?v=${hash}`))),
        enabled: !!hash,
        staleTime: Infinity,
        gcTime: 30 * 60_000,
      };
    }),
    combine: (results) => {
      const data: Record<string, Series> = {};
      results.forEach((r, i) => {
        if (r.data) data[uniq[i]] = r.data;
      });
      const missing = uniq.filter((id) => manifest.data && !manifest.data.histories[id]);
      return {
        data,
        isLoading: !manifest.data || results.some((r) => r.isLoading),
        error: (results.find((r) => r.error)?.error as Error | undefined) ?? (missing.length ? new DataError(`No data for ${missing.join(', ')}`) : null),
      };
    },
  });
}

export function useIntraday() {
  const manifest = useManifest();
  const meta = manifest.data?.intraday;
  return useQuery({
    queryKey: ['intraday', meta?.hash],
    queryFn: () => fetchJson<IntradayFile>(dataUrl(`${meta!.file}?v=${meta!.hash}`)),
    enabled: !!meta,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}
