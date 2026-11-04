import type { Currency } from '@frontier/contracts';
import { number, pct, seriesColor } from '@/lib/format';
import type { WalkForwardResponse } from '@/workers/quant.worker';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';

export function WalkForwardView({ wf, base }: { wf: WalkForwardResponse; base: Currency }) {
  const ranked = [...wf.curves].sort((a, b) => b.metrics.sharpe - a.metrics.sharpe);
  const best = ranked[0];
  return (
    <div>
      <p className="mb-3 text-[14px] leading-relaxed text-ink-2">
        From {wf.window.start} to {wf.window.end}, re-optimising every quarter on the trailing year,{' '}
        <strong>{best.label}</strong> had the best risk-adjusted result (Sharpe {number(best.metrics.sharpe)}
        ). Growth of every 1 {base === 'INR' ? 'rupee' : 'dollar'} invested at the start:
      </p>
      <TimeSeriesChart
        ariaLabel="Walk-forward equity curves"
        dates={wf.dates}
        height={280}
        yFormat={(v) => `${v.toFixed(2)}×`}
        series={wf.curves.map((c, i) => ({
          key: c.id,
          label: c.label,
          values: c.equity,
          color: seriesColor(i),
        }))}
      />
      <div className="mt-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 font-medium">Strategy</th>
              <th className="px-3 py-2 text-right font-medium">Return/yr</th>
              <th className="px-3 py-2 text-right font-medium">Volatility</th>
              <th className="px-3 py-2 text-right font-medium">Sharpe</th>
              <th className="px-3 py-2 text-right font-medium">Worst fall</th>
              <th className="px-3 py-2 text-right font-medium">Turnover/yr</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-3 py-2 font-medium">
                  {c.label}
                  {c === best && (
                    <span className="ml-2 rounded bg-pos-soft px-1.5 py-0.5 text-[10px] font-bold text-pos">
                      BEST
                    </span>
                  )}
                </td>
                <td className="num px-3 py-2 text-right">{pct(c.metrics.cagr)}</td>
                <td className="num px-3 py-2 text-right">{pct(c.metrics.volatility)}</td>
                <td className="num px-3 py-2 text-right font-semibold">{number(c.metrics.sharpe)}</td>
                <td className="num px-3 py-2 text-right text-neg">{pct(-c.metrics.maxDrawdown, 0)}</td>
                <td className="num px-3 py-2 text-right text-ink-2">{pct(c.avgTurnover, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Out-of-sample, after 10 bp trading costs. Notice how often simple, estimate-light methods (equal
        weight, risk parity, HRP) match or beat the “optimal” portfolio — the famous result of DeMiguel,
        Garlappi & Uppal (2009).
      </p>
    </div>
  );
}
