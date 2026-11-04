/* eslint-disable */
// Content of the Frontier interview guide. Rendered to PDF by build.mjs.
import { QUESTIONS, RAPID } from './questions.mjs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─── diagrams (inline SVG) ──────────────────────────────────────────────────
const box = (x, y, w, h, title, lines = [], fill = '#ffffff', stroke = '#cfd4e2', titleColor = '#0f1320') => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
  <text x="${x + 9}" y="${y + 17}" font-size="10.5" font-weight="650" fill="${titleColor}">${title}</text>
  ${lines.map((l, i) => `<text x="${x + 9}" y="${y + 32 + i * 12.5}" font-size="8.6" fill="#3c4456">${l}</text>`).join('')}`;
const arrow = (x1, y1, x2, y2, label = '', dashed = false, color = '#4f46e5') => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#ah)"/>
  ${label ? `<text x="${mx}" y="${my - 4}" font-size="8" fill="#6a7285" text-anchor="middle">${label}</text>` : ''}`;
};
const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4f46e5"/></marker></defs>`;

const architectureSvg = `
<svg viewBox="0 0 700 430" width="100%" xmlns="http://www.w3.org/2000/svg">${defs}
  <rect x="8" y="8" width="214" height="414" rx="10" fill="#f4f6fa" stroke="#e3e6ee"/>
  <text x="20" y="28" font-size="11" font-weight="700" fill="#4f46e5">GitHub Actions · scheduled ETL</text>
  ${box(20, 40, 190, 50, '1 · Acquire', ['Yahoo v8 chart API · FRED CSV', 'retries · crumb fallback · 4-way pool'])}
  ${box(20, 100, 190, 50, '2 · Clean', ['exchange-local dates · dedupe', 'spike filter · split/div adjusted'])}
  ${box(20, 160, 190, 63, '3 · Analyse (@frontier/quant)', ['stats · signals · HMM regimes', 'Market Mood · breadth', 'model portfolios (ERC sleeves)'])}
  ${box(20, 233, 190, 50, '4 · Validation gate', ['zod schema · coverage ≥ 85%', 'freshness · sanity · core ids'], '#fff7ed', '#f5c28b')}
  ${box(20, 293, 190, 50, '5 · Publish static JSON', ['manifest · snapshot · history/*', 'content hashes (FNV-1a)'])}
  ${box(20, 353, 190, 56, '6 · Build · Deploy · Smoke', ['vite build → Pages artifact', 'deploy-pages · curl live CDN'])}
  ${arrow(115, 90, 115, 100)}${arrow(115, 150, 115, 160)}${arrow(115, 223, 115, 233)}${arrow(115, 283, 115, 293)}${arrow(115, 343, 115, 353)}
  <rect x="250" y="120" width="190" height="190" rx="10" fill="#eef2ff" stroke="#c7d2fe"/>
  <text x="262" y="140" font-size="11" font-weight="700" fill="#4f46e5">GitHub Pages CDN</text>
  ${box(262, 150, 166, 46, 'App shell (Vite build)', ['~220 KB gzip initial · route chunks', 'index.html per route + 404.html'])}
  ${box(262, 204, 166, 46, 'data/manifest.json', ['~9 KB · polled every 120 s', 'points to hashed files'])}
  ${box(262, 258, 166, 44, 'snapshot.json · history/*.json', ['86 KB gz · ~19 KB gz / instrument'])}
  ${arrow(210, 380, 300, 302, 'upload-pages-artifact')}
  <rect x="470" y="40" width="222" height="370" rx="10" fill="#f0fdfa" stroke="#99f6e4"/>
  <text x="482" y="60" font-size="11" font-weight="700" fill="#0d9488">User's browser</text>
  ${box(482, 72, 198, 76, 'React 19 UI (main thread)', ['React Router · Zustand (localStorage)', 'React Query: manifest poll, hashed', 'fetches · custom SVG charts'])}
  ${box(482, 158, 198, 63, 'Web Worker (Comlink RPC)', ['same @frontier/quant engine', 'optimise · simulate · backtest', 'results cached by input fingerprint'])}
  ${box(482, 231, 198, 50, 'Service worker (Workbox)', ['manifest: NetworkFirst (4 s)', 'hashed data: CacheFirst (7 d)'])}
  ${box(482, 291, 198, 50, 'localStorage', ['portfolios · settings · watchlist', 'never leaves the device'])}
  ${box(482, 351, 198, 46, 'Share links', ['lz-string(portfolio) in #hash', 'no upload, validated on import'])}
  ${arrow(440, 226, 482, 110, 'HTTPS GET')}
  ${arrow(581, 148, 581, 158)}
  <rect x="250" y="355" width="190" height="55" rx="10" fill="#fff" stroke="#e3e6ee"/>
  <text x="262" y="374" font-size="10.5" font-weight="650" fill="#0f1320">Binance public WebSocket</text>
  <text x="262" y="389" font-size="8.6" fill="#3c4456">live BTC/ETH/SOL ticks · backoff</text>
  <text x="262" y="401" font-size="8.6" fill="#3c4456">pauses when the tab is hidden</text>
  ${arrow(440, 382, 482, 330, '', true, '#0d9488')}
  <text x="238" y="60" font-size="8.6" fill="#6a7285">Yahoo Finance ·</text><text x="238" y="72" font-size="8.6" fill="#6a7285">FRED (OECD/US)</text>
  ${arrow(232, 66, 212, 66, '', true)}
  <line x1="300" y1="120" x2="212" y2="78" stroke="#9aa3b8" stroke-width="1.2" stroke-dasharray="3 3"/>
  <text x="262" y="112" font-size="8" fill="#6a7285">previous deploy = per-asset fallback</text>
</svg>`;

