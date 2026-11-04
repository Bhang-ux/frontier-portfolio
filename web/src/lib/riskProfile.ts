/**
 * Risk-profile questionnaire scoring.
 *
 * Separates risk *tolerance* (how you feel about losses) from risk
 * *capacity* (how much loss your situation can absorb: horizon, income),
 * as regulators (SEBI, FINRA) require advisers to. The final level takes the
 * score, then applies hard caps — someone who needs the money in two years
 * or would panic-sell is never put in an aggressive portfolio, however
 * "brave" their other answers are.
 */
import { curve } from '@frontier/quant';

export type Goal = 'retirement' | 'wealth' | 'purchase' | 'emergency' | 'learning';

export interface Answers {
  goal: Goal;
  horizon: number; // years
  reaction: 0 | 1 | 2 | 3; // sell all, sell some, hold, buy more
  income: 0 | 1 | 2 | 3; // very stable … not working
  experience: 0 | 1 | 2 | 3; // none … expert
  market: 'IN' | 'US';
  initial: number;
  monthly: number;
  goalAmount?: number;
}

export interface ProfileResult {
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  reasons: string[];
  caps: string[];
}

export const PROFILE_NAMES = ['Conservative', 'Cautious', 'Balanced', 'Growth', 'Aggressive'] as const;

export const PROFILE_BLURB: Record<number, string> = {
  1: 'Protecting what you have matters most. Small, steady gains with shallow dips.',
  2: 'Mostly stability, with a slice of growth to beat inflation.',
  3: 'An even balance of growth and stability — the classic middle road.',
  4: 'Long-term growth first; you can sit through sizeable drops.',
  5: 'Maximum long-term growth; you accept deep, scary drawdowns along the way.',
};

export function scoreProfile(a: Answers): ProfileResult {
  const horizonScore = curve(a.horizon, [
    [1, 0],
    [3, 20],
    [5, 40],
    [10, 70],
    [20, 90],
    [30, 100],
  ]);
  const reactionScore = [0, 35, 70, 100][a.reaction];
  const incomeScore = [100, 75, 40, 15][a.income];
  const expScore = [20, 50, 80, 100][a.experience];
  const score = Math.round(0.35 * horizonScore + 0.35 * reactionScore + 0.15 * incomeScore + 0.15 * expScore);
  let level = (
    score < 25 ? 1 : score < 45 ? 2 : score < 62 ? 3 : score < 80 ? 4 : 5
  ) as ProfileResult['level'];
  const caps: string[] = [];
  const cap = (max: number, why: string) => {
    if (level > max) {
      level = max as ProfileResult['level'];
      caps.push(why);
    }
  };
  if (a.goal === 'emergency')
    cap(1, 'An emergency fund must be there when you need it, so it stays in the safest mix.');
  if (a.horizon < 3) cap(2, 'You need the money within 3 years — too soon to ride out a stock-market fall.');
  if (a.reaction === 0)
    cap(2, 'You said you would sell after a 25% drop. A calmer mix makes that less likely to happen.');
  if (a.goal === 'purchase' && a.horizon < 6)
    cap(3, 'A big purchase within ~5 years calls for a balanced mix at most.');
  if (a.income === 3) cap(3, 'Without a steady income, you have less capacity to absorb losses.');
  const reasons = [
    `Time horizon of ${a.horizon} year${a.horizon === 1 ? '' : 's'} (${horizonScore >= 70 ? 'long — time to recover from falls' : horizonScore >= 40 ? 'medium' : 'short'}).`,
    [
      'You would sell everything in a crash — low tolerance for losses.',
      'You would sell some in a crash — moderate tolerance.',
      'You would hold through a crash — good tolerance.',
      'You would buy more in a crash — high tolerance.',
    ][a.reaction],
    [
      'Very stable income adds capacity to take risk.',
      'Stable income.',
      'Variable income reduces your capacity for risk.',
      'No regular income reduces your capacity for risk.',
    ][a.income],
  ];
  return { score, level, name: PROFILE_NAMES[level - 1], reasons, caps };
}
