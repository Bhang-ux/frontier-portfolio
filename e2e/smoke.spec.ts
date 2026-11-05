import { expect, test, type Page } from '@playwright/test';

/** Collect real errors; live-crypto WebSocket failures are expected offline. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const ROUTES: [string, RegExp][] = [
  ['./', /Invest with/],
  ['start', /What are you investing for/],
  ['portfolio', /starter mix/],
  ['optimize', /best mix/],
  ['simulate', /possible/],
  ['backtest', /real history/],
  ['markets', /Every asset/],
  ['asset/NIFTY50', /UTI Nifty 50 Index Fund/],
  ['learn', /explained/],
];

for (const [path, heading] of ROUTES) {
  test(`route ${path} renders without errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
}

test('unknown routes show a friendly 404 inside the app shell', async ({ page }) => {
  await page.goto('does-not-exist');
  await expect(page.getByText('This page wandered off the frontier')).toBeVisible();
});
