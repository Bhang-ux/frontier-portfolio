/**
 * Multi-series time-series chart: lines/areas on an index (trading-day)
 * axis, crosshair that snaps to the nearest observation, one tooltip listing
 * every series, keyboard navigation, optional shaded bands and log scale.
 */
import { scaleLinear, scaleLog } from 'd3-scale';
import { area as d3area, line as d3line } from 'd3-shape';
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Legend, TooltipBox, TooltipRow, fmtTooltipDate, textWidth, timeTicks, useSize } from './core';

export interface TSeries {
  key: string;
  label: string;
  values: (number | null)[];
  color: string;
  area?: boolean;
  width?: number;
}

export interface Band {
  from: number; // index
  to: number; // index
  color: string;
  label?: string;
}

export function TimeSeriesChart({
  dates,
  series,
  height = 260,
  yFormat = (v) => v.toFixed(2),
  tooltipFormat,
  log = false,
  baseline,
  bands = [],
  ariaLabel,
  showLegend = true,
  xLabel,
  intraday = false,
  yDomain,
  onHover,
}: {
  dates: number[];
  series: TSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  tooltipFormat?: (v: number, s: TSeries) => string;
  log?: boolean;
  baseline?: number;
  bands?: Band[];
  ariaLabel: string;
  showLegend?: boolean;
  xLabel?: (i: number) => string;
  intraday?: boolean;
  yDomain?: [number, number];
  onHover?: (i: number | null) => void;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, '');
  const n = dates.length;

  const geo = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series)
      for (const v of s.values)
        if (v !== null && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
    if (baseline !== undefined) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    if (yDomain) [lo, hi] = yDomain;
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (lo === hi) [lo, hi] = [lo - Math.abs(lo || 1) * 0.05, hi + Math.abs(hi || 1) * 0.05];
    const useLog = log && lo > 0;
    const y0 = useLog ? scaleLog().domain([lo, hi]).nice() : scaleLinear().domain([lo, hi]).nice(5);
    const ticks = useLog
      ? (y0 as ReturnType<typeof scaleLog>)
          .ticks(5)
          .filter((_, i, a) => a.length <= 6 || i % Math.ceil(a.length / 6) === 0)
      : y0.ticks(5);
    const labelW = Math.max(...ticks.map((t) => textWidth(yFormat(t)))) + 10;
    const m = { top: 10, right: 10, bottom: 24, left: Math.max(36, labelW) };
    const iw = Math.max(10, width - m.left - m.right);
    const ih = Math.max(10, height - m.top - m.bottom);
    const x = scaleLinear()
      .domain([0, Math.max(1, n - 1)])
      .range([0, iw]);
    const y = y0.range([ih, 0]);
    return { m, iw, ih, x, y, ticks };
  }, [series, width, height, n, log, baseline, yDomain, yFormat]);

  const paths = useMemo(() => {
    const { x, y, ih } = geo;
    return series.map((s) => {
      const def = (v: number | null) => v !== null && Number.isFinite(v) && (!log || v > 0);
      const ln = d3line<number | null>()
        .defined(def)
        .x((_, i) => x(i))
        .y((v) => y(v as number));
      const ar = d3area<number | null>()
        .defined(def)
        .x((_, i) => x(i))
        .y0(baseline !== undefined && !log ? y(baseline) : ih)
        .y1((v) => y(v as number));
      return { key: s.key, line: ln(s.values) ?? '', area: s.area ? (ar(s.values) ?? '') : '' };
    });
  }, [series, geo, log, baseline]);

  const xticks = useMemo(() => {
    if (intraday) {
      const out: { index: number; label: string }[] = [];
      const stride = Math.max(1, Math.ceil(n / 6));
      for (let i = 0; i < n; i += stride) out.push({ index: i, label: xLabel ? xLabel(i) : String(i) });
      return out;
    }
    return timeTicks(dates, Math.max(2, Math.floor(geo.iw / 80)));
  }, [dates, geo.iw, intraday, n, xLabel]);

  const setIdx = (i: number | null) => {
    setHover(i);
    onHover?.(i);
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const i = Math.round(geo.x.invert(e.clientX - r.left));
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setIdx(Math.max(0, Math.min(n - 1, (hover ?? n - 1) + d * Math.max(1, Math.round(n / 100)))));
    } else if (e.key === 'Escape') setIdx(null);
  };

  const { m, iw, ih, x, y, ticks } = geo;
  const hx = hover !== null ? x(hover) : 0;
  const fmtV = (v: number, s: TSeries) => (tooltipFormat ? tooltipFormat(v, s) : yFormat(v));

  return (
    <div className="w-full">
      {showLegend && series.length > 1 && (
        <div className="mb-2">
          <Legend
            items={series.map((s) => ({
              label: s.label,
              color: s.color,
              kind: s.area && series.length === 1 ? 'rect' : 'line',
            }))}
          />
        </div>
      )}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && n > 1 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setIdx(null)}
            className="block overflow-visible outline-none"
          >
            <defs>
              <clipPath id={`c${clipId}`}>
                <rect x={0} y={-2} width={iw} height={ih + 4} />
              </clipPath>
            </defs>
            <g transform={`translate(${m.left},${m.top})`}>
              {bands.map((b, i) => (
                <rect
                  key={i}
                  x={x(b.from)}
                  width={Math.max(1, x(b.to) - x(b.from))}
                  y={0}
                  height={ih}
                  fill={b.color}
                />
              ))}
              {ticks.map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={iw} stroke="var(--grid)" strokeWidth={1} />
                  <text x={-8} dy="0.32em" textAnchor="end" className="num fill-[var(--text-3)] text-[11px]">
                    {yFormat(t)}
                  </text>
                </g>
              ))}
              {baseline !== undefined && !log && (
                <line x1={0} x2={iw} y1={y(baseline)} y2={y(baseline)} stroke="var(--axis)" strokeWidth={1} />
              )}
              <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--axis)" strokeWidth={1} />
              {xticks.map((t) => (
                <text
                  key={t.index}
                  x={x(t.index)}
                  y={ih + 16}
                  textAnchor="middle"
                  className="num fill-[var(--text-3)] text-[11px]"
                >
                  {t.label}
                </text>
              ))}
              <g clipPath={`url(#c${clipId})`}>
                {paths.map((p, i) =>
                  p.area ? <path key={`a${p.key}`} d={p.area} fill={series[i].color} opacity={0.12} /> : null,
                )}
                {paths.map((p, i) => (
                  <path
                    key={p.key}
                    d={p.line}
                    fill="none"
                    stroke={series[i].color}
                    strokeWidth={series[i].width ?? 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </g>
              {hover !== null && (
                <g pointerEvents="none">
                  <line x1={hx} x2={hx} y1={0} y2={ih} stroke="var(--text-3)" strokeWidth={1} />
                  {series.map((s) => {
                    const v = s.values[hover];
                    if (v === null || !Number.isFinite(v) || (log && v <= 0)) return null;
                    return (
                      <circle
                        key={s.key}
                        cx={hx}
                        cy={y(v)}
                        r={4}
                        fill={s.color}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      />
                    );
                  })}
                </g>
              )}
              <rect
                width={iw}
                height={ih}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setIdx(null)}
                style={{ touchAction: 'pan-y' }}
              />
            </g>
          </svg>
        )}
        {hover !== null && width > 0 && (
          <TooltipBox x={m.left + hx} y={m.top + 4} containerWidth={width}>
            <div className="mb-1 font-medium text-ink-2">
              {xLabel ? xLabel(hover) : fmtTooltipDate(dates[hover])}
            </div>
            {series.map((s) => {
              const v = s.values[hover];
              return v === null || !Number.isFinite(v) ? null : (
                <TooltipRow key={s.key} color={s.color} label={s.label} value={fmtV(v, s)} />
              );
            })}
          </TooltipBox>
        )}
      </div>
    </div>
  );
}
