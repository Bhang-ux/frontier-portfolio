import * as RSlider from '@radix-ui/react-slider';

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-ink-2">{label}</span>
        <span className="num font-semibold text-ink">{format ? format(value) : value}</span>
      </div>
      <RSlider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      >
        <RSlider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
          <RSlider.Range className="absolute h-full rounded-full bg-accent" />
        </RSlider.Track>
        <RSlider.Thumb className="block h-4 w-4 rounded-full border-2 border-accent bg-surface shadow transition hover:scale-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft" />
      </RSlider.Root>
    </div>
  );
}
