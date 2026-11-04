import { CheckCircle2, CircleAlert, CircleMinus, CircleX, Lightbulb } from 'lucide-react';
import type { HealthReport, HealthStatus } from '@frontier/quant';
import { ScoreRing } from '@/components/charts/charts';
import { Card, CardHeader, ProgressBar } from '@/components/ui/primitives';

export const STATUS: Record<HealthStatus, { color: string; label: string; Icon: typeof CheckCircle2 }> = {
  good: { color: 'var(--good)', label: 'Strong', Icon: CheckCircle2 },
  ok: { color: 'var(--warning)', label: 'Fair', Icon: CircleMinus },
  warn: { color: 'var(--serious)', label: 'Weak', Icon: CircleAlert },
  bad: { color: 'var(--critical)', label: 'Poor', Icon: CircleX },
};

const gradeStatus = (score: number): HealthStatus => (score >= 80 ? 'good' : score >= 60 ? 'ok' : score >= 40 ? 'warn' : 'bad');

export function HealthCard({ h }: { h: HealthReport }) {
  const st = STATUS[gradeStatus(h.score)];
  return (
    <Card className="card-pad">
      <CardHeader title="Portfolio health" subtitle="Five checks every professional runs, rolled into one score." />
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <ScoreRing
          value={h.score}
          color={st.color}
          label={
            <>
              <span className="text-[34px] font-semibold leading-none">{h.grade}</span>
              <span className="num mt-1 text-xs text-ink-3">{h.score}/100</span>
            </>
          }
        />
        <div className="w-full min-w-0 flex-1">
          <p className="mb-3 text-[14px] font-medium text-ink">{h.headline}</p>
          <ul className="space-y-2.5">
            {h.components.map((c) => {
              const s = STATUS[c.status];
              return (
                <li key={c.key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <s.Icon size={14} style={{ color: s.color }} aria-hidden />
                      {c.label}
                    </span>
                    <span className="num text-xs text-ink-3">
                      {s.label} · {Math.round(c.score)}
                    </span>
                  </div>
                  <ProgressBar value={c.score / 100} color={s.color} height={5} />
                  <div className="mt-1 text-xs text-ink-3">{c.summary}</div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {h.suggestions.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Lightbulb size={15} className="text-[var(--warning)]" /> What would improve it
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-snug text-ink-2">
            {h.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
