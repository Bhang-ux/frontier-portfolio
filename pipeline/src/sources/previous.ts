/**
 * "The CDN is the backup database": if a source fails for one instrument,
 * reuse that instrument's history from the currently deployed site, so a
 * flaky upstream never makes the live site regress.
 */
import { decodeHistory, type HistoryFile } from '@frontier/contracts';
import type { Series } from '@frontier/quant';
import { fetchWithRetry } from './http';

export async function fetchPreviousHistory(siteUrl: string, id: string): Promise<Series> {
  const url = `${siteUrl.replace(/\/$/, '')}/data/history/${encodeURIComponent(id)}.json`;
  const res = await fetchWithRetry(url, { retries: 2, timeoutMs: 15_000 });
  const file = (await res.json()) as HistoryFile;
  if (!Array.isArray(file?.d) || !Array.isArray(file?.c) || file.d.length !== file.c.length) {
    throw new Error(`previous deploy: malformed history for ${id}`);
  }
  return decodeHistory(file);
}
