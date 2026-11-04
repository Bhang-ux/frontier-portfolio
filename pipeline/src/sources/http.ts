/**
 * Resilient HTTP: timeouts, retries with exponential backoff + full jitter,
 * Retry-After support and a concurrency limiter. Free market-data endpoints
 * throttle aggressively; the pipeline must degrade gracefully, not crash.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body = '',
  ) {
    super(`HTTP ${status} for ${url.replace(/crumb=[^&]+/, 'crumb=***')}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
  /** Statuses that should not be retried (e.g. 404 = unknown symbol). */
  fatal?: number[];
}

export async function fetchWithRetry(url: string, opts: RetryOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const base = opts.baseDelayMs ?? 800;
  const fatal = new Set(opts.fatal ?? [400, 401, 403, 404, 422]);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json,text/csv,*/*', ...opts.headers },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      const err = new HttpError(res.status, url, body.slice(0, 300));
      if (fatal.has(res.status)) throw err;
      lastErr = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (attempt < retries) {
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** attempt;
        await sleep(Math.random() * backoff + backoff / 2);
      }
    } catch (e) {
      if (e instanceof HttpError && fatal.has(e.status)) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(Math.random() * base * 2 ** attempt + base / 2);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Run async tasks with at most `concurrency` in flight. */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
