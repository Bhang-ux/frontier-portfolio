import { arc as d3arc, line as d3line, pie as d3pie, area as d3area } from 'd3-shape';
import { scaleBand, scaleLinear } from 'd3-scale';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Legend, TooltipBox, TooltipRow, diverging, inkOn, textWidth, useSize, useTheme } from './core';
import { cx } from '@/components/ui/primitives';

// ─── Sparkline ─────────────────────────────────────────────────────────────
export function Sparkline({ values, width = 96, height = 28, color, area = true, ariaLabel }: { values: number[]; width?: number; height?: number; color?: string; area?: boolean; ariaLabel?: string }) {
  const path = useMemo(() => {
    const v = values.filter(Number.isFinite);
    if (v.length < 2) return null;
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const x = scaleLinear().domain([0, v.length - 1]).range([1, width - 1]);
    const y = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([height - 2, 2]);
    return {
      line: d3line<number>().x((_, i) => x(i)).y((d) => y(d))(v) ?? '',
      area: d3area<number>().x((_, i) => x(i)).y0(height).y1((d) => y(d))(v) ?? '',
      up: v[v.length - 1] >= v[0],
    };
  }, [values, width, height]);
  if (!path) return <svg width={width} height={height} aria-hidden />;
  const c = color ?? (path.up ? 'var(--pos)' : 'var(--neg)');
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel ?? `Trend ${path.up ? 'up' : 'down'}`} className="block overflow-visible">
      {area && <path d={path.area} fill={c} opacity={0.1} />}
      <path d={path.line} fill="none" stroke={c} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Donut ────────────────────────────────────────────────────────────────
export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({ slices, size = 200, thickness = 26, center, format = (v) => `${(v * 100).toFixed(1)}%` }: { slices: Slice[]; size?: number; thickness?: number; center?: ReactNode; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const arcs = useMemo(() => d3pie<Slice>().value((d) => d.value).sort(null).padAngle(slices.length > 1 ? 0.018 : 0)(slices), [slices]);
  const r = size / 2;
  const mk = (grow: number) => d3arc<(typeof arcs)[number]>().innerRadius(r - thickness).outerRadius(r - 4 + grow).cornerRadius(3);
  const base = mk(0);
  const lift = mk(4);
  const h = hover !== null ? slices[hover] : null;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Allocation: ${slices.map((s) => `${s.label} ${format(s.value / total)}`).join(', ')}`}>
        <g transform={`translate(${r},${r})`}>
          {arcs.map((a, i) => (
            <path
              key={a.data.key}
              d={(hover === i ? lift : base)(a) ?? ''}
              fill={a.data.color}
              opacity={hover === null || hover === i ? 1 : 0.45}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${a.data.label}: ${format(a.data.value / total)}`}
              className="cursor-pointer outline-none transition-opacity"
            />
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {h ? (
          <>
            <div className="max-w-[60%] truncate text-xs text-ink-3">{h.label}</div>
            <div className="text-xl font-semibold text-ink">{format(h.value / total)}</div>
          </>
        ) : (
          center
        )}
      </div>
    </div>
  );
}

// ─── Horizontal bars ──────────────────────────────────────────────────────
export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Optional second value drawn as a paired thinner bar (e.g. weight vs risk). */
  value2?: number;
  color?: string;
  note?: ReactNode;
}

