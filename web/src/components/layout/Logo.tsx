import { Link } from 'react-router';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="fg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#a855f7" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#fg)" />
      {/* an efficient frontier: concave curve with a tangency point */}
      <path d="M7 24 C 9 15, 15 9.5, 25 8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7 21.5 L 25 12.8" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16.6" cy="12.1" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Frontier home">
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-semibold tracking-tight text-ink">Frontier</span>
          <span className="mt-0.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">Portfolio intelligence</span>
        </span>
      )}
    </Link>
  );
}