const timelineSvg = (() => {
  const steps = [
    ['cron fires (:17)', 'queue delay 0–15 min'],
    ['runner + npm ci', '~40 s'],
    ['fetch ~100 instruments', '~60–120 s · 4 in flight'],
    ['analyse + validate', '~3–6 s'],
    ['vite build', '~15 s'],
    ['Pages deploy', '~30–60 s'],
    ['smoke test', 'live manifest hash match'],
    ['browser picks it up', '≤ 120 s poll + ≤ 600 s CDN'],
  ];
  const w = 83;
  const y0 = 62;
  return `<svg viewBox="0 0 700 140" width="100%" xmlns="http://www.w3.org/2000/svg">
  <line x1="18" y1="${y0}" x2="690" y2="${y0}" stroke="#cfd4e2" stroke-width="2"/>
  ${steps
    .map(([t, d], i) => {
      const x = 60 + i * w;
      const up = i % 2 === 0;
      const ty = up ? y0 - 30 : y0 + 26;
      return `<circle cx="${x}" cy="${y0}" r="6" fill="${i === steps.length - 1 ? '#0d9488' : '#4f46e5'}"/>
      <line x1="${x}" y1="${up ? y0 - 20 : y0 + 8}" x2="${x}" y2="${up ? y0 - 8 : y0 + 14}" stroke="#cfd4e2"/>
      <text x="${x}" y="${ty}" font-size="9" font-weight="650" fill="#0f1320" text-anchor="middle">${t}</text>
      <text x="${x}" y="${ty + 12}" font-size="8" fill="#6a7285" text-anchor="middle">${d}</text>`;
    })
    .join('')}
  <text x="18" y="132" font-size="8.6" fill="#3c4456">Typical source → screen latency ≈ 4–8 minutes after the cron starts; worst case ≈ queue delay + 10 minutes of CDN cache.</text>
</svg>`;
})();

const pyramidSvg = `
<svg viewBox="0 0 700 200" width="100%" xmlns="http://www.w3.org/2000/svg">
  <polygon points="350,12 430,62 270,62" fill="#c7d2fe"/>
  <text x="350" y="50" font-size="9.5" font-weight="650" text-anchor="middle" fill="#312e81">Live smoke</text>
  <polygon points="270,66 430,66 490,104 210,104" fill="#a5b4fc"/>
  <text x="350" y="90" font-size="9.5" font-weight="650" text-anchor="middle" fill="#1e1b4b">26 E2E (Playwright · desktop + mobile)</text>
  <polygon points="210,108 490,108 550,146 150,146" fill="#818cf8"/>
  <text x="350" y="132" font-size="9.5" font-weight="650" text-anchor="middle" fill="#fff">19 golden tests vs scikit-learn · PyPortfolioOpt · CVXPY</text>
  <polygon points="150,150 550,150 610,188 90,188" fill="#4f46e5"/>
  <text x="350" y="174" font-size="9.5" font-weight="650" text-anchor="middle" fill="#fff">68 unit tests · quant engine, pipeline parsers, validation, web logic</text>
  <text x="615" y="60" font-size="8.6" fill="#6a7285">every deploy</text>
  <text x="560" y="100" font-size="8.6" fill="#6a7285">every push (CI)</text>
  <text x="600" y="140" font-size="8.6" fill="#6a7285">+ fixtures re-derived</text>
  <text x="626" y="152" font-size="8.6" fill="#6a7285">in Python on CI</text>
</svg>`;

// ─── sections ──────────────────────────────────────────────────────────────
const cover = (s) => `
<section class="cover">
  <div class="band">
    <div class="eyebrow">Interview guide · system design dossier</div>
    <h1>Frontier — Portfolio Intelligence</h1>
    <div class="sub">A quant-grade portfolio manager &amp; optimiser that explains itself in plain English. This guide documents the architecture, every major engineering trade-off, and the 20 hardest questions an interviewer will ask about it — with answers.</div>
  </div>
  <div class="box accent" style="margin:0 6mm">
    <h4>What's inside</h4>
    <ul style="margin:0">
      <li><b>Architecture</b> — a stateless scheduled ETL, a content-hashed static data API and a browser-side quant engine, with diagrams you can redraw on a whiteboard.</li>
      <li><b>21 engineering trade-offs</b> — each with the rejected alternative and the cost accepted.</li>
      <li><b>The algorithms</b> — FISTA with exact projections, Ledoit–Wolf, Bayes–Stein, Black–Litterman, HRP, risk parity, CVaR, HMM regimes, block bootstrap.</li>
      <li><b>Quality evidence</b> — golden tests against scikit-learn, PyPortfolioOpt and CVXPY, and the real bugs they caught.</li>
      <li><b>20 brutal interview questions</b> with model answers and follow-ups, a rapid-fire round and the numbers to memorise.</li>
    </ul>
  </div>
  <div>
    <div class="grid3" style="margin-bottom:6mm">
      <div class="kpi"><div class="v">${s.total.toLocaleString()}</div><div class="l">non-blank lines across TS · TSX · CSS · YAML · Python</div></div>
      <div class="kpi"><div class="v">113 tests</div><div class="l">87 unit &amp; golden (Vitest) + 26 end-to-end (Playwright)</div></div>
      <div class="kpi"><div class="v">$0 / month</div><div class="l">GitHub Pages + Actions; no servers, no database</div></div>
    </div>
    <div class="meta">
      <div><b>Live app:</b> https://bhang-ux.github.io/frontier-portfolio/</div>
      <div><b>Source:</b> https://github.com/Bhang-ux/frontier-portfolio</div>
      <div><b>Generated:</b> ${s.date} · commit ${s.commit} · by <code>docs/interview-guide/build.mjs</code></div>
    </div>
  </div>
</section>`;

const toc = () => `
<h1 class="section" id="contents" style="page-break-before:avoid;break-before:auto">Contents</h1>
<ol class="toc" style="list-style:none;padding:0">
  <li><a href="#s1"><span class="n">1</span>Executive summary &amp; how to pitch it</a></li>
  <li><a href="#s2"><span class="n">2</span>System architecture</a></li>
  <li><a href="#s3"><span class="n">3</span>Engineering trade-offs — every major decision</a></li>
  <li><a href="#s4"><span class="n">4</span>The quant engine: algorithms you must be able to explain</a></li>
  <li><a href="#s5"><span class="n">5</span>Quality strategy: how the maths is proven right</a></li>
  <li><a href="#s6"><span class="n">6</span>20 brutal interview questions — with model answers</a></li>
  <li><a href="#s7"><span class="n">7</span>Rapid-fire round, numbers to memorise, honest limitations</a></li>
</ol>
<div class="box accent">
  <h4>How to use this guide</h4>
  <p>Read §1 until you can deliver the 30-second and 2-minute pitches without notes. Know the diagram in §2.1 well enough to redraw it on a whiteboard. For each trade-off in §3, be ready to argue <i>both</i> sides — interviewers push on the option you rejected. The answers in §6 are deliberately long: absorb the structure (claim → mechanism → evidence → limitation), then answer in your own words. Every number quoted is real and comes from this repository.</p>
</div>`;