export function BarList({
  rows,
  format = (v) => `${(v * 100).toFixed(1)}%`,
  colors = ['var(--s1)', 'var(--s2)'],
  labels,
  diverging: isDiv = false,
  max,
}: {
  rows: BarRow[];
  format?: (v: number) => string;
  colors?: [string, string] | string[];
  labels?: [string, string];
  diverging?: boolean;
  max?: number;
}) {
  const extent = max ?? Math.max(1e-9, ...rows.flatMap((r) => [Math.abs(r.value), Math.abs(r.value2 ?? 0)]));
  return (
    <div className="w-full">
      {labels && <div className="mb-2"><Legend items={[{ label: labels[0], color: colors[0], kind: 'rect' }, { label: labels[1], color: colors[1], kind: 'rect' }]} /></div>}
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const w1 = Math.abs(r.value) / extent;
          const w2 = r.value2 !== undefined ? Math.abs(r.value2) / extent : 0;
          const neg = r.value < 0;
          return (
            <li key={r.key} className="grid grid-cols-[minmax(80px,34%)_1fr] items-center gap-3 text-[13px]" aria-label={`${typeof r.label === 'string' ? r.label : r.key}: ${format(r.value)}${r.value2 !== undefined ? `, ${format(r.value2)}` : ''}`}>
              <div className="min-w-0 truncate text-ink-2">{r.label}</div>
              <div className="min-w-0">
                {isDiv ? (
                  <div className="relative flex h-5 items-center">
                    <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--axis)]" />
                    {/* bars use ≤ 80 % of each half so the value label always fits */}
                    <div className="absolute h-3.5" style={{ left: neg ? `${50 - w1 * 40}%` : '50%', width: `${Math.max(w1 * 40, 0.3)}%`, background: r.color ?? (neg ? 'var(--s8)' : 'var(--s1)'), borderRadius: neg ? '4px 0 0 4px' : '0 4px 4px 0' }} />
                    <span className="num absolute whitespace-nowrap text-xs font-semibold text-ink" style={neg ? { right: `calc(${50 + w1 * 40}% + 6px)` } : { left: `calc(${50 + w1 * 40}% + 6px)` }}>
                      {format(r.value)}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(w1 * 82, 0.5)}%`, background: r.color ?? colors[0] }} />
                      <span className="num text-xs font-semibold text-ink">{format(r.value)}</span>
                    </div>
                    {r.value2 !== undefined && (
                      <div className="flex items-center gap-2">
                        <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(w2 * 82, 0.5)}%`, background: colors[1] }} />
                        <span className="num text-xs text-ink-2">{format(r.value2)}</span>
                      </div>
                    )}
                  </div>
                )}
                {r.note && <div className="mt-0.5 text-xs text-ink-3">{r.note}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Heatmap (correlation / calendar) ─────────────────────────────────────
export function Heatmap({
  rows,
  cols,
  colLabels,
  values,
  format = (v) => v.toFixed(2),
  scale = 1,
  cellLabel = true,
  ariaLabel,
  minCell = 26,
}: {
  rows: string[];
  cols: string[];
  /** Optional short column labels (e.g. tickers) — full names stay in tooltips. */
  colLabels?: string[];
  values: (number | null)[][];
  format?: (v: number) => string;
  /** Value mapped to the end of each colour arm. */
  scale?: number;
  cellLabel?: boolean;
  ariaLabel: string;
  minCell?: number;
}) {
  const theme = useTheme();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<[number, number] | null>(null);
  const labelW = Math.min(140, Math.max(...rows.map((r) => textWidth(r, 11))) + 10);
  const shown = colLabels ?? cols;
  const cell = Math.max(minCell, Math.min(56, (width - labelW) / Math.max(cols.length, 1)));
  const rotate = shown.some((c) => textWidth(c, 10.5) > cell - 4);
  const topH = rotate ? Math.min(90, Math.max(...shown.map((c) => textWidth(c, 10.5))) * 0.72 + 14) : 26;
  const w = labelW + cell * cols.length;
  const h = topH + cell * rows.length;
  const showText = cellLabel && cell >= 30;
  return (
    <div ref={ref} className="relative w-full overflow-x-auto">
      {width > 0 && (
        <svg width={w} height={h} role="img" aria-label={ariaLabel}>
          {shown.map((c, j) =>
            rotate ? (
              <text key={cols[j]} transform={`translate(${labelW + j * cell + cell / 2 + 3},${topH - 6}) rotate(-45)`} className="fill-[var(--text-3)] text-[10.5px]">
                {c}
              </text>
            ) : (
              <text key={cols[j]} x={labelW + j * cell + cell / 2} y={topH - 8} textAnchor="middle" className="fill-[var(--text-3)] text-[10.5px]">
                {c}
              </text>
            ),
          )}
          {rows.map((r, i) => (
            <g key={r}>
              <text x={labelW - 8} y={topH + i * cell + cell / 2} dy="0.32em" textAnchor="end" className="fill-[var(--text-2)] text-[11px]">
                {r}
              </text>
              {cols.map((c, j) => {
                const v = values[i][j];
                const fill = v === null || !Number.isFinite(v) ? 'var(--surface-2)' : diverging(v / scale, theme);
                return (
                  <g key={c} onPointerEnter={() => setHover([i, j])} onPointerLeave={() => setHover(null)}>
                    <rect x={labelW + j * cell + 1} y={topH + i * cell + 1} width={cell - 2} height={cell - 2} rx={4} fill={fill} stroke={hover && hover[0] === i && hover[1] === j ? 'var(--text)' : 'none'} strokeWidth={1.5} />
                    {showText && v !== null && Number.isFinite(v) && (
                      <text x={labelW + j * cell + cell / 2} y={topH + i * cell + cell / 2} dy="0.32em" textAnchor="middle" className="num pointer-events-none text-[10.5px] font-medium" fill={fill.startsWith('#') || fill.startsWith('rgb') ? inkOn(fill) : 'var(--text-2)'}>
                        {format(v)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      )}
      {hover && values[hover[0]][hover[1]] !== null && (
        <TooltipBox x={labelW + hover[1] * cell + cell / 2} y={topH + hover[0] * cell} containerWidth={width} width={190}>
          <div className="mb-1 text-ink-2">
            {rows[hover[0]]} × {cols[hover[1]]}
          </div>
          <div className="num text-sm font-semibold text-ink">{format(values[hover[0]][hover[1]] as number)}</div>
        </TooltipBox>
      )}
    </div>
  );
}

export function DivergingLegend({ min, max, label }: { min: string; max: string; label?: string }) {
  const theme = useTheme();
  const stops = Array.from({ length: 11 }, (_, i) => diverging(-1 + i / 5, theme));
  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-3">
      {label && <span>{label}</span>}
      <span>{min}</span>
      <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${stops.join(',')})` }} />
      <span>{max}</span>
    </div>
  );
}

// ─── Histogram ────────────────────────────────────────────────────────────
export function Histogram({ edges, counts, overlay, markers = [], height = 200, format = (v) => `${(v * 100).toFixed(1)}%`, ariaLabel }: { edges: number[]; counts: number[]; overlay?: number[]; markers?: { value: number; label: string }[]; height?: number; format?: (v: number) => string; ariaLabel: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 14, right: 8, bottom: 22, left: 8 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const x = scaleLinear().domain([edges[0], edges[edges.length - 1]]).range([0, iw]);
  const ymax = Math.max(...counts, ...(overlay ?? [0]));
  const y = scaleLinear().domain([0, ymax || 1]).range([ih, 0]);
  const ticks = x.ticks(6);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <g transform={`translate(${m.left},${m.top})`}>
            {counts.map((c, i) => {
              const x0 = x(edges[i]);
              const x1 = x(edges[i + 1]);
              const mid = (edges[i] + edges[i + 1]) / 2;
              return (
                <rect key={i} x={x0 + 1} width={Math.max(1, x1 - x0 - 2)} y={y(c)} height={ih - y(c)} rx={2} fill={mid < 0 ? 'var(--s8)' : 'var(--s1)'} opacity={hover === null || hover === i ? 0.85 : 0.4} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
              );
            })}
            {overlay && <path d={d3line<number>().x((_, i) => x((edges[i] + edges[i + 1]) / 2)).y((v) => y(v))(overlay) ?? ''} fill="none" stroke="var(--text-2)" strokeWidth={1.5} />}
            {markers.map((mk) => (
              <g key={mk.label} transform={`translate(${x(mk.value)},0)`}>
                <line y1={0} y2={ih} stroke="var(--text)" strokeWidth={1} />
                <text y={-3} textAnchor="middle" className="fill-[var(--text-2)] text-[10.5px] font-medium">
                  {mk.label}
                </text>
              </g>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--axis)" />
            {ticks.map((t) => (
              <text key={t} x={x(t)} y={ih + 15} textAnchor="middle" className="num fill-[var(--text-3)] text-[11px]">
                {format(t)}
              </text>
            ))}
          </g>
        </svg>
      )}
      {hover !== null && (
        <TooltipBox x={m.left + x((edges[hover] + edges[hover + 1]) / 2)} y={8} containerWidth={width} width={190}>
          <div className="mb-1 text-ink-2">
            {format(edges[hover])} to {format(edges[hover + 1])}
          </div>
          <TooltipRow kind="rect" color={(edges[hover] + edges[hover + 1]) / 2 < 0 ? 'var(--s8)' : 'var(--s1)'} label="Share of days" value={`${((counts[hover] / total) * 100).toFixed(1)}%`} />
        </TooltipBox>
      )}
    </div>
  );
}

// ─── Gauges ───────────────────────────────────────────────────────────────
/** Semicircle gauge on a diverging scale (e.g. fear ↔ greed), needle at value. */
export function MoodGauge({ value, label, size = 200 }: { value: number; label: string; size?: number }) {
  const theme = useTheme();
  const r = size / 2 - 8;
  const segs = 20;
  // d3 angle convention: 0 = 12 o'clock, clockwise. Semicircle spans −π/2 … +π/2.
  const angle = (t: number) => -Math.PI / 2 + Math.PI * t;
  const t = Math.max(0, Math.min(100, value)) / 100;
  const th = angle(t);
  const nl = r - 22;
  return (
    <svg width={size} height={size / 2 + 28} role="img" aria-label={`Market mood ${Math.round(value)} of 100: ${label}`}>
      <g transform={`translate(${size / 2},${size / 2})`}>
        {Array.from({ length: segs }, (_, i) => (
          <path
            key={i}
            d={d3arc()({ innerRadius: r - 14, outerRadius: r, startAngle: angle(i / segs), endAngle: angle((i + 1) / segs), padAngle: 0.012 }) ?? ''}
            fill={diverging(-1 + 2 * ((i + 0.5) / segs), theme)}
          />
        ))}
        <line x1={0} y1={0} x2={nl * Math.sin(th)} y2={-nl * Math.cos(th)} stroke="var(--text)" strokeWidth={3} strokeLinecap="round" />
        <circle r={6} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} />
        <text y={26} textAnchor="middle" className="fill-[var(--text)] text-[22px] font-semibold">
          {Math.round(value)}
        </text>
      </g>
      <text x={8} y={size / 2 + 24} className="fill-[var(--text-3)] text-[10.5px]">
        Fear
      </text>
      <text x={size - 8} y={size / 2 + 24} textAnchor="end" className="fill-[var(--text-3)] text-[10.5px]">
        Greed
      </text>
    </svg>
  );
}

/** Ring progress (e.g. health score) using status colours with a text label. */
export function ScoreRing({ value, size = 132, label, color }: { value: number; size?: number; label: ReactNode; color: string }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Score ${Math.round(value)} out of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${(c * Math.max(0, Math.min(100, value))) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{label}</div>
    </div>
  );
}

// ─── Fan chart (Monte Carlo) ──────────────────────────────────────────────
export function FanChart({ bands, invested, goal, height = 300, format, ariaLabel }: { bands: Record<'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95', number[]>; invested?: number[]; goal?: number; height?: number; format: (v: number) => string; ariaLabel: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = bands.p50.length;
  const hi = Math.max(...bands.p95, goal ?? 0, ...(invested ?? [0]));
  const y0 = scaleLinear().domain([0, hi]).nice(5);
  const ticks = y0.ticks(5);
  const lw = Math.max(...ticks.map((t) => textWidth(format(t)))) + 10;
  const m = { top: 12, right: 12, bottom: 24, left: Math.max(40, lw) };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const x = scaleLinear().domain([0, n - 1]).range([0, iw]);
  const y = y0.range([ih, 0]);
  const band = (lo: number[], up: number[]) => d3area<number>().x((_, i) => x(i)).y0((_, i) => y(lo[i])).y1((_, i) => y(up[i]))(lo) ?? '';
  const ln = (v: number[]) => d3line<number>().x((_, i) => x(i)).y((d) => y(d))(v) ?? '';
  const years = Math.round((n - 1) / 12);
  const yearTicks = Array.from({ length: years + 1 }, (_, i) => i).filter((yv) => years <= 12 || yv % Math.ceil(years / 10) === 0);
  return (
    <div className="w-full">
      <div className="mb-2">
        <Legend items={[{ label: 'Median outcome', color: 'var(--s1)' }, { label: '50% of outcomes', color: 'color-mix(in oklab, var(--s1) 45%, transparent)', kind: 'rect' }, { label: '90% of outcomes', color: 'color-mix(in oklab, var(--s1) 18%, transparent)', kind: 'rect' }, ...(invested ? [{ label: 'Money you put in', color: 'var(--s2)' }] : [])]} />
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            <g transform={`translate(${m.left},${m.top})`}>
              {ticks.map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={iw} stroke="var(--grid)" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="num fill-[var(--text-3)] text-[11px]">
                    {format(t)}
                  </text>
                </g>
              ))}
              <path d={band(bands.p5, bands.p95)} fill="var(--s1)" opacity={0.12} />
              <path d={band(bands.p10, bands.p90)} fill="var(--s1)" opacity={0.12} />
              <path d={band(bands.p25, bands.p75)} fill="var(--s1)" opacity={0.22} />
              <path d={ln(bands.p50)} fill="none" stroke="var(--s1)" strokeWidth={2.2} />
              {invested && <path d={ln(invested)} fill="none" stroke="var(--s2)" strokeWidth={2} />}
              {goal !== undefined && goal > 0 && (
                <g transform={`translate(0,${y(goal)})`}>
                  <line x1={0} x2={iw} stroke="var(--text)" strokeWidth={1} />
                  <text x={iw} y={-5} textAnchor="end" className="fill-[var(--text-2)] text-[11px] font-medium">
                    Goal {format(goal)}
                  </text>
                </g>
              )}
              <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--axis)" />
              {yearTicks.map((yv) => (
                <text key={yv} x={x(yv * 12)} y={ih + 16} textAnchor="middle" className="num fill-[var(--text-3)] text-[11px]">
                  {yv === 0 ? 'Now' : `${yv}y`}
                </text>
              ))}
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} stroke="var(--text-3)" />}
              <rect width={iw} height={ih} fill="transparent" onPointerMove={(e) => setHover(Math.max(0, Math.min(n - 1, Math.round(x.invert(e.clientX - e.currentTarget.getBoundingClientRect().left)))))} onPointerLeave={() => setHover(null)} />
            </g>
          </svg>
        )}
        {hover !== null && (
          <TooltipBox x={m.left + x(hover)} y={m.top} containerWidth={width} width={210}>
            <div className="mb-1 font-medium text-ink-2">{hover === 0 ? 'Today' : `After ${Math.floor(hover / 12)}y ${hover % 12}m`}</div>
            <TooltipRow kind="rect" color="color-mix(in oklab, var(--s1) 30%, transparent)" label="Great (90th pct)" value={format(bands.p90[hover])} />
            <TooltipRow color="var(--s1)" label="Median" value={format(bands.p50[hover])} />
            <TooltipRow kind="rect" color="color-mix(in oklab, var(--s1) 30%, transparent)" label="Poor (10th pct)" value={format(bands.p10[hover])} />
            {invested && <TooltipRow color="var(--s2)" label="Invested" value={format(invested[hover])} />}
          </TooltipBox>
        )}
      </div>
    </div>
  );
}

// ─── Columns (calendar-year returns etc.) ─────────────────────────────────
export function Columns({ items, height = 200, format = (v) => `${(v * 100).toFixed(0)}%`, ariaLabel }: { items: { key: string; label: string; value: number; color?: string }[]; height?: number; format?: (v: number) => string; ariaLabel: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 16, right: 6, bottom: 22, left: 6 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const lo0 = Math.min(0, ...items.map((i) => i.value));
  const hi0 = Math.max(0, ...items.map((i) => i.value));
  const span = hi0 - lo0 || 1;
  // headroom so value labels never collide with the axis labels or the top edge
  const lo = lo0 < 0 ? lo0 - span * 0.12 : 0;
  const hi = hi0 > 0 ? hi0 + span * 0.08 : 0;
  const y = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([ih, 0]);
  const x = scaleBand().domain(items.map((i) => i.key)).range([0, iw]).padding(0.25);
  const bw = Math.min(24, x.bandwidth());
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <g transform={`translate(${m.left},${m.top})`}>
            <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
            {items.map((it, i) => {
              const cx0 = (x(it.key) ?? 0) + x.bandwidth() / 2 - bw / 2;
              const top = y(Math.max(0, it.value));
              const h = Math.abs(y(it.value) - y(0));
              const neg = it.value < 0;
              const r = Math.min(4, h / 2);
              const path = neg
                ? `M${cx0},${y(0)} h${bw} v${h - r} q0,${r} -${r},${r} h-${bw - 2 * r} q-${r},0 -${r},-${r} Z`
                : `M${cx0},${y(0)} v-${h - r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} Z`;
              return (
                <g key={it.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect x={x(it.key)} y={0} width={x.bandwidth()} height={ih} fill="transparent" />
                  <path d={path} fill={it.color ?? (neg ? 'var(--s8)' : 'var(--s1)')} opacity={hover === null || hover === i ? 1 : 0.5} />
                  {items.length <= 14 && (
                    <text x={(x(it.key) ?? 0) + x.bandwidth() / 2} y={neg ? y(it.value) + 12 : top - 4} textAnchor="middle" className="num fill-[var(--text-2)] text-[10.5px]">
                      {format(it.value)}
                    </text>
                  )}
                  <text
                    x={i === 0 ? (x(it.key) ?? 0) : i === items.length - 1 ? (x(it.key) ?? 0) + x.bandwidth() : (x(it.key) ?? 0) + x.bandwidth() / 2}
                    y={ih + 15}
                    textAnchor={i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle'}
                    className="num fill-[var(--text-3)] text-[10.5px]"
                  >
                    {it.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover !== null && (
        <TooltipBox x={m.left + (x(items[hover].key) ?? 0)} y={0} containerWidth={width} width={150}>
          <div className="text-ink-2">{items[hover].label}</div>
          <div className="num text-sm font-semibold text-ink">{format(items[hover].value)}</div>
        </TooltipBox>
      )}
    </div>
  );
}

// ─── Chart card with table-view twin ──────────────────────────────────────
export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({ title, subtitle, right, table, children, className, footer }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; table?: TableData; children: ReactNode; className?: string; footer?: ReactNode }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={cx('card card-pad', className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          {table && (
            <button onClick={() => setView(view === 'chart' ? 'table' : 'chart')} className="btn-quiet !px-2 !py-1 text-xs" aria-pressed={view === 'table'} title={view === 'chart' ? 'Show as table' : 'Show as chart'}>
              {view === 'chart' ? <Table2 size={15} /> : <LineIcon size={15} />}
              <span className="sr-only">{view === 'chart' ? 'Table view' : 'Chart view'}</span>
            </button>
          )}
        </div>
      </header>
      {view === 'chart' || !table ? (
        children
      ) : (
        <div className="max-h-[360px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-surface-2 text-ink-3">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((v, j) => (
                    <td key={j} className={cx('px-3 py-1.5', j > 0 && 'num')}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </section>
  );
}
