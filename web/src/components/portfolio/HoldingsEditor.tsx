import { Trash2, Wand2 } from 'lucide-react';
import type { AssetSnapshot, Currency } from '@frontier/contracts';
import { CURRENCY_SYMBOL, money, pct } from '@/lib/format';
import type { Holding } from '@/lib/store';
import { AssetName, AssetPicker } from '@/components/domain/common';
import { cx } from '@/components/ui/primitives';

export function HoldingsEditor({
  holdings,
  assets,
  amount,
  currency,
  onChange,
  onAmount,
}: {
  holdings: Holding[];
  assets: Map<string, AssetSnapshot>;
  amount: number;
  currency: Currency;
  onChange: (h: Holding[]) => void;
  onAmount: (v: number) => void;
}) {
  const total = holdings.reduce((s, h) => s + h.weight, 0);
  const off = Math.abs(total - 1) > 0.0005;
  const setW = (id: string, w: number) =>
    onChange(holdings.map((h) => (h.id === id ? { ...h, weight: Math.max(0, w) } : h)));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[180px]">
          <span className="mb-1 block text-xs font-medium text-ink-3">Total value</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">
              {CURRENCY_SYMBOL[currency]}
            </span>
            <input
              className="input num !pl-7"
              type="number"
              min={0}
              step={1000}
              value={Math.round(amount)}
              onChange={(e) => onAmount(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Total portfolio value"
            />
          </div>
        </label>
        <AssetPicker
          exclude={holdings.map((h) => h.id)}
          onPick={(id) => onChange([...holdings, { id, weight: holdings.length ? 0.05 : 1 }])}
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 font-medium">Holding</th>
              <th className="w-[92px] px-2 py-2 text-right font-medium">Weight</th>
              <th className="hidden w-[120px] px-2 py-2 text-right font-medium sm:table-cell">Value</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const a = assets.get(h.id);
              return (
                <tr key={h.id} className="border-t border-line">
                  <td className="max-w-0 px-3 py-2">
                    {a ? <AssetName a={a} /> : <span className="text-ink-3">{h.id} (no data)</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="relative">
                      <input
                        className="input num !py-1.5 !pr-6 text-right"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={Number((h.weight * 100).toFixed(1))}
                        onChange={(e) => setW(h.id, (Number(e.target.value) || 0) / 100)}
                        aria-label={`Weight of ${a?.meta.short ?? h.id} in percent`}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">
                        %
                      </span>
                    </div>
                  </td>
                  <td className="num hidden px-2 py-2 text-right text-ink-2 sm:table-cell">
                    {money((h.weight / (total || 1)) * amount, currency, 0)}
                  </td>
                  <td className="pr-2 text-right">
                    <button
                      className="rounded-lg p-1.5 text-ink-3 transition hover:bg-neg-soft hover:text-neg"
                      onClick={() => onChange(holdings.filter((x) => x.id !== h.id))}
                      aria-label={`Remove ${a?.meta.short ?? h.id}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface-2">
              <td className="px-3 py-2 text-xs text-ink-3">{holdings.length} holdings</td>
              <td
                className={cx(
                  'num px-2 py-2 text-right text-[13px] font-semibold',
                  off ? 'text-[var(--warning)]' : 'text-ink',
                )}
              >
                {pct(total, 1)}
              </td>
              <td className="num hidden px-2 py-2 text-right text-ink-2 sm:table-cell">
                {money(amount, currency, 0)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {off && holdings.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
          <span>Weights add up to {pct(total, 1)}. They are scaled to 100% for analysis.</span>
          <button
            className="btn-quiet !px-2 !py-1 text-xs"
            onClick={() => onChange(holdings.map((h) => ({ ...h, weight: h.weight / (total || 1) })))}
          >
            <Wand2 size={13} /> Make it 100%
          </button>
        </div>
      )}
    </div>
  );
}