const summary = (s) => `
<h1 class="section" id="s1"><span class="num">1</span>Executive summary &amp; how to pitch it</h1>
<p class="lead">Frontier is a portfolio manager and optimiser for complete beginners that is built like a professional quant system. It pulls live market data on a schedule, runs institutional-grade analytics (shrinkage covariance, efficient frontiers, risk parity, HRP, Black–Litterman, CVaR, Monte Carlo, regime detection) and translates every number into a plain-English sentence — with no servers, no database and no running cost.</p>
<h2>The 30-second pitch</h2>
<div class="box accent"><p>“I built a free, always-on portfolio optimiser. A GitHub Actions cron job pulls prices for about a hundred US and Indian instruments every hour, analyses them with a TypeScript quant engine I wrote and verified against scikit-learn and CVXPY, and publishes static JSON to GitHub Pages. The browser runs the <i>same</i> engine in a Web Worker, so users can optimise and simulate their own portfolios instantly and privately — and every metric comes with a sentence a beginner understands.”</p></div>
<h2>The 2-minute version (structure)</h2>
<ol>
  <li><b>Problem.</b> Beginners get either toy calculators or professional tools they can't read. The hard part isn't the maths — it's estimation error and explanation.</li>
  <li><b>Architecture.</b> Stateless scheduled ETL → validation gate → content-hashed static API on a CDN → React SPA → Web Worker. Zero servers; the CDN is effectively the database and the cron is the backend.</li>
  <li><b>Quant core.</b> ${s.quant.toLocaleString()} lines, zero runtime dependencies: projected FISTA over exact constraint projections; Ledoit–Wolf and Bayes–Stein shrinkage; HRP; Black–Litterman; smoothed CVaR; Gaussian HMM; stationary bootstrap. Golden tests reproduce Python reference libraries to 1e-12.</li>
  <li><b>Beginner layer.</b> Risk questionnaire separating tolerance from capacity with hard safety caps; forecast-free model portfolios (risk budgeting within sleeves); deterministic natural-language explanations — no LLM, so explanations can never invent a number.</li>
  <li><b>Engineering quality.</b> 113 automated tests, CI that re-derives fixtures in Python, a validation gate that prevents bad data from ever shipping, post-deploy smoke tests, keepalive for the 60-day cron rule, CodeQL and Dependabot.</li>
</ol>
<h2>Key facts</h2>
<table>
  <tr><th>Dimension</th><th>Value</th><th>Where it lives</th></tr>
  <tr><td>Universe</td><td>98 fetched instruments + 2 constructed cash indices (US &amp; India)</td><td><code>pipeline/src/universe.ts</code></td></tr>
  <tr><td>Refresh cadence</td><td>Hourly at :17 Mon–Fri (UTC); every 4 h at :47 Sat–Sun</td><td><code>.github/workflows/deploy.yml</code></td></tr>
  <tr><td>History depth</td><td>Daily since 2005-01-01, dividend &amp; split adjusted</td><td><code>pipeline/src/acquire.ts</code></td></tr>
  <tr><td>Payloads</td><td>manifest ~9 KB; snapshot ~86 KB gzip; ~19 KB gzip per instrument history</td><td><code>packages/contracts</code></td></tr>
  <tr><td>Front-end</td><td>~220 KB gzip initial (JS+CSS), worker 24 KB, routes 4–10 KB each</td><td><code>web/vite.config.ts</code></td></tr>
  <tr><td>Code size</td><td>quant ${s.quant.toLocaleString()} · pipeline+contracts ${s.pipeline.toLocaleString()} · web ${s.web.toLocaleString()} · tests ${s.tests.toLocaleString()} lines</td><td>monorepo, npm workspaces</td></tr>
  <tr><td>Optimiser speed</td><td>Max-Sharpe ≈ 9 ms for 6 assets; 20-year quarterly walk-forward ≈ 1 s</td><td><code>packages/quant/src/optimize</code></td></tr>
</table>`;

