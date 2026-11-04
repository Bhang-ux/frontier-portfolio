/**
 * Shared chart infrastructure: responsive sizing, theme-aware colours,
 * diverging scales, axis tick helpers and the tooltip shell.
 */
import { interpolateLab } from 'd3-interpolate';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

export function useSize<T extends HTMLElement>(): [
  (el: T | null) => void,
  { width: number; height: number },
] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(([entry]) => {
      const cr = entry.contentRect;
      setSize((s) =>
        Math.abs(s.width - cr.width) < 0.5 && Math.abs(s.height - cr.height) < 0.5
          ? s
          : { width: cr.width, height: cr.height },
      );
    });
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, size];
}

/** Re-render when the theme attribute flips (colours are read from CSS variables). */
export function useTheme(): 'dark' | 'light' {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => mo.disconnect();
    },
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
    () => 'dark',
  );
}

const POLES = {
  light: { neg: ['#f3b6b3', '#e34948', '#9e1f22'], pos: ['#b7d3f6', '#2a78d6', '#104281'], mid: '#f0efec' },
  dark: { neg: ['#6b3231', '#e66767', '#ffb3b1'], pos: ['#1d4677', '#3987e5', '#a9d0ff'], mid: '#383835' },
};

/**
 * Diverging blue ↔ red scale through a neutral gray (CVD-safe — red/green is
 * not). t ∈ [−1, 1]; negative → red arm, positive → blue arm. Interpolated in
 * CIELAB so perceived lightness changes evenly.
 */
export function diverging(t: number, theme: 'dark' | 'light'): string {
  const p = POLES[theme];
  const x = Math.max(-1, Math.min(1, t));
  const arm = x < 0 ? p.neg : p.pos;
  const a = Math.abs(x);
  const stops = [p.mid, ...arm];
  const seg = Math.min(2, Math.floor(a * 3));
  const local = a * 3 - seg;
  return interpolateLab(stops[seg], stops[seg + 1])(Math.min(1, local));
}

/** Readable label colour inside a fill (white or near-black by luminance). */
export function inkOn(hex: string): string {
  const m =
    hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i) ?? hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#ffffff';
  const [r, g, b] = (
    hex.startsWith('rgb') ? m.slice(1, 4).map(Number) : m.slice(1, 4).map((h) => parseInt(h, 16))
  ).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.38 ? '#0b0b0b' : '#ffffff';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dOf = (day: number) => new Date(day * 86_400_000);

/** Ticks for an index-based time axis (trading days evenly spaced). */
export function timeTicks(dates: number[], maxTicks: number): { index: number; label: string }[] {
  const n = dates.length;
  if (n < 2) return [];
  const span = dates[n - 1] - dates[0];
  type G = 'year' | 'quarter' | 'month' | 'week' | 'day';
  const g: G =
    span > 3 * 365 ? 'year' : span > 300 ? 'quarter' : span > 75 ? 'month' : span > 12 ? 'week' : 'day';
  const key = (day: number) => {
    const d = dOf(day);
    if (g === 'year') return d.getUTCFullYear();
    if (g === 'quarter') return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
    if (g === 'month') return d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (g === 'week') return Math.floor((day + 3) / 7);
    return day;
  };
  const fmt = (day: number) => {
    const d = dOf(day);
    if (g === 'year') return String(d.getUTCFullYear());
    if (g === 'quarter' || g === 'month')
      return d.getUTCMonth() === 0
        ? String(d.getUTCFullYear())
        : `${MONTHS[d.getUTCMonth()]}${g === 'quarter' ? ` ’${String(d.getUTCFullYear()).slice(2)}` : ''}`;
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };
  const idx: number[] = [];
  for (let i = 1; i < n; i++) if (key(dates[i]) !== key(dates[i - 1])) idx.push(i);
  const stride = Math.max(1, Math.ceil(idx.length / maxTicks));
  return idx.filter((_, k) => k % stride === 0).map((i) => ({ index: i, label: fmt(dates[i]) }));
}

export const fmtTooltipDate = (day: number) => {
  const d = dOf(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function TooltipBox({
  x,
  y,
  width,
  children,
  containerWidth,
}: {
  x: number;
  y: number;
  width?: number;
  children: ReactNode;
  containerWidth: number;
}) {
  const w = width ?? 200;
  const left = x + 14 + w > containerWidth ? Math.max(4, x - 14 - w) : x + 14;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-xl border border-line-strong bg-surface/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
      style={{ left, top: Math.max(0, y), width: w }}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function TooltipRow({
  color,
  label,
  value,
  kind = 'line',
}: {
  color: string;
  label: ReactNode;
  value: ReactNode;
  kind?: 'line' | 'rect' | 'dot';
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
        {kind === 'line' ? (
          <span className="inline-block h-[2px] w-3 shrink-0 rounded" style={{ background: color }} />
        ) : kind === 'dot' ? (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        ) : (
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="num font-semibold text-ink">{value}</span>
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; kind?: 'line' | 'rect' | 'dot' }[];
}) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.kind === 'rect' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          ) : it.kind === 'dot' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          ) : (
            <span className="inline-block h-[2px] w-4 rounded" style={{ background: it.color }} />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Rough text width for axis-margin sizing (no DOM measuring needed). */
export const textWidth = (s: string, px = 11) => s.length * px * 0.58;
