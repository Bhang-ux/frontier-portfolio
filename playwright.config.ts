import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the *production build* (vite preview), so
 * they exercise the real bundle, service worker registration, the analytics
 * Web Worker and the static data API exactly as GitHub Pages serves them.
 * CI builds with synthetic data first (no network needed).
 */
const base = process.env.E2E_BASE_URL ?? 'http://localhost:4173/frontier-portfolio/';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: base,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /smoke/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run preview -w web', url: base, reuseExistingServer: true, timeout: 60_000 },
});