const architecture = () => `
<h1 class="section" id="s2"><span class="num">2</span>System architecture</h1>
<h2 id="s2-1">2.1 The big picture</h2>
<figure>${architectureSvg}<figcaption>Figure 1 — Three runtimes, one engine. The scheduled job and the browser execute the same <code>@frontier/quant</code> package.</figcaption></figure>
<p>The design principle is <b>“move computation to where it is cheapest and safest”</b>. Anything shared by all users (fetching, cleaning, market-wide statistics, regimes, model portfolios) is computed once per hour in CI and published as static files. Anything specific to one user (their portfolio's risk, optimisation, simulations) is computed on their own device, which keeps their data private and makes the system's cost independent of the number of users.</p>
<h2>2.2 Repository &amp; component inventory</h2>
<table>
  <tr><th>Package</th><th>Responsibility</th><th>Key dependencies</th></tr>
  <tr><td><code>packages/quant</code></td><td>Numerical engine: linear algebra, statistics, covariance &amp; return estimators, optimisers, Monte Carlo, backtests, HMM, factors, stress tests, health score, natural-language explanations.</td><td>none (by design)</td></tr>
  <tr><td><code>packages/contracts</code></td><td>TypeScript types for every published JSON document + the history codec and content hash. The single source of truth for the pipeline ⇄ web interface.</td><td>none</td></tr>
  <tr><td><code>pipeline</code></td><td>Scheduled ETL: universe definition, HTTP layer (retry/backoff/limiter), Yahoo &amp; FRED clients, previous-deploy fallback, analytics stage, validation gate, publisher.</td><td>zod, quant, contracts</td></tr>
  <tr><td><code>web</code></td><td>React 19 SPA: app shell, nine pages, chart library, Comlink worker, state stores, live WebSocket feed, PWA config, post-build route generation.</td><td>React, React Router, React Query, Zustand, d3-scale/shape, Radix, motion</td></tr>
  <tr><td><code>e2e</code>, <code>tools</code></td><td>Playwright journeys; Python reference generator for golden fixtures; README screenshot tool.</td><td>Playwright; NumPy, SciPy, scikit-learn, CVXPY, PyPortfolioOpt</td></tr>
</table>
<h2>2.3 Lifecycle of a refresh</h2>
<figure>${timelineSvg}<figcaption>Figure 2 — From cron trigger to pixels.</figcaption></figure>
<ol>
  <li><b>Acquire</b> (<code>pipeline/src/acquire.ts</code>). For each of 98 symbols, the Yahoo v8 chart endpoint is called with <code>period1</code> = 2005-01-01 through a 4-slot concurrency limiter. Hosts alternate between query1/query2. 429 and 5xx responses are retried up to 4 times with exponential backoff and full jitter, honouring <code>Retry-After</code>. A 401/403 triggers a one-time cookie + crumb handshake (the yfinance technique). If a symbol still fails, its history is fetched from the <i>currently deployed site</i> instead; only then is it recorded as a failure. Risk-free rates come from <code>^IRX</code> (US) and FRED's OECD India 3-month rate, and constructed cash indices accrue those rates daily.</li>
  <li><b>Clean</b> (<code>sources/yahoo.ts</code>). Timestamps are converted to <i>exchange-local</i> calendar days using the response's <code>gmtoffset</code>; nulls are dropped; duplicates resolve to the latest print; one-day spikes of more than 40 % that fully revert the next day are removed as bad prints.</li>
  <li><b>Analyse</b> (<code>pipeline/src/build/*</code>). Per asset: trailing returns on calendar windows, risk statistics on 1/3/5-year windows with the calendar's empirical periods-per-year, weekly-return betas, technical indicators and a composite trend score ranked within peer groups. Per market: a two-state HMM regime, a six-component Market Mood score, breadth and a headline sentence. Ten model portfolios (5 profiles × 2 markets) are built and backtested.</li>
  <li><b>Validate</b> (<code>pipeline/src/validate.ts</code>). zod schema; all core instruments present; ≥ 85 % coverage; SPY's last bar ≤ 6 days old; finite, positive prices; ≥ 6 model portfolios. Failure exits non-zero: <b>nothing is deployed and the last good site keeps serving</b>.</li>
  <li><b>Publish &amp; deploy</b>. One JSON file per instrument plus snapshot, intraday and manifest; Vite builds the app; <code>actions/deploy-pages</code> publishes atomically; a smoke job polls the live manifest until its <code>generatedAt</code> equals the one just built and checks that deep links return 200.</li>
  <li><b>Consume</b>. Open tabs poll the manifest every 120 s; when the snapshot hash changes, React Query fetches the new snapshot and a toast announces fresh data. Unchanged histories are never re-downloaded.</li>
</ol>
<h2>2.4 The static data API</h2>
<table>
  <tr><th>Document</th><th>Contents</th><th>Caching strategy</th></tr>
  <tr><td><code>data/manifest.json</code></td><td>Schema version, generation time, synthetic flag, snapshot hash &amp; size, per-instrument history hash/end date/points, pipeline stats (duration, sources, failures, run id, commit).</td><td><code>fetch(…, {cache: 'no-cache'})</code> → revalidates every poll; service worker NetworkFirst with a 4 s timeout so the app still opens offline.</td></tr>
  <tr><td><code>data/snapshot.json?v=&lt;hash&gt;</code></td><td>All instruments' quotes, statistics, signals, summaries and sparklines; markets (regimes, mood, breadth); model portfolios; FX; risk-free rates; movers.</td><td>Immutable per hash → React Query <code>staleTime: Infinity</code>; service worker CacheFirst.</td></tr>
  <tr><td><code>data/history/&lt;id&gt;.json?v=&lt;hash&gt;</code></td><td>Delta-encoded epoch days + 6-significant-digit adjusted closes. Lazy-loaded only for instruments a page needs.</td><td>Same as snapshot; 30-minute in-memory GC.</td></tr>
  <tr><td><code>data/intraday.json</code></td><td>5-minute bars for eight headline instruments.</td><td>Per hash.</td></tr>
</table>
<div class="box"><h4>Why a manifest?</h4><p>It is the <b>atomic pointer</b> of the system. Because every other file is addressed by content hash through the manifest, a client can never combine a new snapshot with an old history file — the classic “torn read” of multi-file static publishing. It also makes polling cheap: one ~9 KB request, conditional on ETag, every two minutes.</p></div>
<h2>2.5 Client architecture</h2>
<ul>
  <li><b>Routing.</b> React Router with a basename; all pages are lazy chunks. GitHub Pages has no rewrite rules, so <code>web/scripts/postbuild.mjs</code> writes an <code>index.html</code> into a folder per route <i>and per asset</i> (deep links return real 200s) plus a <code>404.html</code> fallback.</li>
  <li><b>State.</b> Zustand stores persisted to localStorage: settings (currency, Beginner/Pro mode, theme, estimation choices, risk profile, watchlist) and portfolios (weights + total value + currency). Share links encode a portfolio with lz-string into the URL fragment, which never reaches a server; imports are validated and capped.</li>
  <li><b>Server state.</b> React Query for the manifest (polled), snapshot and histories (immutable), and <i>worker computations</i>: each worker call is a query keyed by a fingerprint of its inputs, which gives de-duplication, caching and “keep previous result while recomputing” for free.</li>
  <li><b>Compute.</b> One module Web Worker exposes <code>analyze</code>, <code>optimize</code>, <code>walkForward</code>, <code>rebalanceStudy</code>, <code>monthlyReturns</code> and <code>simulate</code> via Comlink. Inputs are structured-cloned (≈100 k numbers for a 10-asset, 20-year portfolio — milliseconds). Results are decimated to ≤ 700 points per series before crossing back.</li>
  <li><b>Charts.</b> A small custom SVG library on d3-scale/d3-shape: index-based time axes (no weekend gaps), crosshair tooltips listing every series, keyboard navigation, shaded regime bands, a table-view twin for every chart, and a colour palette validated for colour-vision deficiency in both themes.</li>
  <li><b>Live layer.</b> Stocks refresh with the pipeline; crypto streams over Binance's public WebSocket (market-data host first, main host second), with exponential reconnect and pausing in background tabs.</li>
</ul>
<h2>2.6 Deployment &amp; CI/CD</h2>
<table>
  <tr><th>Workflow</th><th>Trigger</th><th>What it guarantees</th></tr>
  <tr><td><code>ci.yml</code></td><td>every push &amp; PR</td><td>typecheck (4 projects), ESLint, Prettier, Vitest with coverage; Python re-derivation of golden fixtures then TS golden tests; production build with synthetic data; Playwright on desktop and mobile; bundle-size report.</td></tr>
  <tr><td><code>deploy.yml</code></td><td>cron, push to main, manual</td><td>live data → validation gate → build → Pages deploy → live smoke test. Concurrency group <code>pages</code> without cancellation so deployments never interleave.</td></tr>
  <tr><td><code>screenshots.yml</code></td><td>monthly, manual</td><td>README images regenerated from <i>live</i> data and committed (GITHUB_TOKEN pushes don't retrigger workflows).</td></tr>
  <tr><td><code>maintenance.yml</code></td><td>weekly</td><td>re-enables scheduled workflows via the API, defeating GitHub's 60-day inactivity auto-disable.</td></tr>
  <tr><td><code>codeql.yml</code>, Dependabot</td><td>push, weekly</td><td>static security analysis; grouped dependency updates for npm, Actions and pip.</td></tr>
</table>
<h2>2.7 Failure modes</h2>
<table>
  <tr><th>Failure</th><th>Detection</th><th>Behaviour</th><th>User impact</th></tr>
  <tr><td>One symbol 404/429s</td><td>HTTP layer</td><td>retry → previous-deploy copy → recorded in manifest</td><td>that asset's data ≤ 1 refresh stale</td></tr>
  <tr><td>Yahoo blocks the runner IP</td><td>coverage &lt; 85 %</td><td>validation fails, no deploy, job red</td><td>site keeps last good data; freshness pill turns amber</td></tr>
  <tr><td>Yahoo changes its JSON</td><td>parser throws → failures → gate</td><td>same as above</td><td>same as above</td></tr>
  <tr><td>Bad data slips (e.g. bad print)</td><td>spike filter; vol sanity warnings</td><td>point removed / warning logged</td><td>none</td></tr>
  <tr><td>GitHub cron delayed or skipped</td><td>manifest age</td><td>next run catches up (stateless)</td><td>data older than an hour</td></tr>
  <tr><td>Deploy succeeds, CDN stale</td><td>smoke test hash compare</td><td>warning after 3 min</td><td>≤ 10 min (Pages max-age)</td></tr>
  <tr><td>Worker throws (infeasible constraints)</td><td>React Query error</td><td>readable message from the feasibility checker</td><td>explains how to fix the constraints</td></tr>
  <tr><td>WebSocket blocked</td><td>onerror/onclose</td><td>backoff, host rotation</td><td>crypto shows last snapshot price</td></tr>
</table>
<h2>2.8 Security &amp; privacy model</h2>
<ul>
  <li><b>No backend, no secrets.</b> The deploy uses only the short-lived, job-scoped <code>GITHUB_TOKEN</code> with least-privilege permissions per workflow (<code>pages: write, id-token: write</code> for deploy; <code>contents: write</code> only for screenshots; <code>actions: write</code> only for keepalive).</li>
  <li><b>Untrusted inputs.</b> Share links and third-party data are treated as data: decoded JSON is type-checked, sanitised, capped at 40 holdings and rendered through React (escaped); WebSocket frames are parsed defensively. There is no <code>dangerouslySetInnerHTML</code>.</li>
  <li><b>Supply chain.</b> Lockfile, <code>npm ci</code>, pinned major versions of first-party GitHub Actions, CodeQL and Dependabot. Known gap: GitHub Pages cannot set response headers, so a CSP would have to be a <code>&lt;meta&gt;</code> tag (listed under limitations).</li>
  <li><b>Privacy.</b> Portfolios never leave the device; there are no analytics or cookies. The only third-party connection is the optional crypto WebSocket.</li>
</ul>`;

