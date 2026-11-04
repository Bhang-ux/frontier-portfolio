/**
 * Typed Comlink client for the analytics worker + React hooks that run a
 * worker call whenever its (serialisable) inputs change, via React Query —
 * giving caching, de-duplication and stale-while-recompute for free.
 */
import * as Comlink from 'comlink';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { MonteCarloRequest } from '@frontier/quant';
import type {
  AnalyzeRequest,
  OptimizeRequest,
  QuantApi,
  RebalanceStudyRequest,
  WalkForwardRequest,
  SeriesInput,
} from '../workers/quant.worker';
import type { Currency } from '@frontier/contracts';
import type { Series } from '@frontier/quant';

export type Api = Comlink.Remote<QuantApi>;
let remote: Api | null = null;

export function quant(): Api {
  if (!remote) {
    const worker = new Worker(new URL('../workers/quant.worker.ts', import.meta.url), { type: 'module', name: 'frontier-quant' });
    remote = Comlink.wrap<QuantApi>(worker);
  }
  return remote;
}

/** Cheap stable fingerprint of a request (ids, weights & settings — series summarised). */
export function fingerprint(x: unknown): string {
  return JSON.stringify(x, (_k, v) => {
    if (v && typeof v === 'object' && 'dates' in v && 'values' in v && Array.isArray(v.dates)) {
      return `series:${v.dates.length}:${v.dates[0]}:${v.dates[v.dates.length - 1]}:${v.values[v.values.length - 1]}`;
    }
    return typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v;
  });
}

export function useWorkerCall<A, R>(name: string, args: A | null, call: (api: Api, a: A) => Promise<R>) {
  return useQuery<R, Error>({
    queryKey: ['worker', name, args ? fingerprint(args) : null],
    queryFn: () => call(quant(), args as A),
    enabled: !!args,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export const useAnalysis = (req: AnalyzeRequest | null) => useWorkerCall('analyze', req, (api, a) => api.analyze(a));
export const useOptimization = (req: OptimizeRequest | null) => useWorkerCall('optimize', req, (api, a) => api.optimize(a));
export const useWalkForward = (req: WalkForwardRequest | null) => useWorkerCall('walkForward', req, (api, a) => api.walkForward(a));
export const useRebalanceStudy = (req: RebalanceStudyRequest | null) => useWorkerCall('rebalanceStudy', req, (api, a) => api.rebalanceStudy(a));
export const useSimulation = (req: MonteCarloRequest | null) => useWorkerCall('simulate', req, (api, a) => api.simulate(a));
export const useMonthlyReturns = (req: { assets: SeriesInput[]; weights: number[]; base: Currency; fx?: Series; lookbackYears: number } | null) =>
  useWorkerCall('monthlyReturns', req, (api, a) => api.monthlyReturns(a));
