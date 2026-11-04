import type { AssetMeta, AssetSnapshot, Quote } from '@frontier/contracts';
import type { Series } from '@frontier/quant';

/** An instrument after acquisition & cleaning, before analytics. */
export interface LoadedAsset {
  meta: AssetMeta;
  /** Dividend- and split-adjusted closes (total-return series). */
  series: Series;
  /** Split-adjusted raw closes on the same dates (price levels for display). */
  close: number[];
  quote: Quote;
  source: AssetSnapshot['source'];
}

export type Universe = Map<string, LoadedAsset>;