const tradeoffs = () => {
  const rows = [
    [
      'Hosting',
      'GitHub Pages + Actions',
      'Vercel/Netlify functions, Render/Fly containers, Cloudflare Workers + D1',
      'Free forever, global CDN, no cold starts, scheduler + CI + hosting next to the code, nothing to patch.',
      'No server-side compute per request; fixed <code>max-age=600</code>; cron is best-effort; public repo required on the free tier.',
    ],
    [
      'Data serving',
      'Static, content-hashed JSON',
      'REST/GraphQL API over Postgres',
      'Reads are CDN hits; zero ops; perfect cache semantics via hashes; scales to any audience.',
      'Data only as fresh as the last run; no per-user queries; payload design matters.',
    ],
    [
      'ETL model',
      'Stateless full refresh each run',
      'Incremental updates with a state store (cache/branch/DB)',
      'Idempotent and self-healing; dividend re-adjustments handled implicitly; trivial to reason about.',
      '~100 full-history requests per run; more upstream load than deltas.',
    ],
    [
      'Market data',
      'Yahoo v8 (keyless) + FRED',
      'Alpha Vantage, Polygon, Tiingo, EODHD (keys, quotas or cost)',
      'Free, deep history, covers NSE and US with adjusted closes.',
      'Unofficial and rate-limited; terms of use; mitigated by fallbacks and a gate, but a paid vendor is the production answer.',
    ],
    [
      'Numerics language',
      'TypeScript everywhere',
      'Python backend (NumPy/CVXPY) or Pyodide in the browser',
      'One engine for pipeline and browser; ~40 KB vs ~10 MB runtime; no server; Python retained for verification.',
      'No BLAS/SIMD; we must write and prove our own solvers; float64 only.',
    ],
    [
      'Optimiser',
      'Projected FISTA with exact projections',
      'Interior-point QP (OSQP/Clarabel via WASM), quadprog',
      'Tiny, dependency-free, warm-startable along frontiers, handles box + disjoint group constraints exactly.',
      'First-order accuracy (1e-9…1e-12 here) and backtracking; overlapping groups fall back to Dykstra.',
    ],
    [
      'Max Sharpe',
      'Golden-section along the λ-path',
      'Cornuejols–Tütüncü homogenised QP',
      'Re-uses the single MV kernel; works unchanged with any constraint the projector supports.',
      'Needs the unimodality argument; ~25 solves per call (9 ms).',
    ],
    [
      'Risk model default',
      'Ledoit–Wolf (constant correlation)',
      'Sample covariance',
      'Optimal shrinkage intensity; well-conditioned even when T is close to n; stabilises weights.',
      'Biased towards the average correlation; less reactive than EWMA.',
    ],
    [
      'Return model default',
      'Bayes–Stein shrinkage',
      'Raw historical means',
      'Cuts the error-maximisation problem at its root; still data-driven.',
      'Still backward-looking; shrinkage target is a modelling choice.',
    ],
    [
      'Beginner portfolios',
      'Forecast-free risk budgeting by profile',
      'Mean–variance optimised “model” portfolios',
      'Robust, explainable, no reliance on noisy return forecasts; follows strategic-allocation practice.',
      'Not “optimal” in-sample; sleeve composition is opinionated.',
    ],
    [
      'Regimes',
      'Two-state Gaussian HMM, filtered probabilities',
      'Volatility thresholds; smoothed HMM; Markov-switching GARCH',
      'Statistically principled, interpretable states, no look-ahead in the live signal.',
      'Gaussian emissions miss fat tails; state labels can flip without sorting (we sort by variance).',
    ],
    [
      'Multi-market alignment',
      'Weekday calendar + forward fill; weekly returns for betas',
      'Intersection of trading days; daily betas',
      'Keeps all observations; weekly sampling removes asynchronous-close bias (NSE closes before NYSE opens).',
      'Holiday zero-returns slightly understate volatility; documented.',
    ],
    [
      'Compute placement',
      'Web Worker + Comlink + React Query',
      'Main thread, or server endpoints',
      'UI never janks; results cached by input fingerprint; private by construction.',
      'Structured-clone cost; worker debugging is harder.',
    ],
    [
      'Charts',
      'Custom SVG on d3-scale/d3-shape',
      'Recharts, ECharts, Highcharts',
      '~15 KB, total control of accessibility and design tokens, index time axes, table twins.',
      'More code to own; no canvas path for huge series (we decimate instead).',
    ],
    [
      'State',
      'Zustand + localStorage',
      'Accounts with a backend',
      'Zero friction, private, offline-capable.',
      'No cross-device sync; storage can be cleared.',
    ],
    [
      'Explanations',
      'Deterministic NLG templates',
      'LLM-generated text',
      'Free, instant, offline, testable, can never hallucinate numbers.',
      'Less varied prose; templates must be maintained.',
    ],
    [
      'Styling',
      'Tailwind v4 + CSS variable tokens',
      'CSS-in-JS, component library',
      'Theme switching is a variable flip; no runtime cost; validated palette in one place.',
      'Long class lists; v4 <code>@utility</code> idioms are new.',
    ],
    [
      'Monorepo',
      'npm workspaces, source-level imports',
      'pnpm + Turborepo, published packages',
      'No build step between packages; one lockfile; one test runner (Vitest projects).',
      'No task caching; workspace TS resolution must be configured carefully.',
    ],
    [
      'Test data',
      'Synthetic generator flagged in UI; recorded API fixtures',
      'Committing real market data',
      'Deterministic, licence-free, offline CI.',
      'Synthetic data cannot catch real-world data quirks — the live gate covers that.',
    ],
    [
      'Cache busting',
      '<code>?v=hash</code> query from manifest',
      'Hashed filenames',
      'Stable file paths (easy fallback fetch and debugging) with exact invalidation.',
      'Relies on CDNs keying on query strings (Pages/Fastly does).',
    ],
    [
      'SPA routing on Pages',
      'index.html per route + 404.html',
      'Hash routing; 404 redirect trick',
      'Clean URLs with real 200s for every known page.',
      'Build step must enumerate routes (done from the snapshot for assets).',
    ],
  ];
  return `
<h1 class="section" id="s3"><span class="num">3</span>Engineering trade-offs — every major decision</h1>
<p class="lead">Interviewers rarely ask <i>what</i> you built; they ask <i>why not the alternative</i>. Each row states the decision, the main alternative, the argument for, and the honest cost.</p>
<table>
  <tr><th style="width:13%">Area</th><th style="width:16%">Chosen</th><th style="width:19%">Rejected alternative</th><th style="width:27%">Why</th><th>Cost we accepted</th></tr>
  ${rows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}
</table>
<h2>3.1 The three decisions that shaped everything</h2>
<h3>(a) “The cron is the backend, the CDN is the database.”</h3>
<p>The requirement was permanent 24/7 hosting at zero cost. Free compute tiers either sleep (cold starts of 30 s+ on container hosts), cap invocations, or require credit cards and secrets. Market data changes at most a few times an hour for this audience, so a <b>batch</b> architecture is a perfect fit: compute shared results once, serve them as files. The consequence is that every per-user computation must happen client-side — which pushed the quant engine into TypeScript and into a Web Worker.</p>
<h3>(b) One numerical engine in two runtimes.</h3>
<p>Using Python in CI and JavaScript in the browser would mean two implementations of every statistic, guaranteed to drift. A single zero-dependency TypeScript package means the Sharpe ratio on the Markets page is computed by exactly the code that computes it on the Portfolio page. The price is that we can't lean on LAPACK or CVXPY at runtime; we earned trust instead with golden tests against those libraries.</p>
<h3>(c) Robust estimation over optimisation cleverness.</h3>
<p>Mean–variance optimisation is notoriously an <i>error maximiser</i> (Michaud, 1989): it over-weights assets whose returns are over-estimated and risks under-estimated. Rather than chase a more sophisticated optimiser, Frontier spends its complexity on <b>inputs</b> — Ledoit–Wolf and denoised covariances, Bayes–Stein and Black–Litterman returns — on <b>robust methods</b> that ignore returns entirely (risk parity, HRP), and on <b>honest evaluation</b> (walk-forward tests that show users how often simple methods win).</p>`;
};

