<div align="center">

<img src="web/public/favicon.svg" width="72" alt="Frontier logo" />

# Frontier — Portfolio Intelligence

**A quant-grade portfolio manager & optimizer that explains itself in plain English.**
Live market data · autonomous refresh · runs entirely in your browser · zero servers, zero cost.

[**▶ Open the live app**](https://bhang-ux.github.io/frontier-portfolio/) ·
[Interview guide (PDF)](docs/Interview_Guide.pdf) ·
[How it works](#how-it-works)

[![Data refresh & deploy](https://github.com/Bhang-ux/frontier-portfolio/actions/workflows/deploy.yml/badge.svg)](https://github.com/Bhang-ux/frontier-portfolio/actions/workflows/deploy.yml)
[![CI](https://github.com/Bhang-ux/frontier-portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/Bhang-ux/frontier-portfolio/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Bhang-ux/frontier-portfolio/actions/workflows/codeql.yml/badge.svg)](https://github.com/Bhang-ux/frontier-portfolio/actions/workflows/codeql.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<img src="docs/screenshots/today.jpg" alt="Frontier — Today dashboard" width="100%" />

</div>

---

## What it does

Frontier gives a complete beginner the toolkit of a quant desk — and tells them, in plain language, **what to invest in and why**.

|                        |                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🧭 **Get started**     | 7 questions → a risk profile that separates _tolerance_ from _capacity_ (with safety caps) → a forecast-free model portfolio of real, low-cost index funds (India ₹ or US $), a Monte Carlo projection of _your_ SIP, and “what could go wrong” in real money.                                                                                                                                                                        |
| 📊 **My portfolio**    | Health score (A–F) with concrete fixes · annual return, volatility, Sharpe, drawdowns, VaR/CVaR, beta, effective number of bets — each with a one-sentence explanation · money-vs-risk decomposition · HRP-ordered correlation heatmap · return distribution with fat-tail check · rolling statistics · monthly-returns calendar · historical crisis replays (GFC → 2025 tariff shock) · what-if shocks · multi-factor exposures.     |
| 🎯 **Optimizer**       | Max Sharpe, min variance, risk parity, HRP, max diversification, min CVaR, target return/risk, equal weight · per-asset & asset-class guard-rails · Ledoit–Wolf / EWMA / RMT-denoised risk models · Bayes–Stein, CAPM, EWMA or equilibrium returns · **Black–Litterman views** · interactive efficient frontier (click to pick a portfolio) · reasons for every change · executable trade list · **walk-forward out-of-sample test**. |
| 🔮 **Future planner**  | Monte Carlo with history bootstrap (stationary block), normal or fat-tailed returns; SIP step-ups, fees, inflation (real vs nominal), retirement withdrawals; probability of reaching your goal, of loss, of running out.                                                                                                                                                                                                             |
| 🧪 **Strategy lab**    | Rebalancing rules compared after costs; a walk-forward tournament of allocation methods on your own holdings.                                                                                                                                                                                                                                                                                                                         |
| 🌍 **Today & Markets** | Plain-English market briefing, live crypto & gold stream, HMM market regimes (calm vs turbulent), a transparent Market Mood gauge, breadth, an India-first market map (size, sectors, strategies), cross-asset scoreboard and a 45-instrument screener with trend & momentum scores.                                                                                                                                                  |

Every chart is accessible (keyboard crosshair, table view, colour-blind-safe validated palette) and works in light and dark themes, on desktop and mobile. **Beginner / Pro** mode switches between explanations and density.

<p>
<img src="docs/screenshots/optimizer.jpg" width="49%" alt="Optimizer with efficient frontier" />
<img src="docs/screenshots/portfolio.jpg" width="49%" alt="Portfolio analytics" />
</p>
<p>
<img src="docs/screenshots/advisor.jpg" width="49%" alt="Beginner advisor" />
<img src="docs/screenshots/planner.jpg" width="49%" alt="Monte Carlo planner" />
</p>

## How it works

```mermaid
flowchart LR
  subgraph GH["GitHub Actions (cron: hourly weekdays, 4-hourly weekends)"]
    A[Acquire<br/>AMFI · FRED · ECB · Binance · Fama–French<br/>NAVAll delta check · backoff] --> B[Clean & derive<br/>split repair · spike filter<br/>chain-link splices · bond model]
    B --> C[Analyse with @frontier/quant<br/>stats · signals · HMM regimes<br/>mood · model portfolios]
    C --> D{Validation gate<br/>zod schema · coverage<br/>freshness · sanity}
    D -- pass --> E[Publish static JSON<br/>content-hashed]
    D -- fail --> X[Abort: live site keeps<br/>last good data]
    P[(Previous deploy)] -. per-instrument fallback .-> A
  end
  E --> F[(GitHub Pages CDN<br/>app + data API)]
  F --> G[Browser<br/>React 19 SPA]
  G -->|poll manifest every 2 min| F
  G --> W[Web Worker<br/>same @frontier/quant engine<br/>optimise · simulate · backtest]
  G -. WebSocket .-> L[Binance public stream<br/>live crypto]
```

- **Incremental ETL, static API — and the CDN is the database.** Each run reads AMFI's one-file NAV list and appends today's NAV to every fund history already on the live site (full histories are refetched only when a NAV could have been missed, and weekly). Output is JSON on the same CDN as the app; the browser polls a ~4 KB manifest and only downloads files whose content hash changed.
- **One quant engine, two runtimes.** `packages/quant` is pure TypeScript with zero runtime dependencies. The pipeline (Node) and the app (Web Worker) run _the same code_, so a number on the dashboard can never disagree with the analysis page.
- **Your data stays yours.** Portfolios live in `localStorage`; sharing encodes a portfolio into the URL hash. No accounts, no tracking, no backend.
- **Fails safe.** Upstream flake → previous copy of that instrument; schema/freshness failure → no deploy; site → still the last good build.

### Data sources — only those that permit automated use

The first live run taught the most important lesson of the project: **Yahoo Finance returned HTTP 429 for every symbol from GitHub's servers, and its terms prohibit automated access.** The validation gate correctly refused to publish, and instead of disguising the client as a browser, Frontier identifies itself honestly and uses only sources that allow programmatic access and republication. FRED's S&P 500, Dow and Nasdaq series are tagged _"Copyrighted: Pre-Approval Required"_, so they are not republished either.

| Source                                                                                     | Used for                                                                                                                                                                  | Cadence             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| [AMFI](https://www.amfiindia.com/) NAVAll + [mfapi.in](https://www.mfapi.in/)              | 26 Indian Direct–Growth funds: Nifty 50 / Next 50 / 500, mid & small caps, 9 sectors, 5 smart-beta strategies, S&P 500 & Nasdaq-100 (₹), gold, silver, gilts, bonds, cash | daily (evening IST) |
| [FRED](https://fred.stlouisfed.org/) (public domain)                                       | Treasury yields → modelled 2/10/30-year total-return indices, T-bills, USD/INR history, broad dollar index, Brent                                                         | daily               |
| FRED · CBOE (citation)                                                                     | VIX                                                                                                                                                                       | daily               |
| [ECB](https://www.ecb.europa.eu/) via [Frankfurter](https://frankfurter.dev/)              | latest USD/INR (FRED's H.10 series lags a week)                                                                                                                           | daily               |
| [Binance public data](https://data-api.binance.vision)                                     | Bitcoin, Ethereum, Solana, PAX Gold (dollar gold) — daily, 5-minute and live WebSocket                                                                                    | continuous          |
| [Kenneth R. French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/) | US market history before the S&P 500 fund launched (2020); size, value and momentum factors                                                                               | monthly             |

Techniques this forced: **chain-linked backfills** (Regular-plan NAVs before 2013, Fama–French returns before 2020), **constant-maturity Treasury indices modelled from public yields** (carry + exact repricing), **USD views of INR funds** (NAV ÷ USD/INR, rebased), **unit-split repair** for re-denominated ETF NAVs, and a **realised-volatility mood component** for India (India VIX is licensed). Every asset page states where its numbers come from.

### The quant engine (`packages/quant`)

| Area             | Implementation                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linear algebra   | Cholesky with jitter fallback, cyclic Jacobi eigen-decomposition, nearest-PSD repair                                                                                                                                                 |
| Risk models      | Sample, EWMA (RiskMetrics), **Ledoit–Wolf** (identity & constant-correlation), Marchenko–Pastur denoising                                                                                                                            |
| Expected returns | Historical, EWMA, CAPM, **Bayes–Stein** (Jorion 1986), equilibrium, **Black–Litterman** (He–Litterman & Idzorek Ω)                                                                                                                   |
| Optimisation     | Monotone FISTA over **exact** capped-simplex and disjoint-group projections; frontier tracing; tangency by golden-section along the λ-path; risk parity (Spinu CCD); **HRP** (López de Prado); smoothed Rockafellar–Uryasev **CVaR** |
| Simulation       | GBM (exact moment matching), Student-t, **stationary block bootstrap**; contributions, fees, inflation, withdrawals                                                                                                                  |
| Evaluation       | Rebalancing backtests with costs, **walk-forward** out-of-sample tests                                                                                                                                                               |
| Market structure | **Gaussian HMM** (Baum–Welch, Viterbi, filtered probabilities), factor regressions, stress tests with proxies                                                                                                                        |
| Explainability   | Deterministic natural-language generation for every metric                                                                                                                                                                           |

Validated by **golden tests** against scikit-learn, PyPortfolioOpt, CVXPY (Clarabel/HiGHS) and SciPy — exact to 1e-12 where the algorithm is deterministic. CI re-derives the fixtures in Python on every push.

## Engineering decisions (short version)

| Decision                                     | Why                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GitHub Pages + Actions                       | Truly free, permanent, CDN-backed, no cold starts; the scheduler, CI and hosting live next to the code.                    |
| Static data API instead of a server          | Nothing to scale, patch or pay for; reads are CDN hits; content hashes give perfect cache behaviour.                       |
| TypeScript quant engine (not Python/Pyodide) | Same code in pipeline and browser, ~40 KB instead of a 10 MB runtime, unit-tested once; Python is kept for _verification_. |
| First-order solver instead of a QP library   | Exact projections make FISTA simple, dependency-free and fast; verified against interior-point solvers.                    |
| Forecast-free model portfolios               | Expected returns are the noisiest input; beginners get allocation by risk budget, not last decade's winners.               |
| Web Worker + React Query                     | Heavy maths off the main thread; worker calls are cached and de-duplicated like network requests.                          |

The full reasoning, trade-offs and 20 interview questions are in [`docs/Interview_Guide.pdf`](docs/Interview_Guide.pdf).

## Run it locally

```bash
npm ci
npm run data:synthetic   # offline demo dataset (clearly flagged in the UI)
npm run dev              # http://localhost:5173/frontier-portfolio/
```

With internet access, `npm run data` fetches **live** data instead (`--full-refresh` refetches every history; `node tools/data-report.mjs` prints a per-instrument coverage report).

```bash
npm run verify           # typecheck + lint + all unit/golden/pipeline tests
npm run build && npx playwright test   # production build + end-to-end tests
python tools/reference/generate_fixtures.py   # regenerate golden fixtures (needs tools/reference/requirements.txt)
npm run guide            # rebuild docs/Interview_Guide.pdf
```

## Project layout

```
packages/quant       zero-dependency quant engine (+ golden & unit tests)
packages/contracts   typed data contracts + history codec shared by pipeline & web
pipeline             scheduled ETL: sources, analytics, validation, publishing
web                  React 19 + Vite 7 + Tailwind 4 app, Web Worker, charts
e2e                  Playwright journeys (desktop + mobile)
tools                Python reference generator, screenshot tool, source probe, data report
.github/workflows    CI · data refresh & deploy · CodeQL · screenshots · keepalive · pipeline dry run
docs                 interview guide (PDF + generator), screenshots
```

## Testing

- **97 unit & golden tests** (Vitest): numerical kernels, every optimiser objective vs CVXPY, Ledoit–Wolf vs scikit-learn, HRP & Black–Litterman vs PyPortfolioOpt, Monte Carlo vs closed forms, HMM regime recovery, every source adapter on recorded-format fixtures (AMFI, NAVAll, FRED, ECB, Binance, a ZIP built in-test for Fama–French), unit-split repair, chain-link splicing, the Treasury model against duration, the validation gate, the risk questionnaire.
- **26 end-to-end tests** (Playwright, desktop + mobile): every route, the full beginner journey, optimiser, command palette, theme, share links.
- **Live smoke test** after each deploy: the CDN serves the manifest just built and deep links return 200.

## Disclaimer

Frontier is an educational project. It is **not** investment, tax or legal advice, and nothing in it is a recommendation to buy or sell any security. Market data may be delayed or inaccurate. Past performance does not guarantee future results.

## License

[MIT](LICENSE)
