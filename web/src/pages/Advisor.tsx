import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Coins,
  Home,
  Landmark,
  LifeBuoy,
  PiggyBank,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ModelPortfolio } from '@frontier/contracts';
import { explain } from '@frontier/quant';
import { useMarketData, type MarketData } from '@/lib/data';
import { PROFILE_BLURB, PROFILE_NAMES, scoreProfile, type Answers, type Goal } from '@/lib/riskProfile';
import { usePortfolios, useSettings } from '@/lib/store';
import { useSimulation } from '@/lib/worker';
import { CURRENCY_SYMBOL, compactMoney, money, odds, pct, seriesColor, signedPct } from '@/lib/format';
import { Donut, FanChart } from '@/components/charts/charts';
import {
  Callout,
  Card,
  CardHeader,
  PageHeader,
  ProgressBar,
  Segmented,
  Skeleton,
  cx,
} from '@/components/ui/primitives';
import { Slider } from '@/components/ui/Slider';
import { DataState } from '@/components/domain/common';

export default function AdvisorPage() {
  const md = useMarketData();
  return (
    <DataState isLoading={md.isLoading} error={md.error}>
      {md.data && <Advisor data={md.data} />}
    </DataState>
  );
}

const GOALS: { value: Goal; label: string; icon: ReactNode; hint: string }[] = [
  { value: 'retirement', label: 'Retirement', icon: <Landmark size={20} />, hint: 'A comfortable future' },
  { value: 'wealth', label: 'Grow my wealth', icon: <Rocket size={20} />, hint: 'Long-term growth' },
  { value: 'purchase', label: 'A big purchase', icon: <Home size={20} />, hint: 'Home, education, car' },
  {
    value: 'emergency',
    label: 'Emergency fund',
    icon: <LifeBuoy size={20} />,
    hint: 'Money I may need anytime',
  },
  {
    value: 'learning',
    label: 'Learn by doing',
    icon: <Sparkles size={20} />,
    hint: 'Start small, understand markets',
  },
];