export function renderGuide({ css, stats }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frontier — Interview Guide</title><style>${css}</style></head><body>
  ${cover(stats)}
  ${toc()}
  ${summary(stats)}
  ${architecture()}
  ${tradeoffs()}
  ${ALGORITHMS}
  ${QUALITY}
  <h1 class="section" id="s6"><span class="num">6</span>20 brutal interview questions — with model answers</h1>
  <p class="lead">Each question lists what the interviewer is really probing, a model answer grounded in this codebase, and the follow-up you should expect.</p>
  ${QUESTIONS.map((q, i) => `<div class="q"><div class="qh"><span class="qn">Q${i + 1}</span><span class="qt">${q.q}</span></div><div class="probe"><b>What they're testing:</b> ${q.probe}</div>${q.a}<div class="follow"><b>Likely follow-up:</b> ${q.follow}</div></div>`).join('')}
  ${RAPID}
  </body></html>`;
}

// ─── §4 algorithms & §5 quality (static HTML) ─────────────────────────────
const ALGORITHMS = `
<h1 class="section" id="s4"><span class="num">4</span>The quant engine: algorithms you must be able to explain</h1>
<h2>4.1 One kernel for every mean–variance objective</h2>
<p>Every MV-type objective reduces to the constrained problem</p>
<pre>w(λ) = argmin_{w ∈ C}  ½·λ·wᵀΣw − μᵀw + γ‖w − w̄‖²
C    = { w : lᵢ ≤ wᵢ ≤ uᵢ,  Σwᵢ = 1 } ∩ { asset-class bounds }</pre>
<ul>
  <li><b>Minimum variance</b>: λ → ∞ (μ ignored). <b>Max utility</b>: fixed λ. <b>Efficient frontier</b>: the path λ ↦ w(λ), traced on a log grid with warm starts.</li>
  <li><b>Target return / target volatility</b>: bisection on log λ, because the frontier's return and volatility are monotone decreasing in λ. Unreachable targets clamp with a readable warning.</li>
  <li><b>Max Sharpe</b>: the efficient frontier σ*(r) is convex in r (value function of a parametric convex program), so the Sharpe ratio (r − r_f)/σ*(r) is quasi-concave along the path → <b>unimodal in λ</b>. A 10-point grid brackets the peak; golden-section search refines it to a 1e-4 bracket in log λ.</li>
  <li><b>Max diversification</b>: maximise Σwᵢσᵢ / σ_p — which is exactly the Sharpe ratio with μ := σ and r_f := 0, so it reuses the same search.</li>
</ul>
<h2>4.2 The solver and its projections</h2>
<p><b>Monotone FISTA</b> (Beck &amp; Teboulle 2009) with backtracking on the descent-lemma condition; the Lipschitz constant is initialised exactly as L = λ·λ_max(Σ) + 2γ (power iteration). Convergence is O(1/k²); the monotone variant never accepts an increase of the objective, which matters for the non-quadratic CVaR objective.</p>
<p><b>Capped-simplex projection.</b> KKT gives wᵢ(τ) = clip(vᵢ − τ, lᵢ, uᵢ). The sum Σwᵢ(τ) is monotone non-increasing in τ, so bisection on τ (100 iterations max) is globally convergent and exact to machine precision; a final residual is spread over free coordinates.</p>
<p><b>Disjoint group constraints</b> (e.g. “≤ 60 % stocks”). Dykstra's alternating projections initially failed: inexact inner projections made FISTA run its full 20 000 iterations (4.2 s). The fix was an exact projection: for a fixed τ, each group's multiplier merely clamps its group sum into [lo_G, hi_G], so the total S(τ) = Σ_G median(lo_G, S_G(τ), hi_G) + Σ_free clip(vᵢ − τ) is monotone in τ. One outer bisection plus one per active group — milliseconds. Overlapping groups still use Dykstra.</p>
<h2>4.3 Estimators</h2>
<table>
  <tr><th>Estimator</th><th>Formula / idea</th><th>Verified against</th></tr>
  <tr><td>Ledoit–Wolf (identity)</td><td>Σ̂ = (1−δ)S + δ·μI with δ = min(β, δ̄)/δ̄ from the sample's fourth moments</td><td>scikit-learn <code>ledoit_wolf</code> (exact to 1e-15)</td></tr>
  <tr><td>Ledoit–Wolf (constant correlation)</td><td>Target F: own variances, average correlation r̄; κ = (π − ρ)/γ, δ = clip(κ/T, 0, 1)</td><td>PyPortfolioOpt (exact to 1e-15)</td></tr>
  <tr><td>EWMA</td><td>weights λ^(T−1−t), λ = 0.94 (RiskMetrics), weighted demeaning</td><td>unit tests (PD, scale)</td></tr>
  <tr><td>RMT denoising</td><td>eigenvalues below λ₊ = σ²(1+√(n/T))² replaced by their mean, trace preserved, unit diagonal restored</td><td>unit tests (PD, unit diagonal)</td></tr>
  <tr><td>Bayes–Stein</td><td>μ_BS = (1−w)m + w·μ₀, w = (n+2)/((n+2) + T·dᵀS⁻¹d), μ₀ = GMV return</td><td>unit tests</td></tr>
  <tr><td>Black–Litterman</td><td>μ_BL = π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − Pπ); Ω He–Litterman or Idzorek (α = (1−c)/c)</td><td>PyPortfolioOpt (1e-13)</td></tr>
