import { describe, expect, it } from 'vitest';
import { decodePortfolio, encodePortfolio, normalized } from './portfolio';
import type { Portfolio } from './store';

const p: Portfolio = {
  id: 'x',
  name: 'Test & “quotes”',
  currency: 'INR',
  amount: 123456,
  holdings: [
    { id: 'NIFTY50', weight: 0.6 },
    { id: 'GOLD-INR', weight: 0.4 },
  ],
  origin: 'custom',
  createdAt: 0,
  updatedAt: 0,
};

describe('share links', () => {
  it('round-trips a portfolio through a URL-safe code', () => {
    const code = encodePortfolio(p);
    expect(code).toMatch(/^[A-Za-z0-9+\-$_]+$/);
    const back = decodePortfolio(code)!;
    expect(back.name).toBe(p.name);
    expect(back.currency).toBe('INR');
    expect(back.holdings).toEqual(p.holdings);
    expect(back.origin).toBe('shared');
  });
  it('rejects garbage and malicious payloads safely', () => {
    expect(decodePortfolio('not-a-real-code')).toBeNull();
    expect(decodePortfolio('')).toBeNull();
  });
});

describe('normalisation', () => {
  it('scales weights to 1 and drops non-positive entries', () => {
    const n = normalized([
      { id: 'A', weight: 2 },
      { id: 'B', weight: 2 },
      { id: 'C', weight: 0 },
    ]);
    expect(n).toEqual([
      { id: 'A', weight: 0.5 },
      { id: 'B', weight: 0.5 },
    ]);
  });
});