function Choice({
  selected,
  onClick,
  children,
  hint,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={selected}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition',
        selected
          ? 'border-accent bg-accent-soft shadow-[0_0_0_3px_var(--accent-soft)]'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
      )}
    >
      {icon && (
        <span
          className={cx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            selected ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2',
          )}
        >
          {icon}
        </span>
      )}
      <span>
        <span className="block text-[15px] font-semibold text-ink">{children}</span>
        {hint && <span className="block text-[13px] text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}

function Advisor({ data }: { data: MarketData }) {
  const settings = useSettings();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>(() => ({
    goal: 'wealth',
    horizon: settings.profile?.horizon ?? 10,
    reaction: 2,
    income: 1,
    experience: 1,
    market: settings.currency === 'INR' ? 'IN' : 'US',
    initial: settings.profile?.initial ?? (settings.currency === 'INR' ? 100_000 : 5_000),
    monthly: settings.profile?.monthly ?? (settings.currency === 'INR' ? 10_000 : 500),
    goalAmount: settings.profile?.goal,
  }));
  const [done, setDone] = useState(false);
  const up = (patch: Partial<Answers>) => setA((x) => ({ ...x, ...patch }));
  const cur = a.market === 'IN' ? 'INR' : 'USD';
  const steps: { title: string; sub?: string; body: ReactNode; valid?: boolean }[] = [
    {
      title: 'What are you investing for?',
      sub: 'Your goal shapes how much risk makes sense.',
      body: (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {GOALS.map((g) => (
            <Choice
              key={g.value}
              selected={a.goal === g.value}
              onClick={() => up({ goal: g.value })}
              icon={g.icon}
              hint={g.hint}
            >
              {g.label}
            </Choice>
          ))}
        </div>
      ),
    },
    {
      title: 'When will you need this money?',
      sub: 'Time is the single biggest risk-reducer: stock markets have historically recovered from every crash, but sometimes it took years.',
      body: (
        <div className="card card-pad">
          <Slider
            label="Years until I need it"
            value={a.horizon}
            min={1}
            max={40}
            step={1}
            onChange={(v) => up({ horizon: v })}
            format={(v) => `${v} year${v === 1 ? '' : 's'}`}
          />
          <p className="mt-3 text-[13px] text-ink-3">
            {a.horizon < 3
              ? 'Short horizon: you could be forced to sell during a downturn.'
              : a.horizon < 7
                ? 'Medium horizon: enough to ride out a typical bear market.'
                : 'Long horizon: plenty of time for compounding — and for recoveries.'}
          </p>
        </div>
      ),
    },
    {
      title: 'Your portfolio falls 25% in three months. What do you do?',
      sub: 'Be honest — this happened in 2008, 2020 and 2022. Your answer matters more than any other.',
      body: (
        <div className="grid gap-2.5" role="radiogroup">
          {[
            [
              'Sell everything to stop the pain',
              'I can’t sleep while losing money',
              <TrendingDown key="a" size={20} />,
            ],
            [
              'Sell some, keep the rest',
              'Reduce the risk, stay partly invested',
              <ShieldCheck key="b" size={20} />,
            ],
            ['Hold on and wait', 'Markets recover — I can be patient', <BadgeCheck key="c" size={20} />],
            [
              'Buy more — it’s a sale',
              'Lower prices mean better long-term returns',
              <Coins key="d" size={20} />,
            ],
          ].map(([t, h, ic], i) => (
            <Choice
              key={i}
              selected={a.reaction === i}
              onClick={() => up({ reaction: i as Answers['reaction'] })}
              hint={h as string}
              icon={ic}
            >
              {t}
            </Choice>
          ))}
        </div>
      ),
    },
    {
      title: 'How stable is your income?',
      sub: 'A steady income means you won’t need to sell investments at a bad time.',
      body: (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {[
            'Very stable (salaried, secure)',
            'Fairly stable',
            'Variable (business, freelance)',
            'No regular income right now',
          ].map((t, i) => (
            <Choice key={i} selected={a.income === i} onClick={() => up({ income: i as Answers['income'] })}>
              {t}
            </Choice>
          ))}
        </div>
      ),
    },
    {
      title: 'How much investing experience do you have?',
      body: (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {[
            ['None', 'Savings account or FDs only'],
            ['Some', 'Mutual funds or SIPs'],
            ['Experienced', 'I buy shares or ETFs myself'],
            ['Expert', 'I understand derivatives and leverage'],
          ].map(([t, h], i) => (
            <Choice
              key={i}
              selected={a.experience === i}
              onClick={() => up({ experience: i as Answers['experience'] })}
              hint={h}
            >
              {t}
            </Choice>
          ))}
        </div>
      ),
    },
    {
      title: 'Where do you want to invest?',
      sub: 'Frontier builds portfolios from low-cost index ETFs on the exchange you choose.',
      body: (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Choice
            selected={a.market === 'IN'}
            onClick={() =>
              up({
                market: 'IN',
                initial: a.market === 'IN' ? a.initial : 100_000,
                monthly: a.market === 'IN' ? a.monthly : 10_000,
              })
            }
            hint="NSE-listed ETFs, in rupees — Nifty 50, gold, gilts, US tech"
            icon={<span className="text-lg font-bold">₹</span>}
          >
            India
          </Choice>
          <Choice
            selected={a.market === 'US'}
            onClick={() =>
              up({
                market: 'US',
                initial: a.market === 'US' ? a.initial : 5_000,
                monthly: a.market === 'US' ? a.monthly : 500,
              })
            }
            hint="US-listed ETFs, in dollars — S&P 500, global stocks, bonds, gold"
            icon={<span className="text-lg font-bold">$</span>}
          >
            United States
          </Choice>
        </div>
      ),
    },
    {
      title: 'How much can you invest?',
      sub: 'Small amounts are fine — regular investing (a SIP) matters more than a big start.',
      body: (
        <div className="card card-pad grid gap-4 sm:grid-cols-3">
          {(
            [
              ['Start with', 'initial'],
              ['Every month', 'monthly'],
              ['Goal (optional)', 'goalAmount'],
            ] as const
          ).map(([label, key]) => (
            <label key={key}>
              <span className="mb-1 block text-xs font-medium text-ink-3">{label}</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">
                  {CURRENCY_SYMBOL[cur]}
                </span>
                <input
                  className="input num !pl-7"
                  type="number"
                  min={0}
                  step={key === 'monthly' ? 500 : 1000}
                  value={a[key] ?? ''}
                  placeholder={key === 'goalAmount' ? 'e.g. 5000000' : undefined}
                  onChange={(e) =>
                    up({
                      [key]:
                        e.target.value === '' && key === 'goalAmount'
                          ? undefined
                          : Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </label>
          ))}
        </div>
      ),
    },
  ];
  const last = steps.length - 1;
  if (done)
    return (
      <Recommendation
        data={data}
        answers={a}
        onRestart={() => {
          setDone(false);
          setStep(0);
        }}
      />
    );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={`Step ${step + 1} of ${steps.length}`}
        title={steps[step].title}
        subtitle={steps[step].sub}
      />
      <div className="mb-6">
        <ProgressBar value={(step + 1) / steps.length} height={5} />
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          {steps[step].body}
        </motion.div>
      </AnimatePresence>
      <div className="mt-6 flex items-center justify-between">
        <button className="btn-quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft size={16} /> Back
        </button>
        {step < last ? (
          <button className="btn-primary !px-5" onClick={() => setStep(step + 1)}>
            Continue <ArrowRight size={16} />
          </button>
        ) : (
          <button
            className="btn-primary !px-5"
            onClick={() => {
              setDone(true);
              window.scrollTo({ top: 0 });
            }}
          >
            <Sparkles size={16} /> Show my portfolio
          </button>
        )}
      </div>
      <p className="mt-8 text-center text-xs text-ink-3">
        Your answers stay on this device. Frontier is educational and does not replace a registered financial
        adviser.
      </p>
    </div>
  );
}

function Recommendation({
  data,
  answers,
  onRestart,
}: {
  data: MarketData;
  answers: Answers;
  onRestart: () => void;
}) {
  const nav = useNavigate();
  const settings = useSettings();
  const create = usePortfolios((s) => s.create);
  const profile = scoreProfile(answers);
  const [level, setLevel] = useState<number>(profile.level);
  const cur = answers.market === 'IN' ? 'INR' : 'USD';
  const model: ModelPortfolio | undefined =
    data.snapshot.models.find((m) => m.region === answers.market && m.profile === level) ??
    data.snapshot.models.find((m) => m.region === answers.market);
  const sim = useSimulation(
    useMemo(
      () =>
        model
          ? {
              method: 'gbm' as const,
              mu: model.forward.mu,
              sigma: model.forward.sigma,
              years: Math.max(1, answers.horizon),
              initial: answers.initial,
              monthlyContribution: answers.monthly,
              contributionGrowth: 0.05,
              inflation: cur === 'INR' ? 0.05 : 0.025,
              goal: answers.goalAmount,
              paths: 4000,
              seed: 7,
            }
          : null,
      [model, answers, cur],
    ),
  );
  if (!model) return <Callout tone="warn">No model portfolios are available for this market yet.</Callout>;
  const holdings = [...model.holdings].sort((x, y) => y.weight - x.weight);
  const adopt = () => {
    create({
      name: `${model.profileName} ${answers.market === 'IN' ? 'India' : 'US'} portfolio`,
      currency: cur,
      amount: Math.max(answers.initial, 1),
      holdings: holdings.map((h) => ({ id: h.id, weight: h.weight })),
      origin: 'advisor',
    });
    settings.set({
      profile: {
        score: profile.score,
        level: level as 1 | 2 | 3 | 4 | 5,
        market: answers.market,
        horizon: answers.horizon,
        monthly: answers.monthly,
        initial: answers.initial,
        goal: answers.goalAmount,
        takenAt: Date.now(),
      },
      currency: cur,
    });
    toast.success('Portfolio created', { description: 'Your analysis is ready.' });
    nav('/portfolio');
  };
  const bt = model.backtest;
  const worstMoney = answers.initial * bt.maxDrawdown;
  return (
    <div>
      <PageHeader
        eyebrow="Your recommendation"
        title={
          <>
            You are a <span className="gradient-text">{PROFILE_NAMES[profile.level - 1]}</span> investor
          </>
        }
        subtitle={PROFILE_BLURB[profile.level]}
        right={
          <button className="btn-quiet" onClick={onRestart}>
            <ArrowLeft size={16} /> Retake
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.35fr]">
        <Card className="card-pad">
          <CardHeader title="Why this profile" subtitle={`Risk score ${profile.score}/100`} />
          <ul className="space-y-2 text-[14px] text-ink-2">
            {profile.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {r}
              </li>
            ))}
          </ul>
          {profile.caps.length > 0 && (
            <div className="mt-3">
              <Callout title="A safety cap applied">{profile.caps.join(' ')}</Callout>
            </div>
          )}
          <div className="mt-5">
            <div className="mb-2 text-xs font-medium text-ink-3">Explore other profiles</div>
            <Segmented
              size="sm"
              label="Profile"
              value={level}
              onChange={setLevel}
              options={PROFILE_NAMES.map((n, i) => ({ value: i + 1, label: n }))}
            />
            {level !== profile.level && (
              <p className="mt-2 text-xs text-[var(--warning)]">
                You are viewing a different profile from the one your answers suggest.
              </p>
            )}
          </div>
          <div className="mt-5 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Profile</th>
                  <th className="px-3 py-2 text-right font-medium">Growth assets</th>
                  <th className="px-3 py-2 text-right font-medium">Return/yr</th>
                  <th className="px-3 py-2 text-right font-medium">Worst fall</th>
                </tr>
              </thead>
              <tbody>
                {data.snapshot.models
                  .filter((m) => m.region === answers.market)
                  .map((m) => {
                    const growth = m.holdings.reduce(
                      (s2, h) =>
                        ['equity', 'real-estate', 'crypto'].includes(
                          data.assets.get(h.id)?.meta.assetClass ?? '',
                        )
                          ? s2 + h.weight
                          : s2,
                      0,
                    );
                    return (
                      <tr
                        key={m.id}
                        className={cx(
                          'cursor-pointer border-t border-line transition hover:bg-surface-2',
                          m.profile === level && 'bg-accent-soft',
                        )}
                        onClick={() => setLevel(m.profile)}
                      >
                        <td className="px-3 py-2 font-medium">
                          {m.profileName}
                          {m.profile === profile.level && (
                            <span className="ml-1.5 text-[10px] font-bold text-accent">YOU</span>
                          )}
                        </td>
                        <td className="num px-3 py-2 text-right">{pct(growth, 0)}</td>
                        <td className="num px-3 py-2 text-right">{pct(m.backtest.cagr)}</td>
                        <td className="num px-3 py-2 text-right text-neg">
                          {pct(-m.backtest.maxDrawdown, 0)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            More growth assets have meant higher long-run returns — and deeper falls. Historical figures, not
            forecasts.
          </p>
        </Card>
        <Card className="card-pad">
          <CardHeader
            title={`${model.profileName} portfolio · ${answers.market === 'IN' ? 'India (₹)' : 'United States ($)'}`}
            subtitle={model.summary}
          />
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            <Donut
              size={180}
              slices={holdings.map((h, i) => ({
                key: h.id,
                label: data.assets.get(h.id)?.meta.short ?? h.id,
                value: h.weight,
                color: seriesColor(i),
              }))}
              center={
                <>
                  <div className="text-xs text-ink-3">Start</div>
                  <div className="text-base font-semibold">{compactMoney(answers.initial, cur)}</div>
                </>
              }
            />
            <ul className="w-full min-w-0 flex-1 space-y-2.5">
              {holdings.map((h, i) => {
                const meta = data.assets.get(h.id)?.meta;
                return (
                  <li key={h.id} className="flex gap-3">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: seriesColor(i) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[14px] font-semibold">
                          {meta?.short ?? h.id}{' '}
                          <span className="font-mono text-[11px] font-normal text-ink-3">
                            {meta?.symbol.replace('.NS', '')}
                          </span>
                        </span>
                        <span className="num shrink-0 text-[14px] font-semibold">{pct(h.weight, 0)}</span>
                      </div>
                      <div className="text-xs leading-snug text-ink-3">
                        {meta?.role ? (
                          <>
                            <span className="font-medium text-ink-2">{meta.role}.</span> {meta.description}
                          </>
                        ) : (
                          meta?.description
                        )}
                      </div>
                      <div className="text-xs text-ink-3">
                        {money(answers.initial * h.weight, cur, 0)} now ·{' '}
                        {money(answers.monthly * h.weight, cur, 0)}/month
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={adopt}>
              <PiggyBank size={16} /> Adopt this portfolio
            </button>
            <button className="btn-ghost" onClick={() => nav('/simulate')}>
              Plan my future
            </button>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card className="card-pad">
          <CardHeader
            title="Where this could take you"
            subtitle={`Investing ${money(answers.initial, cur, 0)} now plus ${money(answers.monthly, cur, 0)} a month (rising 5% a year) for ${answers.horizon} years — 4,000 simulated futures, nominal values (not adjusted for inflation).`}
          />
          {sim.data ? (
            <>
              <FanChart
                bands={sim.data.bands}
                invested={sim.data.invested}
                goal={answers.goalAmount}
                format={(v) => compactMoney(v, cur)}
                ariaLabel="Projected portfolio value"
                height={280}
              />
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="text-xs text-ink-3">Typical outcome (median)</div>
                  <div className="text-lg font-semibold">{compactMoney(sim.data.final.p50, cur)}</div>
                  <div className="text-xs text-ink-3">
                    you put in {compactMoney(sim.data.totalInvested, cur)}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="text-xs text-ink-3">Disappointing (1 in 10)</div>
                  <div className="text-lg font-semibold">{compactMoney(sim.data.final.p10, cur)}</div>
                  <div className="text-xs text-ink-3">or worse</div>
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="text-xs text-ink-3">
                    {answers.goalAmount ? 'Chance of reaching goal' : 'Great (1 in 10)'}
                  </div>
                  <div className="text-lg font-semibold">
                    {answers.goalAmount && sim.data.probGoal !== null
                      ? pct(sim.data.probGoal, 0)
                      : compactMoney(sim.data.final.p90, cur)}
                  </div>
                  <div className="text-xs text-ink-3">
                    {answers.goalAmount && sim.data.probGoal !== null ? odds(sim.data.probGoal) : 'or better'}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <Skeleton className="h-[300px]" />
          )}
          <p className="mt-3 text-xs text-ink-3">
            Assumes {pct(model.forward.mu, 1)} average yearly return and {pct(model.forward.sigma, 1)}{' '}
            volatility: the mix's own history, shrunk halfway towards a cautious long-run assumption so a
            lucky decade isn't extrapolated.
          </p>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="card-pad">
            <CardHeader
              title="What could go wrong"
              subtitle="Know this before you invest — it's what makes people quit at the worst time."
            />
            <ul className="space-y-3 text-[14px] text-ink-2">
              <li>
                Since {bt.start.slice(0, 4)}, the deepest fall of this mix was{' '}
                <strong className="text-neg">{pct(-bt.maxDrawdown, 0)}</strong> — on{' '}
                {money(answers.initial, cur, 0)} that is a paper loss of about{' '}
                <strong>{money(worstMoney, cur, 0)}</strong>.
              </li>
              {bt.worstYear && (
                <li>
                  Its worst calendar year was{' '}
                  <strong className="text-neg">{signedPct(bt.worstYear.ret)}</strong> ({bt.worstYear.year});
                  its best was{' '}
                  <strong className="text-pos">{bt.bestYear ? signedPct(bt.bestYear.ret) : '—'}</strong>.
                </li>
              )}
              <li>{explain.explainVolatility(bt.volatility).text}</li>
              <li>
                The future can be worse than the past. Diversification and time reduce risk; they never remove
                it.
              </li>
            </ul>
          </Card>
          <Card className="card-pad">
            <CardHeader title="How to get started" />
            <ol className="list-decimal space-y-2 pl-5 text-[14px] text-ink-2">
              <li>
                Open a{' '}
                {answers.market === 'IN'
                  ? 'demat + trading account with any SEBI-registered broker'
                  : 'brokerage account that offers US ETFs'}
                .
              </li>
              <li>Buy the ETFs above in roughly these proportions — exact percentages don’t matter much.</li>
              <li>
                Set up an automatic monthly investment ({answers.market === 'IN' ? 'a SIP' : 'recurring buy'})
                of {money(answers.monthly, cur, 0)}.
              </li>
              <li>
                Once a year, rebalance back to the target mix. The{' '}
                <a
                  href="#/backtest"
                  onClick={(e) => {
                    e.preventDefault();
                    nav('/backtest');
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  Strategy lab
                </a>{' '}
                shows why.
              </li>
              <li>When markets fall, re-read “What could go wrong” — and don’t panic-sell.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