</table>
<h2>4.4 Robust allocators</h2>
<p><b>Risk parity</b> solves Spinu's strictly convex problem min ½yᵀΣy − Σbᵢ ln yᵢ by cyclical coordinate descent; each coordinate update is the positive root of a quadratic, yᵢ = (−cᵢ + √(cᵢ² + 4Σᵢᵢbᵢ))/(2Σᵢᵢ), and w = y/Σy. Our risk contributions match to 1e-10 — tighter than the Clarabel reference (8e-6), which is why the golden test asserts equal contributions rather than equality with the reference.</p>
<p><b>HRP</b>: correlation distance √(½(1−ρ)), single-linkage clustering via Prim's MST and union-find labelling that reproduces SciPy's linkage IDs exactly, leaf ordering by DFS, then recursive bisection with inverse-variance cluster risk. No matrix inversion, so it never explodes on near-duplicate assets.</p>
<p><b>Min CVaR</b> (Rockafellar–Uryasev): CVaR_α(w) = min_ζ ζ + (1/((1−α)T))Σ max(ℓₜ − ζ, 0). The hinge is smoothed with an annealed soft-plus; ζ is minimised <i>exactly</i> inside every evaluation by a monotone root find, and Danskin's theorem gives the reduced gradient — removing a severe conditioning problem between ζ and w. Result: within 1 % of the HiGHS LP optimum.</p>
<h2>4.5 Simulation, regimes and signals</h2>
<ul>
  <li><b>Monte Carlo</b>: month-major simulation over Float64Arrays; exact lognormal moment matching (E[1+r] = 1 + μ/12, Var = σ²/12); Student-t shocks applied to <i>simple</i> returns (a t-distribution has no moment-generating function); Politis–Romano stationary block bootstrap (mean block 6 months) of the portfolio's own history; SIP step-ups, fees, inflation-indexed withdrawals, depletion and goal-time statistics.</li>
  <li><b>Gaussian HMM</b>: Baum–Welch with Rabiner scaling, four seeded restarts, states sorted by variance, Viterbi path for “regime since”, and <b>filtered</b> probabilities P(sₜ | x₁…ₜ) for the live signal — smoothed probabilities would leak the future.</li>
  <li><b>Trend score</b>: 40 % trend (price vs 50/200-day averages), 30 % 12-1 momentum percentile within a peer group, 20 % 1-year Sharpe percentile, 10 % overheating penalty from RSI — each point traceable to a sentence.</li>
