import { describe, expect, it } from 'vitest';
import { scoreProfile, type Answers } from './riskProfile';

const base: Answers = {
  goal: 'wealth',
  horizon: 20,
  reaction: 2,
  income: 1,
  experience: 1,
  market: 'IN',
  initial: 100000,
  monthly: 10000,
};

describe('risk profile scoring', () => {
  it('long horizon + calm investor ⇒ growth-oriented profile', () => {
    const r = scoreProfile({ ...base, reaction: 3, experience: 3, income: 0, horizon: 30 });
    expect(r.level).toBe(5);
    expect(r.caps).toHaveLength(0);
  });
  it('is monotone in horizon and loss tolerance', () => {
    const short = scoreProfile({ ...base, horizon: 4 }).score;
    const long = scoreProfile({ ...base, horizon: 25 }).score;
    expect(long).toBeGreaterThan(short);
    const panic = scoreProfile({ ...base, reaction: 1 }).score;
    const brave = scoreProfile({ ...base, reaction: 3 }).score;
    expect(brave).toBeGreaterThan(panic);
  });
  it('applies safety caps regardless of other answers', () => {
    expect(scoreProfile({ ...base, goal: 'emergency', reaction: 3, experience: 3 }).level).toBe(1);
    const soon = scoreProfile({ ...base, horizon: 2, reaction: 3, experience: 3, income: 0 });
    expect(soon.level).toBeLessThanOrEqual(2);
    expect(soon.caps.join(' ')).toMatch(/within 3 years/);
    expect(scoreProfile({ ...base, reaction: 0, experience: 3, horizon: 30 }).level).toBeLessThanOrEqual(2);
  });
});
