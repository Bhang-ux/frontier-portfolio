import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Info, TriangleAlert, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useSettings } from '@/lib/store';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Card({ className, children, as: As = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx('card', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, subtitle, right, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}

export function PageHeader({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow && <div className="label mb-2">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative rounded-[10px] font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && <motion.span layoutId={`seg-${label ?? ''}`} className="absolute inset-0 rounded-[10px] border border-line-strong bg-surface shadow-sm" transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <span className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3')}>
        <span className={cx('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </span>
      {label}
    </button>
  );
}

/** Signed change with an arrow icon so meaning never rides on colour alone. */
export function Delta({ value, digits = 2, className, suffix }: { value: number | null | undefined; digits?: number; className?: string; suffix?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cx('text-ink-3', className)}>—</span>;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const t = value > 0 ? 'text-pos' : value < 0 ? 'text-neg' : 'text-ink-2';
  const s = `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toFixed(digits)}%`;
  return (
    <span className={cx('num inline-flex items-center gap-0.5 font-medium', t, className)}>
      <Icon size={14} strokeWidth={2.4} aria-hidden />
      {s}
      {suffix}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={`What is ${title}?`} className="inline-flex text-ink-3 transition hover:text-ink">
        <Info size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} collisionPadding={12} className="z-50 max-w-[320px] rounded-xl border border-line-strong bg-surface p-3.5 text-[13px] leading-relaxed text-ink-2 shadow-2xl">
          <div className="mb-1 font-semibold text-ink">{title}</div>
          {children}
          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={6} className="z-50 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink-2 shadow-xl">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * KPI tile: label, value, optional delta, and — in beginner mode — a
 * one-sentence plain-English explanation underneath.
 */
export function Stat({
  label,
  value,
  sub,
  explain,
  info,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  explain?: ReactNode;
  info?: ReactNode;
  tone?: 'pos' | 'neg' | 'warn';
  className?: string;
}) {
  const beginner = useSettings((s) => s.mode) === 'beginner';
  return (
    <div className={cx('card card-pad flex flex-col', className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
        {info && <InfoTip title={label}>{info}</InfoTip>}
      </div>
      <div className={cx('mt-1.5 text-[26px] font-semibold leading-none tracking-tight', tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1.5 text-[13px] text-ink-3">{sub}</div>}
      {beginner && explain && <p className="mt-2.5 border-t border-line pt-2.5 text-[13px] leading-snug text-ink-2">{explain}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-ink-3">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-[13px] text-ink-3">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'good'; title?: string; children: ReactNode }) {
  const style = tone === 'warn' ? 'border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_9%,transparent)]' : tone === 'good' ? 'border-[color-mix(in_oklab,var(--good)_40%,transparent)] bg-pos-soft' : 'border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-accent-soft';
  return (
    <div className={cx('flex gap-3 rounded-2xl border p-3.5 text-[13px] leading-relaxed text-ink-2', style)} role={tone === 'warn' ? 'alert' : undefined}>
      {tone === 'warn' ? <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden /> : <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
      <div>
        {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ value, color = 'var(--accent)', track = 'var(--surface-3)', height = 6 }: { value: number; color?: string; track?: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ background: track, height }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{children}</kbd>;
}