</ul>`;

const QUALITY = `
<h1 class="section" id="s5"><span class="num">5</span>Quality strategy: how the maths is proven right</h1>
<figure>${pyramidSvg}<figcaption>Figure 3 — 113 automated checks plus a live smoke test after every deployment.</figcaption></figure>
<h2>5.1 Golden tests</h2>
<p><code>tools/reference/generate_fixtures.py</code> draws daily returns from a seeded two-factor model (600 days × 8 assets) and computes reference results with independent, widely used libraries. The fixture stores the <i>inputs too</i>, so the TypeScript tests consume byte-identical data.</p>
<table>
  <tr><th>Component</th><th>Reference</th><th>Tolerance &amp; rationale</th></tr>
  <tr><td>Sample covariance, Ledoit–Wolf ×2</td><td>NumPy, scikit-learn, PyPortfolioOpt</td><td>1e-15 — deterministic closed forms</td></tr>
  <tr><td>HRP weights + linkage matrix</td><td>PyPortfolioOpt / SciPy</td><td>1e-12 and identical cluster IDs</td></tr>
  <tr><td>Black–Litterman (both Ω)</td><td>PyPortfolioOpt</td><td>1e-13</td></tr>
  <tr><td>Min variance, utility, max Sharpe, targets, groups, max diversification</td><td>CVXPY + Clarabel</td><td>objective ≥ reference − 1e-6; weights 2e-4…2e-3 (interior-point solvers stop at ~1e-8 gaps)</td></tr>
  <tr><td>Min CVaR</td><td>CVXPY + HiGHS LP</td><td>within 1 % (smoothing)</td></tr>
  <tr><td>Metrics, OLS, eigenvalues, normal quantiles</td><td>pandas, NumPy LAPACK, SciPy</td><td>1e-10…1e-14</td></tr>
</table>
<h2>5.2 Bugs the tests actually caught</h2>
<div class="box warn">
  <ol>
    <li><b>Group constraints hung.</b> Dykstra-in-FISTA needed 4.2 s and never met tolerance → exact disjoint-group projection (milliseconds).</li>
    <li><b>OLS was biased by 2e-9.</b> A “harmless” default ridge of 1e-12·trace distorted small-scale regressors → removed; collinearity handled by Cholesky jitter only.</li>
    <li><b>Monte Carlo drifted high.</b> The lognormal drift made E[1+r] = e^(μ/12) instead of 1 + μ/12 (≈ 0.4 %/yr error) → exact moment matching; zero-volatility test now equals the closed-form SIP value to the cent.</li>
    <li><b>“Failure” that was a success.</b> ERC weights differed from Clarabel by 5e-6; measuring risk contributions showed ours were 1000× more equal → the test now asserts the defining property.</li>
    <li><b>A month-offset bug</b> (<code>Date.UTC</code> takes 0-based months) in the fetch window was caught in review while fixing a no-op expression.</li>
  </ol>
</div>
<h2>5.3 Pipeline &amp; front-end tests</h2>
<ul>
  <li>Parsers run on a recorded-shape Yahoo response with nulls, duplicate bars and IST timestamps; FRED's “.” missing values; the history codec round-trip; universe integrity (unique, file-safe IDs; valid benchmarks and proxies); the concurrency limiter; and an end-to-end offline pipeline run through the validation gate.</li>
  <li>Playwright drives the production build: every route on desktop and a Pixel 7 profile with console-error assertions; the full questionnaire → adopt journey; the asset picker; the optimiser; the command palette; theme switching; share-link import.</li>
  <li><b>Accessibility by construction</b>: categorical palette validated for adjacent-pair CVD separation (OKLab ΔE ≥ 8) and contrast in both themes; text tokens ≥ 4.5:1 (WCAG AA); signal and status colours always paired with an icon and a label; every chart has a keyboard crosshair and a table view.</li>
</ul>`;
