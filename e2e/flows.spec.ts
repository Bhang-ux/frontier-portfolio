import { expect, test } from '@playwright/test';
import LZString from 'lz-string';

test.describe('core user journeys', () => {
  test('beginner answers the questionnaire and adopts a portfolio', async ({ page }) => {
    await page.goto('start');
    await page.getByRole('radio', { name: /Retirement/ }).click();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Show my portfolio/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('investor');
    await expect(page.getByText('Where this could take you')).toBeVisible();
    await page.getByRole('button', { name: /Adopt this portfolio/ }).click();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByText('Portfolio health')).toBeVisible();
    await expect(page.getByText('In plain English')).toBeVisible({ timeout: 30_000 });
  });

  test('adds an asset to the portfolio with the picker', async ({ page }) => {
    await page.goto('portfolio');
    await page.getByRole('button', { name: /Add asset/ }).click();
    await page.getByPlaceholder('Type a name or ticker…').fill('Solana');
    await page.getByRole('option', { name: /Solana/ }).click();
    await expect(page.getByLabel('Weight of Solana in percent')).toHaveValue('5');
  });

  test('optimizer draws the efficient frontier and proposes trades', async ({ page }) => {
    await page.goto('optimize');
    await expect(page.getByRole('img', { name: /Efficient frontier/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Result:/)).toBeVisible();
    await page.getByRole('radio', { name: /Risk parity/ }).click();
    await expect(page.getByText('Result: Risk parity')).toBeVisible({ timeout: 30_000 });
  });

  test('command palette navigates to an asset', async ({ page }) => {
    await page.goto('./');
    await page.keyboard.press('Control+K');
    await page.getByPlaceholder(/Search funds/).fill('Defence');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/asset\/DEFENCE/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Motilal Oswal Nifty India Defence Index Fund',
    );
  });

  test('theme toggle switches between dark and light', async ({ page }) => {
    await page.goto('learn');
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
  });

  test('share link imports a portfolio', async ({ page }) => {
    const code = LZString.compressToEncodedURIComponent(
      JSON.stringify({
        n: 'Shared test',
        c: 'USD',
        a: 1000,
        h: [
          ['US-LARGE', 0.7],
          ['GOLD-USD', 0.3],
        ],
      }),
    );
    await page.goto(`portfolio#p=${code}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared test');
    await expect(page.getByLabel('Weight of US Large Caps in percent')).toHaveValue('70');
  });
});
