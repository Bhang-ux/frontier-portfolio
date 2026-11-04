import { scaleLinear } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import { useMemo, useState } from 'react';
import { Legend, TooltipBox, TooltipRow, useSize } from './core';

export interface FPoint {
  vol: number;
  ret: number;
}

interface Hit {
  kind: 'asset' | 'special' | 'frontier' | 'current' | 'selected';
  label: string;
  vol: number;
  ret: number;
  index?: number;
}

export function FrontierChart({
  frontier,
  cloud,
  assets,
  specials,
  current,
  selected,
  riskFree,
  onPick,
  height = 380,
}: {
  frontier: FPoint[];
  cloud: FPoint[];
  assets: (FPoint & { id: string; label: string })[];
  specials: (FPoint & { key: string; label: string })[];
  current?: FPoint;
  selected?: FPoint & { label: string };
  riskFree: number;
  onPick?: (index: number) => void;
  height?: number;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hit, setHit] = useState<Hit | null>(null);
  const m = { top: 14, right: 18, bottom: 34, left: 48 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;

  const { x, y } = useMemo(() => {
    const all = [...frontier, ...assets, ...cloud, ...specials, ...(current ? [current] : [])];
    const vmax = Math.max(...all.map((p) => p.vol), 0.05) * 1.08;
    // Include the risk-free rate (the CML starts there) but not an arbitrary 0%.
    const rmin = Math.min(...all.map((p) => p.ret), riskFree);
    const rmax = Math.max(...all.map((p) => p.ret));
    const pad = Math.max((rmax - rmin) * 0.08, 0.002);
    return {
      x: scaleLinear().domain([0, vmax]).nice().range([0, iw]),
      y: scaleLinear().domain([rmin - pad, rmax + pad]).nice().range([ih, 0]),
    };
  }, [frontier, assets, cloud, specials, current, riskFree, iw, ih]);

  const tangency = specials.find((s) => s.key === 'max-sharpe');
  const cml = tangency && tangency.vol > 0 ? (() => {
    const slope = (tangency.ret - riskFree) / tangency.vol;
    const xEnd = x.domain()[1];
    return [{ vol: 0, ret: riskFree }, { vol: xEnd, ret: riskFree + slope * xEnd }];
  })() : null;

  const pts: Hit[] = useMemo(
    () => [
      ...assets.map((a) => ({ kind: 'asset' as const, label: a.label, vol: a.vol, ret: a.ret })),
      ...specials.map((s) => ({ kind: 'special' as const, label: s.label, vol: s.vol, ret: s.ret })),
      ...(current ? [{ kind: 'current' as const, label: 'Your portfolio', ...current }] : []),
      ...(selected ? [{ kind: 'selected' as const, ...selected }] : []),
      ...frontier.map((f, i) => ({ kind: 'frontier' as const, label: 'Efficient frontier', vol: f.vol, ret: f.ret, index: i })),
    ],
    [assets, specials, current, selected, frontier],
  );

  // Greedy label placement to avoid overlaps.
  const labels = useMemo(() => {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: { key: string; x: number; y: number; text: string }[] = [];
    const tryPlace = (key: string, px: number, py: number, text: string) => {
      const w = text.length * 6.2;
      for (const [dx, dy] of [[8, 4], [8, -8], [-8 - w, 4], [-8 - w, -8]]) {
        const box = { x0: px + dx, y0: py + dy - 10, x1: px + dx + w, y1: py + dy + 2 };
        if (box.x1 > iw + 10 || box.x0 < -m.left + 2) continue;
        if (placed.every((p) => box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1)) {
          placed.push(box);
          out.push({ key, x: px + dx, y: py + dy, text });
          return;
        }
      }
    };
    specials.forEach((s) => tryPlace(`s-${s.key}`, x(s.vol), y(s.ret), s.label));
    assets.forEach((a) => tryPlace(`a-${a.id}`, x(a.vol), y(a.ret), a.label));
    return out;
  }, [assets, specials, x, y, iw, m.left]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: Hit | null = null;
    let bd = 24 * 24;
    for (const p of pts) {
      const d = (x(p.vol) - px) ** 2 + (y(p.ret) - py) ** 2;
      const bias = p.kind === 'frontier' ? 1.6 : 1; // prefer named points over the curve
      if (d * bias < bd) {
        bd = d * bias;
        best = p;
      }
    }
    setHit(best);
  };

  const sharpe = (p: FPoint) => (p.vol > 0 ? (p.ret - riskFree) / p.vol : 0);
  const lineGen = d3line<FPoint>().x((d) => x(d.vol)).y((d) => y(d.ret));
  return (
    <div className="w-full">
      <div className="mb-2">
        <Legend
          items={[
            { label: 'Efficient frontier', color: 'var(--s1)' },
            { label: 'Optimised portfolio', color: 'var(--s1)', kind: 'dot' },
            ...(current ? [{ label: 'Your portfolio', color: 'var(--s2)', kind: 'dot' as const }] : []),
            { label: 'Individual assets', color: 'var(--text-2)', kind: 'dot' },
            { label: 'Random portfolios', color: 'color-mix(in oklab, var(--text-3) 45%, transparent)', kind: 'dot' },
          ]}
        />
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Efficient frontier: expected return versus risk for possible portfolios">
            <g transform={`translate(${m.left},${m.top})`}>
              {y.ticks(6).map((t) => (
                <g key={`y${t}`} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={iw} stroke="var(--grid)" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="num fill-[var(--text-3)] text-[11px]">
                    {(t * 100).toFixed(0)}%
                  </text>
                </g>
              ))}
              {x.ticks(6).map((t) => (
                <text key={`x${t}`} x={x(t)} y={ih + 16} textAnchor="middle" className="num fill-[var(--text-3)] text-[11px]">
                  {(t * 100).toFixed(0)}%
                </text>
              ))}
              <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--axis)" />
              <text x={iw / 2} y={ih + 30} textAnchor="middle" className="fill-[var(--text-3)] text-[11px]">
                Risk (annual volatility) →
              </text>
              <text transform={`translate(${-38},${ih / 2}) rotate(-90)`} textAnchor="middle" className="fill-[var(--text-3)] text-[11px]">
                Expected return →
              </text>
              {cloud.map((p, i) => (
                <circle key={i} cx={x(p.vol)} cy={y(p.ret)} r={1.8} fill="var(--text-3)" opacity={0.28} />
              ))}
              {cml && <path d={lineGen(cml) ?? ''} stroke="var(--text-3)" strokeWidth={1} fill="none" />}
              {frontier.length > 1 && <path d={lineGen(frontier) ?? ''} stroke="var(--s1)" strokeWidth={2.5} fill="none" strokeLinecap="round" />}
              {assets.map((a) => (
                <circle key={a.id} cx={x(a.vol)} cy={y(a.ret)} r={4.5} fill="var(--text-2)" stroke="var(--surface)" strokeWidth={2} />
              ))}
              {specials.map((s) => (
                <rect key={s.key} x={x(s.vol) - 4.5} y={y(s.ret) - 4.5} width={9} height={9} transform={`rotate(45 ${x(s.vol)} ${y(s.ret)})`} fill="var(--surface)" stroke="var(--text)" strokeWidth={1.5} />
              ))}
              {current && <circle cx={x(current.vol)} cy={y(current.ret)} r={7} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2.5} />}
              {selected && <circle cx={x(selected.vol)} cy={y(selected.ret)} r={7.5} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2.5} />}
              {labels.map((l) => (
                <text key={l.key} x={l.x} y={l.y} className="pointer-events-none fill-[var(--text-2)] text-[10.5px] font-medium">
                  {l.text}
                </text>
              ))}
              {hit && <circle cx={x(hit.vol)} cy={y(hit.ret)} r={10} fill="none" stroke="var(--text)" strokeWidth={1.5} pointerEvents="none" />}
              <rect
                width={iw}
                height={ih}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setHit(null)}
                onClick={() => hit?.kind === 'frontier' && hit.index !== undefined && onPick?.(hit.index)}
                style={{ cursor: hit?.kind === 'frontier' && onPick ? 'pointer' : 'default' }}
              />
            </g>
          </svg>
        )}
        {hit && (
          <TooltipBox x={m.left + x(hit.vol)} y={m.top + y(hit.ret) - 10} containerWidth={width} width={210}>
            <div className="mb-1 font-medium text-ink">{hit.label}</div>
            <TooltipRow kind="dot" color="var(--s1)" label="Expected return" value={`${(hit.ret * 100).toFixed(1)}%`} />
            <TooltipRow kind="dot" color="var(--text-2)" label="Risk (volatility)" value={`${(hit.vol * 100).toFixed(1)}%`} />
            <TooltipRow kind="dot" color="var(--s2)" label="Sharpe ratio" value={sharpe(hit).toFixed(2)} />
            {hit.kind === 'frontier' && onPick && <div className="mt-1 text-[11px] text-ink-3">Click to use this portfolio</div>}
          </TooltipBox>
        )}
      </div>
    </div>
  );
}
