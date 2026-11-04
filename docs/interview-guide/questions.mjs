// The 20 interview questions, rapid-fire round and limitations for the guide.

export const QUESTIONS = [
  {
    q: `Walk me through everything that happens between Yahoo publishing a new price and a user seeing it in Frontier. Where is the latency, and how would you get it under one minute?`,
    probe: `End-to-end systems thinking, knowing your own critical path, and whether you can reason about trade-offs instead of just adding infrastructure.`,
    a: `<p><b>The path.</b> A GitHub Actions cron (<code>17 * * * 1-5</code>) queues a run. The runner installs dependencies (~40 s), the pipeline fetches ~98 symbols through a 4-slot limiter (~1–2 min), analyses and validates (~5 s), Vite builds (~15 s), <code>deploy-pages</code> publishes atomically (~30–60 s), and a smoke job confirms the live manifest's <code>generatedAt</code>. In the browser, React Query polls <code>manifest.json</code> every 120 s with <code>cache: 'no-cache'</code>; when the snapshot hash changes it fetches <code>snapshot.json?v=&lt;hash&gt;</code> and a toast announces fresh data.</p>
<p><b>Latency budget.</b> (1) Scheduling: up to an hour between runs plus GitHub's queue delay at busy minutes — the dominant term, which is why the cron uses minute 17, not 0. (2) Run time: ~3–5 minutes. (3) CDN: GitHub Pages sends <code>max-age=600</code>, so an edge may serve the old manifest for up to 10 minutes. (4) Polling: ≤ 2 minutes. Crypto bypasses all of this through the Binance WebSocket and is real-time.</p>
<p><b>Getting under a minute</b> requires changing the architecture, not tuning it: (a) move the live quote layer to a push channel — a small edge function (Cloudflare Worker) proxying a licensed real-time feed with server-sent events, while the heavy daily analytics stay in the batch job; (b) or have the pipeline run continuously (a free-tier VM or a self-hosted runner) publishing only a tiny <code>quotes.json</code> every 30 s to an object store with short TTLs. I deliberately didn't: the users are long-horizon investors for whom hourly is plenty, and the zero-cost, zero-ops property was a hard requirement.</p>`,
    follow: `“GitHub cron can be delayed or skipped entirely — how would you know?” → manifest age is shown in the UI (freshness pill turns amber after 3 h), every run writes a job summary, and an external uptime monitor on the manifest age would alert.`,
  },
  {
    q: `Your entire backend is a cron job scraping an unofficial API. What happens the day Yahoo starts returning 429s from GitHub runners, or changes its JSON? How do you find out, and what does the user see?`,
    probe: `Failure-mode design, graceful degradation, observability — and honesty about vendor risk.`,
    a: `<p><b>Layer 1 — the HTTP client</b> (<code>pipeline/src/sources/http.ts</code>): 429/5xx are retried four times with exponential backoff and full jitter, honouring <code>Retry-After</code>; 4xx are fatal except 401/403, which trigger a one-time cookie + crumb handshake (the technique yfinance uses when Yahoo tightens access). Requests alternate between query1/query2 hosts and run at most four in parallel.</p>
<p><b>Layer 2 — per-instrument fallback</b>: if a symbol still fails, the pipeline downloads that instrument's history from the currently deployed site (“the CDN is the backup database”) and marks its source as <code>previous-deploy</code>. One flaky symbol never regresses the site.</p>
<p><b>Layer 3 — the validation gate</b>: if Yahoo blocks broadly, coverage drops below 85 % or a core instrument (SPY, Nifty, USD/INR…) is missing; if the JSON shape changes, the parser throws for every symbol and the same gate trips. The job exits non-zero <i>before</i> the deploy step, so GitHub Pages keeps serving the last good build.</p>
<p><b>Observability</b>: failures are emitted as workflow annotations and a step summary; the manifest records sources and failures per run; the UI's freshness pill shows the data's age. <b>User impact</b>: data becomes stale but never wrong or broken.</p>
<p><b>Honest answer on vendor risk</b>: Yahoo's endpoints are unofficial and its terms restrict automated use, so for anything beyond a portfolio project I would put a licensed vendor (Polygon, Tiingo, EODHD) behind the same <code>sources/</code> interface — the contracts package means the rest of the system wouldn't change.</p>`,
    follow: `“What if Yahoo returns plausible but wrong numbers?” → spike filter for one-day bad prints, volatility sanity warnings, validation on finite positive prices; next step would be cross-checking a second source on core instruments.`,
  },
  {
    q: `Why is mean–variance optimisation called an “error maximiser”, and what specifically did you do about it?`,
    probe: `Whether you understand estimation risk — the central problem of practical portfolio construction — beyond textbook Markowitz.`,
    a: `<p>The optimiser treats μ and Σ as truth. Estimation errors are not random noise in the output: the optimiser systematically <i>seeks out</i> assets whose expected return is over-estimated and whose risk is under-estimated, because those look best (Michaud 1989). Errors in μ dominate — Chopra &amp; Ziemba (1993) estimate they matter about ten times more than errors in variances. With 10 years of data you can barely distinguish a 6 % asset from a 10 % one (standard error of a mean ≈ σ/√T ≈ 16 %/√10 ≈ 5 %).</p>
<p>Frontier attacks this at four levels:</p>
<ol><li><b>Better Σ</b>: Ledoit–Wolf shrinkage to a constant-correlation target by default (optimal intensity, always well-conditioned), with EWMA and Marchenko–Pastur denoising as options.</li>
<li><b>Better μ</b>: Bayes–Stein shrinkage towards the minimum-variance portfolio's return by default; CAPM and equilibrium priors; Black–Litterman to blend views with explicit confidence.</li>
<li><b>Constraints as regularisation</b>: per-asset caps (default 40 %), minimums and asset-class caps; optional L2 penalty towards equal weights. Jagannathan &amp; Ma (2003) show that caps act like covariance shrinkage.</li>
<li><b>Methods that don't need μ</b>: risk parity and HRP, and a walk-forward test that shows users, out of sample and after costs, how often these beat “optimal” portfolios — the DeMiguel, Garlappi &amp; Uppal (2009) result made tangible.</li></ol>
<p>And for beginners, the recommended model portfolios use <b>no return forecasts at all</b>: allocation by risk profile, equal risk contribution inside each sleeve.</p>`,
    follow: `“Then why offer max-Sharpe at all?” → it's the reference point everyone knows; shown with shrunk inputs, guard-rails and an out-of-sample test beside it.`,
  },
  {
    q: `Explain Ledoit–Wolf shrinkage. Why the constant-correlation target rather than the identity, and how did you prove your implementation is correct?`,
    probe: `Depth on one statistical technique, and verification discipline for numerical code.`,
    a: `<p>The sample covariance S is unbiased but noisy: with n assets it has n(n+1)/2 parameters, and its smallest eigenvalues are biased towards zero, which an optimiser exploits. Ledoit–Wolf replaces S with Σ̂ = δF + (1 − δ)S, a convex combination with a structured, low-variance target F. The key result is a <b>consistent closed-form estimate of the δ that minimises expected Frobenius loss</b>: δ* = κ/T with κ = (π − ρ)/γ, where π is the sum of asymptotic variances of the entries of S, ρ the corresponding covariances with F, and γ = ‖F − S‖² the target's misspecification.</p>
<p><b>Target choice</b>: the identity target (Ledoit–Wolf 2004a) shrinks every variance towards the average variance — fine for equally scaled signals, but it distorts assets whose volatilities differ by 10× (Treasury bills vs Bitcoin). The constant-correlation target (2004b) keeps each asset's own variance and shrinks only the correlations towards their average, which is the structure that actually matters for equities. Frontier offers both; constant-correlation is the default.</p>
<p><b>Proof of correctness</b>: <code>ledoitWolfIdentity</code> mirrors scikit-learn's estimator, and <code>ledoitWolfConstantCorrelation</code> mirrors PyPortfolioOpt's — including their conventions (ddof = 0 vs 1). Golden tests run both against the Python libraries on a seeded 600 × 8 factor-model sample and match the shrinkage intensity to 12 decimals and every matrix entry to 1e-15. CI re-generates the fixtures in Python on every push, so an upstream library change would surface immediately.</p>`,
    follow: `“When does shrinkage hurt?” → when the true structure differs strongly from the target (e.g. distinct sector blocks); then a factor-model or block target, or RMT denoising, is better.`,
  },
  {
    q: `You maximise the Sharpe ratio, which is non-convex in the weights. How do you know you found the global optimum — with box and asset-class constraints?`,
    probe: `Mathematical maturity: convexity arguments, problem transformations, and knowing when a method is actually correct.`,
    a: `<p>There are two standard routes. The textbook one is the <b>Cornuejols–Tütüncü homogenisation</b>: minimise yᵀΣy subject to (μ − r_f)ᵀy = 1 and y ≥ 0, then w = y/Σy; box constraints become y ≤ κu with an extra variable κ. It's convex, but it needs a different constraint set from every other objective — I use it in the Python reference to generate the golden answer.</p>
<p>Frontier's engine uses a route that reuses its single mean–variance kernel. Let σ*(r) be the minimum volatility achievable at return r over the constraint set C. Because C is convex, the value function of the parametric problem min{wᵀΣw : μᵀw = r, w ∈ C} is convex in r, so σ*(r) — the frontier — is convex. The Sharpe ratio along the frontier, (r − r_f)/σ*(r), is a ratio of an affine function to a positive convex function, hence <b>quasi-concave</b>: it has no local maxima other than the global one. The frontier is parameterised monotonically by the risk-aversion λ, so Sharpe is unimodal in log λ.</p>
<p>The implementation brackets the peak with a 10-point log-spaced λ grid (warm-started FISTA solves) and refines with golden-section search to a 1e-4 bracket. Any interior frontier point is efficient, so the tangency portfolio lies on this path even with asset-class constraints. The golden test checks the result's Sharpe is ≥ CVXPY's minus 1e-6, and a property test checks it beats every one of 60 frontier points and 2,000 random feasible portfolios. Degenerate case: if no feasible portfolio beats the risk-free rate, Sharpe has no meaningful maximum; the optimiser returns minimum variance with a plain-English warning.</p>`,
    follow: `“Why not maximise Sharpe directly by projected gradient ascent?” → also valid (it's pseudo-concave where the numerator is positive), but slower near boundaries and not reusable for target-return/volatility.`,
  },
  {
    q: `Walk me through your projected-gradient solver. Why FISTA, why the monotone variant, how do you choose the step size, and what broke when you added asset-class constraints?`,
    probe: `Optimisation fundamentals, and the ability to debug numerical performance problems.`,
    a: `<p>The problems are smooth (quadratic or smoothed), small (n ≤ ~100), and the feasible set has a cheap exact projection — the ideal setting for accelerated projected gradient. FISTA achieves O(1/k²) versus O(1/k) for plain projected gradient. I use Beck &amp; Teboulle's <b>monotone</b> variant, which never accepts a step that increases the objective; plain FISTA can oscillate, which matters for the soft-plus CVaR objective. Step size 1/L comes from the exact Lipschitz constant L = λ·λ_max(Σ) + 2γ (λ_max by power iteration) with backtracking on the descent-lemma inequality as a safety net, and a gentle L ← 0.95L per iteration so one conservative backtrack doesn't slow everything down.</p>
<p>The projection onto {l ≤ w ≤ u, Σw = 1} is exact: wᵢ = clip(vᵢ − τ, lᵢ, uᵢ) with τ found by bisection, because Σwᵢ(τ) is monotone.</p>
<p><b>What broke</b>: for constraints like “stocks ≤ 35 %”, I first combined the box-simplex projection with half-space projections using Dykstra's algorithm. The golden test passed — but took <b>4.2 seconds</b>. Profiling showed FISTA hitting its 20,000-iteration cap: Dykstra's inner iterations converge only linearly, and the slightly inexact projections prevented the outer stopping criterion (1e-12) from ever being met. The fix was mathematical, not a tolerance hack: for <i>disjoint</i> groups the KKT conditions decouple. At a fixed τ, each group's multiplier just clamps its group sum into [lo, hi], so the total Σ_G median(lo_G, S_G(τ), hi_G) + Σ_free clip(·) is monotone in τ — one outer bisection plus one bisection per active group gives the exact projection. Runtime dropped to milliseconds. Overlapping groups still use Dykstra, which is correct but slower.</p>`,
    follow: `“Why not an interior-point method?” → more accurate per iteration, but needs linear-system solves, has no cheap warm starts along a frontier, and would be a large dependency; the golden tests show first-order accuracy is more than sufficient.`,
  },
  {
    q: `HRP, risk parity and mean–variance: when would you choose each? What did your walk-forward test show, and why does that test matter?`,
    probe: `Practical portfolio-construction judgement and an understanding of in-sample vs out-of-sample evaluation.`,
    a: `<p><b>Mean–variance</b> is right when you have credible return views and want to express them precisely — e.g. via Black–Litterman with explicit confidence. It is fragile without them. <b>Equal risk contribution</b> needs only covariances: every holding contributes the same amount of volatility; robust and intuitive, but it ignores clustering — five tech stocks each get an equal risk budget as if independent. <b>HRP</b> first clusters assets by correlation distance, orders them so similar assets are adjacent, then splits risk recursively between halves. Similar assets share a budget, it never inverts Σ (so near-duplicates don't explode), and it tends to be stable out of sample (López de Prado 2016).</p>
<p><b>Why the walk-forward test matters</b>: any optimiser looks perfect on the data it was fitted to. <code>walkForward()</code> re-estimates every month or quarter using only the trailing 252 trading days, chooses weights, then holds them (letting them drift) until the next rebalance, charging transaction costs on turnover. That is the only fair comparison. On typical multi-asset universes, equal weight, risk parity and HRP land close to or ahead of max-Sharpe on risk-adjusted returns, with far lower turnover — max-Sharpe chases last year's winners. Because the test runs on the user's own holdings, the conclusion is shown to them rather than asserted.</p>`,
    follow: `“HRP's bisection splits the ordered list in halves rather than following the dendrogram — is that a flaw?” → yes, a known critique; HERC (Raffinot 2018) follows the tree. I kept the original to match the reference implementation exactly.`,
  },
  {
    q: `Your app says “the market is in a turbulent regime with 80 % probability”. What exactly does that number mean, and how could it be misleading?`,
    probe: `Statistical rigour, look-ahead bias, and communicating uncertainty.`,
    a: `<p>It comes from a two-state Gaussian Hidden Markov Model fitted to ten years of daily log returns (×100 for numerical scale) of the S&amp;P 500 or Nifty 50. Each hidden state has its own mean and variance; a 2×2 Markov matrix governs switching. Parameters are fitted by Baum–Welch (EM) with Rabiner scaling from four seeded random starts, keeping the best likelihood; states are then <b>sorted by variance</b> so “state 0 = calm” is stable across runs (EM is invariant to label permutations).</p>
<p>The 80 % is the <b>filtered</b> probability P(s_T = turbulent | x₁…x_T) from the scaled forward pass — what an investor could have known that day. I deliberately don't use the smoothed probabilities P(s_t | x₁…x_T), which look cleaner historically but use future data: a backtest built on them is look-ahead biased. The chart of past regimes on the Today page shows filtered values for the same reason.</p>
<p><b>Ways it misleads</b>: (1) it is a probability <i>under the model</i>, and Gaussian emissions understate fat tails, so the turbulent state partly absorbs crashes; (2) parameters are re-estimated every run, so history can shift slightly; (3) regime persistence is not a forecast of returns; (4) a two-state model is a simplification — three states (bull/bear/crisis) fit better but are less stable. The UI words it as “most likely” or “probably” depending on the probability and explains what the regime implies behaviourally (don't panic-sell; consider rebalancing), not as a trading signal.</p>`,
    follow: `“How would you validate it?” → out-of-sample log-likelihood vs a single-Gaussian model, forecast evaluation of realised volatility conditional on the filtered state, and synthetic-data recovery tests (one exists in the suite).`,
  },
  {
    q: `You mix NSE stocks, NYSE ETFs, 24/7 crypto and USD/INR. How do you align them for portfolio returns, correlations and betas without introducing bias?`,
    probe: `Real-world data-engineering skill in finance: calendars, time zones, currencies and asynchronous trading.`,
    a: `<p><b>Dates</b>: every bar is converted to an <i>exchange-local</i> calendar day using the response's GMT offset (a US bar stamped 13:30 UTC and an Indian bar at 03:45 UTC both map to their local trading day). Dates are integer epoch days throughout — timezone-free and cheap to compare.</p>
<p><b>Calendar</b>: <code>alignSeries</code> takes the union of observation dates restricted to Monday–Friday, forward-fills holidays, and starts when the youngest instrument begins so every column is real data. Crypto weekend moves roll into Monday's return. Annualisation uses the <i>empirical</i> periods per year of the aligned calendar (≈ 260 for the weekday union, 252 for US stocks alone, 365 for crypto alone) rather than a hard-coded 252.</p>
<p><b>Currency</b>: every series is converted to the portfolio's base currency with the forward-filled USD/INR rate before computing returns, so an Indian investor's S&amp;P 500 position includes its currency return — which is real risk for them.</p>
<p><b>Asynchronous trading</b>: India closes before New York opens, so a global shock shows up in Nifty one calendar day after the S&amp;P 500. Daily correlations and betas are biased towards zero. Frontier computes betas and hypothetical-shock sensitivities on <b>weekly</b> returns, where the one-day offset is diluted.</p>
<p><b>Known residual bias</b>: forward-filled holidays create zero returns that slightly understate volatility in multi-market portfolios; a holiday-aware intersection calendar or Newey–West-style adjustments would remove it. It's documented on the Learn page.</p>`,
    follow: `“Dimson betas?” → regressing on lead and lag market returns is the classical fix for non-synchronous trading; weekly sampling is the simpler alternative I chose.`,
  },
  {
    q: `Your Monte Carlo planner offers a bootstrap, a normal model and a fat-tailed model. Why the block bootstrap, what does the block length trade off — and what bug did you find in the parametric models?`,
    probe: `Simulation design and the subtle statistics of compounding.`,
    a: `<p>An i.i.d. normal model ignores the three stylised facts that hurt investors most: fat tails, negative skew and volatility clustering. The <b>stationary block bootstrap</b> (Politis &amp; Romano 1994) resamples the portfolio's own historical monthly returns in blocks with geometrically distributed lengths (mean 6 months): at each step a path continues its current block with probability 5/6 or jumps to a random month. Blocks preserve short-range autocorrelation and clusters like 2008's consecutive losses; the random lengths keep the resampled series stationary. Short blocks lose dependence; long blocks reduce diversity because there are only a few hundred months to sample from — 6 months is a common compromise for monthly data.</p>
<p><b>The bug</b>: the first GBM implementation used a log-drift of μ/12 − ½σ²/12 and exponentiated. That makes E[1 + r] = e^(μ/12), not 1 + μ/12 — an upward bias of about 0.4 % a year at μ = 10 %, which compounds over 30 years. A zero-volatility unit test caught it because the simulated value didn't equal the closed-form SIP future value. The fix is exact lognormal moment matching: s² = ln(1 + (σ²/12)/(1 + μ/12)²) and m = ln(1 + μ/12) − s²/2. For the Student-t model I had been exponentiating t-distributed shocks too — but a Student-t has <b>no moment-generating function</b>, so E[e^(sT)] is infinite and the sample mean is dominated by rare extreme draws. The fat-tailed model now shocks simple returns directly (floored at −95 %).</p>
<p>Implementation detail: simulation is month-major over Float64Arrays (state per path), giving exact percentiles every month; 6,000 paths × 30 years runs in well under a second in the worker.</p>`,
    follow: `“Isn't history too short for a 30-year bootstrap?” → yes; that's why the parametric models exist, and the Advisor's forward return is shrunk halfway to a Sharpe-0.3 prior.`,
  },
  {
    q: `What is the difference between VaR and CVaR? Why did regulators move to expected shortfall, and how does Frontier compute and use each?`,
    probe: `Risk-measure literacy: coherence, tails and estimation.`,
    a: `<p><b>VaR at 95 %</b> is a quantile: the loss exceeded on only 5 % of days. It says nothing about <i>how bad</i> those days are, and it is not sub-additive — merging two portfolios can show more VaR than the sum, which punishes diversification. <b>CVaR / expected shortfall</b> is the average loss in that tail. It is a coherent risk measure (Artzner et al. 1999) and it is what Basel's Fundamental Review of the Trading Book adopted (97.5 % ES) for exactly these reasons. It is also convex in the weights, so it can be <i>optimised</i> as a linear programme (Rockafellar &amp; Uryasev 2000).</p>
<p>Frontier reports, per day: historical VaR (empirical 5 % quantile with linear interpolation, matching NumPy), historical CVaR (mean of losses at or beyond that quantile), parametric VaR, and Cornish–Fisher VaR, which adjusts the normal quantile for skewness and excess kurtosis — on negatively skewed data it is correctly larger than the Gaussian VaR (a unit test asserts this). The Portfolio page translates VaR and CVaR into money (“on a bad day expect to lose at least ₹4,800…”). The <b>min-CVaR objective</b> uses the Rockafellar–Uryasev formulation with soft-plus smoothing and an exact inner minimisation over ζ; it lands within 1 % of the HiGHS LP optimum. The health score's crash-resilience component uses maximum drawdown, which beginners understand better than tail averages.</p>`,
    follow: `“How stable is a 95 % CVaR from three years of daily data?” → only ~38 tail observations; the estimate is noisy, which is why it is shown with context and not used as the only risk measure.`,
  },
  {
    q: `How does the client know there is new data — and how do you guarantee it never mixes an old snapshot with new history files, given CDN and service-worker caching?`,
    probe: `Caching, consistency and the subtle failure modes of static publishing.`,
    a: `<p>There are three caches between the user and the files: GitHub Pages' Fastly CDN (fixed <code>max-age=600</code>), the browser HTTP cache, and a Workbox service worker. Naively polling <code>snapshot.json</code> and <code>history/X.json</code> invites <b>torn reads</b>: a fresh snapshot with a stale history from a different run.</p>
<p>The fix is a single mutable pointer. Only <code>manifest.json</code> is fetched by plain URL — with <code>cache: 'no-cache'</code> (conditional revalidation every poll) and a NetworkFirst service-worker rule with a 4-second timeout so the app still opens offline. The manifest lists a content hash (FNV-1a of the exact bytes) for the snapshot and every history file. All other requests carry <code>?v=&lt;hash&gt;</code>, which makes each URL immutable: React Query caches them with <code>staleTime: Infinity</code>, and the service worker uses CacheFirst. A client reading manifest version N can only ever request files from version N. History files whose bytes didn't change keep their hash and are not re-downloaded.</p>
<p>Deploys are atomic at the Pages level (one artifact), and the post-deploy smoke test waits until the live manifest's <code>generatedAt</code> equals the build's before marking the run green. Residual window: an edge can serve the previous manifest for up to 10 minutes — consistent, merely older.</p>`,
    follow: `“Why query-string hashes instead of hashed filenames?” → stable paths make the previous-deploy fallback and debugging trivial; Fastly keys on the full URL, so invalidation is still exact.`,
  },
  {
    q: `Why run the analytics in a Web Worker? How does data cross the boundary, what does that cost, and how do you avoid recomputing?`,
    probe: `Front-end performance engineering beyond the framework.`,
    a: `<p>A max-Sharpe solve takes ~9 ms, but a frontier with 40 points, 1,500 random portfolios, five special portfolios and an analysis with stress tests and factor regressions adds up to hundreds of milliseconds, and a 20-year walk-forward about a second. On the main thread that freezes typing in the holdings editor. The worker keeps the UI at 60 fps regardless.</p>
<p><b>Boundary</b>: Comlink wraps <code>postMessage</code> in typed async RPC. Inputs are structured-cloned — a 10-asset, 20-year request is ~100 k numbers, which clones in a few milliseconds; outputs are decimated to ≤ 700 points per series before crossing back. Transferable ArrayBuffers would avoid copies, but at these sizes the gain doesn't justify the API complexity.</p>
<p><b>Avoiding recomputation</b>: every worker call is a React Query query whose key is a <i>fingerprint</i> of the request — ids, weights and settings verbatim, but series summarised by length, first and last date and last value, so keys stay small and computing them is cheap. Identical requests are de-duplicated and cached; <code>keepPreviousData</code> shows the previous result at reduced opacity while a new one computes; holdings input is debounced by 350 ms. Derived arrays are memoised so the request object only changes when its inputs do.</p>`,
    follow: `“Would WebAssembly help?” → for n in the hundreds or Monte Carlo with millions of paths, yes (SIMD); for current sizes JS JIT is within ~2× and keeps one codebase.`,
  },
  {
    q: `A senior engineer says: “Numerical code belongs in Python. Why didn't you use FastAPI with NumPy, CVXPY and a database?” Defend your choice.`,
    probe: `Architectural reasoning under pushback; knowing the costs of your own choice.`,
    a: `<p>I'd agree for a research desk. For this product the constraints point the other way:</p>
<ul><li><b>Cost &amp; availability</b>: a Python API needs an always-on host. Free tiers sleep (30-second cold starts) or expire; the requirement was permanent, free hosting. A static site plus a batch job has no idle cost and no cold start.</li>
<li><b>Privacy</b>: portfolio analysis on the server means sending holdings to it. In the browser, portfolios never leave the device — with no accounts, no GDPR surface and no breach risk.</li>
<li><b>Scalability</b>: per-user compute happens on users' devices; serving a million users costs the same as serving one.</li>
<li><b>One implementation</b>: the pipeline needs the same statistics the browser shows; TypeScript lets both use one engine. Pyodide would ship a ~10 MB runtime to every visitor.</li></ul>
<p>The costs are real: no BLAS (fine at n ≤ 100, where a 100×100 Jacobi decomposition takes milliseconds), no off-the-shelf convex solver (hence a custom FISTA with exact projections), and the burden of proof falls on me. That is why Python stays in the repository as the <b>oracle</b>: CI regenerates golden fixtures with scikit-learn, PyPortfolioOpt and CVXPY and the TypeScript engine must match them. The architecture would change if requirements did — e.g. thousands of assets or proprietary data would justify a server.</p>`,
    follow: `“What about float precision in JS?” → JS numbers are IEEE-754 doubles, the same as NumPy's float64; the differences are summation order and libm, covered by Neumaier-compensated sums where it matters and by test tolerances.`,
  },
  {
    q: `How would this scale to 10,000 instruments and a million daily users? What breaks first?`,
    probe: `Scalability reasoning: identify the real bottlenecks rather than reciting “add Kubernetes”.`,
    a: `<p><b>Users</b>: almost nothing breaks — reads are static files on a CDN, and all per-user compute runs on the client. At a million users the first issue is GitHub Pages' soft bandwidth limit (~100 GB/month) and terms of service; the fix is moving the same artifact to a commercial CDN (Cloudflare Pages / R2 + CDN) with proper cache headers — a config change.</p>
<p><b>Instruments</b> — this is where it breaks, in order: (1) <b>ingestion</b>: 10,000 full-history requests per hour would get the job blocked; switch to a licensed bulk/end-of-day feed, incremental updates with a state store, and fan-out across a job matrix. (2) <b>Snapshot size</b>: ~1 KB per instrument → 10 MB; shard it (per market/sector), keep a compact index for search, lazy-load detail. (3) <b>Client analytics</b> stay fine because a user's portfolio is still 5–50 assets, but universe-wide optimisation would not: an n = 10,000 covariance has 50 M entries. Use a factor model Σ = BFBᵀ + D (O(nk)), which also improves estimation, and run screening server-side. (4) <b>Pipeline compute</b>: per-asset analytics are embarrassingly parallel; the HMM and model portfolios are per market. A matrix strategy or a small worker pool handles it.</p>
<p><b>Features that would force a backend</b>: accounts with cross-device sync (an edge KV/SQLite like Cloudflare D1), alerts (push notifications need a server-side scheduler), or real-time quotes (a streaming proxy).</p>`,
    follow: `“How would you make ingestion incremental safely?” → fetch the last month, compare overlapping adjusted closes; any divergence beyond tolerance signals a dividend/split re-adjustment → refetch that symbol's full history.`,
  },
  {
    q: `Your app effectively tells beginners what to buy. What are the regulatory and ethical risks, and how does the design mitigate them?`,
    probe: `Product judgement and responsibility — increasingly asked of engineers in fintech.`,
    a: `<p>In India, giving personalised investment advice for consideration requires SEBI registration as an Investment Adviser; in the US the analogue is the Investment Advisers Act and FINRA rules. Frontier is designed and labelled as an <b>educational tool</b>: it charges nothing, has no affiliate or broker incentives, and every page carries the disclaimer that it is not advice.</p>
<p>Design choices that reduce harm: (1) the questionnaire separates <b>risk tolerance</b> from <b>risk capacity</b> and applies hard <b>caps</b> — an emergency fund, a horizon under three years, or “I'd sell everything in a crash” limit the profile regardless of other answers; (2) model portfolios are diversified, low-cost index ETFs with <b>no return forecasts</b>, so they can't encode last decade's winners; (3) every recommendation shows its downside first-class: worst drawdown in money, worst calendar year, the 10th-percentile outcome; (4) trend scores are explicitly described as descriptions of the past, not predictions; (5) crypto is flagged when above 10 % with plain guidance; (6) no dark patterns: nothing is sold, nothing is tracked.</p>
<p>What I'd add before a real launch: a legal review, suitability language reviewed by a registered adviser, clearer data-licensing (Yahoo's terms), and accessibility testing with real users.</p>`,
    follow: `“Isn't showing a ‘Strong’ score on a stock an implicit buy signal?” → arguably, which is why the copy says “describes recent price behaviour… not a prediction” and why model portfolios never use it.`,
  },
  {
    q: `How do you test numerical code? Which tolerances did you choose and why? Give a real example where a test caught a bug.`,
    probe: `Testing maturity for non-deterministic and floating-point code.`,
    a: `<p>Three layers. <b>Golden tests</b> compare against independent reference implementations on byte-identical inputs; tolerances follow the algorithm: 1e-15 for closed forms (Ledoit–Wolf), 1e-12 to 1e-13 for deterministic algorithms (HRP, Black–Litterman), and for convex programs I compare the <i>objective</i> (ours ≥ reference − 1e-6) rather than weights, because interior-point solvers stop at ~1e-8 duality gaps and degenerate problems have multiple optimal weight vectors. <b>Property tests</b> check invariants: projections are feasible, idempotent and satisfy KKT (shared shift on free coordinates) over 200 random cases; the frontier is monotone; the tangency beats every random portfolio; risk contributions match arbitrary budgets. <b>Analytic tests</b> compare to closed forms: zero-volatility Monte Carlo vs the SIP formula; the lognormal median CAGR ≈ e^(μ−σ²/2) − 1 with 20,000 paths; HMM parameter recovery on data with known regimes.</p>
<p><b>Real catches</b>: (1) the OLS test failed by 2e-9 against NumPy's <code>lstsq</code>. A “harmless” default ridge of 1e-12·trace(XᵀX) was biasing coefficients of small-scale regressors; I removed it and rely on Cholesky jitter only for true collinearity. (2) The ERC test “failed” by 5e-6. Measuring risk contributions showed ours equal to 1e-10 and Clarabel's only to 8e-6 — the reference was the less accurate one, so the test now asserts the defining property and compares weights at solver tolerance. (3) The Monte Carlo drift bias in Q10. (4) The group-constraint performance cliff in Q6 surfaced as a 4.2-second test.</p>`,
    follow: `“How do you test randomness?” → every stochastic routine takes a seed (sfc32 PRNG); tests assert reproducibility and statistical properties with tolerances sized to the Monte Carlo error.`,
  },
  {
    q: `What is look-ahead bias? Name every place it could creep into Frontier — including the ones you didn't fully fix.`,
    probe: `Intellectual honesty and research rigour. Volunteering limitations scores highly.`,
    a: `<p>Look-ahead bias is using information in a decision that wasn't available at the time, which makes backtests look better than reality. Audit:</p>
<ul><li><b>Regimes</b> — avoided: live signals use filtered, not smoothed, HMM probabilities.</li>
<li><b>Walk-forward tests</b> — avoided: each rebalance uses only the trailing 252 days, prices at the rebalance close, and costs on turnover.</li>
<li><b>Model portfolio backtests</b> — <i>partially present</i>: sleeve weights come from covariances of the last five years and are then applied to the whole history. ERC uses only covariances (more stable than returns), but the reported backtest is still mildly in-sample. The honest fix is to compute each year's weights from data before that year; I'd present that version first.</li>
<li><b>Survivorship bias</b> — <i>present</i>: the stock universe is today's largest companies, so their 10-year histories are winners by construction. The app focuses beginners on index ETFs, and the Learn page explains it, but single-stock backtests overstate.</li>
<li><b>Adjusted prices</b> — subtle: Yahoo's adjusted closes are rewritten after each dividend; every run refetches full history, so the data is internally consistent, but historical values change slightly over time.</li>
<li><b>Proxies in stress tests</b> — disclosed: before an ETF existed, its index proxy is used, and the UI reports how much of the portfolio was covered by proxies.</li>
<li><b>Signal ranks</b> — avoided: peer-group percentiles use only current cross-sectional data.</li></ul>`,
    follow: `“How big is survivorship bias?” → studies put it at roughly 1–2 % per year for US equity fund databases; for a mega-cap list chosen today it can be much larger.`,
  },
  {
    q: `Security review: there is no backend. What can still go wrong?`,
    probe: `Threat modelling for serverless and static apps, supply chain and CI.`,
    a: `<ul><li><b>XSS via share links</b>: <code>#p=…</code> decodes attacker-controlled JSON. It is decompressed, parsed, type-checked (currency enum, finite positive weights, ≤ 40 holdings, name truncated) and rendered only through React's escaping; there is no <code>dangerouslySetInnerHTML</code>. Unknown instrument IDs are ignored.</li>
<li><b>Third-party data</b>: WebSocket frames and market data are parsed defensively and rendered as text; a compromised feed could show wrong prices but not execute code.</li>
<li><b>Supply chain</b> — the biggest real risk: a malicious npm update would run in CI with a token and ship to users. Mitigations: lockfile + <code>npm ci</code>, Dependabot PRs reviewed by CI, CodeQL, major-pinned first-party Actions. Next steps: pin Actions to commit SHAs, enable npm provenance checks, add an SRI/CSP policy.</li>
<li><b>CI permissions</b>: <code>GITHUB_TOKEN</code> is least-privilege per workflow (deploy: <code>pages</code> + <code>id-token</code>; screenshots: <code>contents: write</code>; keepalive: <code>actions: write</code>). No long-lived secrets exist to steal.</li>
<li><b>Data poisoning</b>: if upstream data were manipulated, the validation gate catches structural anomalies, not plausible lies — cross-source checks would be the next layer.</li>
<li><b>Headers</b>: GitHub Pages can't set CSP, HSTS-preload or frame-ancestors headers. A <code>&lt;meta http-equiv="Content-Security-Policy"&gt;</code> covers most of CSP (not frame-ancestors) — a listed gap.</li>
<li><b>Local data</b>: localStorage is readable by any script on the origin — another reason the dependency surface matters — but it holds only the user's own portfolios.</li></ul>`,
    follow: `“Would you sign builds?” → Pages deployments use OIDC (<code>id-token: write</code>); adding artifact attestations is a one-line addition.`,
  },
  {
    q: `If you had two more weeks, what would you change first? What technical debt are you carrying?`,
    probe: `Self-awareness and prioritisation. Strong candidates rank by user impact and risk.`,
    a: `<ol><li><b>Data-vendor risk</b>: add a licensed end-of-day source behind <code>sources/</code> and use Yahoo as fallback, plus cross-source validation on core instruments.</li>
<li><b>Point-in-time model backtests</b>: recompute sleeve weights each year from prior data, removing the remaining in-sample bias in the Advisor's statistics.</li>
<li><b>Incremental ingestion</b> with dividend-revision detection, cutting upstream load by ~95 % and enabling more instruments.</li>
<li><b>Factor model covariance</b> (Σ = BFBᵀ + D) for larger universes and better conditioning.</li>
<li><b>Tax &amp; cost realism</b>: tax-lot tracking, Indian LTCG/STCG and US capital-gains rules in the rebalancer; turnover-penalised optimisation.</li>
<li><b>Front-end tests</b>: component tests for charts and visual regression snapshots; today the UI is covered by E2E only.</li>
<li><b>Hardening</b>: CSP meta tag, SHA-pinned Actions, artifact attestations.</li>
<li><b>Product</b>: optional encrypted sync, alerts, i18n (Hindi), and moderated user testing with real beginners.</li></ol>
<p>Debt I'm consciously carrying: the unofficial data source; weekday forward-fill on holidays; overlapping asset-class constraints use the slower Dykstra path; the Market Mood index is a heuristic composite (transparent, but not validated against future returns).</p>`,
    follow: `“Which of these would you do first if you could only pick one?” → the data vendor: every feature depends on it and it is the only single point of failure.`,
  },
];

export const RAPID = `
<h1 class="section" id="s7"><span class="num">7</span>Rapid-fire round, numbers to memorise, honest limitations</h1>
<h2>7.1 Rapid-fire questions (answer in one breath)</h2>
<table>
  <tr><th style="width:42%">Question</th><th>Answer</th></tr>
  <tr><td>Why weekly returns for beta?</td><td>Asynchronous closes (NSE vs NYSE) bias daily betas towards zero; weekly sampling dilutes the one-day offset.</td></tr>
  <tr><td>Sharpe vs Sortino?</td><td>Sortino divides by downside deviation (returns below the risk-free rate), so upside volatility isn't penalised.</td></tr>
  <tr><td>What is effective number of bets?</td><td>exp(entropy) of risk contributions of uncorrelated principal portfolios (Meucci 2009): 1 = one hidden bet, n = n independent bets.</td></tr>
  <tr><td>Why is CAGR ≠ average return?</td><td>Compounding: +50 % then −50 % is −25 %. CAGR ≈ arithmetic mean − σ²/2.</td></tr>
  <tr><td>Why 6 significant digits in history files?</td><td>Rounding error &lt; 5e-7, far below daily-return noise for even the calmest asset; with delta-encoded dates files compress to ~19 KB.</td></tr>
  <tr><td>Why FNV-1a for content hashes?</td><td>Cache keys, not security: fast, tiny, deterministic. Collisions only cost a cache miss window.</td></tr>
  <tr><td>Why cron at minute 17?</td><td>GitHub's scheduler is most congested at :00; off-peak minutes start more reliably.</td></tr>
  <tr><td>What is the keepalive for?</td><td>GitHub disables schedules in public repos after 60 days without activity; re-enabling via the API resets the clock.</td></tr>
  <tr><td>Why deterministic NLG instead of an LLM?</td><td>Free, instant, offline, reproducible, unit-testable — and it can't hallucinate a number.</td></tr>
  <tr><td>Why separate tolerance and capacity?</td><td>Feeling brave doesn't make a two-year horizon long; regulators require suitability on both.</td></tr>
  <tr><td>How are model portfolios built?</td><td>Profile sets stocks/stabilisers/gold; ERC inside each sleeve (Ledoit–Wolf, 5y weekly); cash takes half of a mixed sleeve; monthly rebalanced backtest with 5 bp costs.</td></tr>
  <tr><td>Forward return assumption?</td><td>μ = ½·historical + ½·(r_f + 0.3σ): shrink halfway to a Sharpe-0.3 prior so a lucky decade isn't extrapolated.</td></tr>
  <tr><td>How do deep links work on Pages?</td><td>post-build copies index.html into a folder per route and per asset; 404.html covers the rest.</td></tr>
  <tr><td>What does the gate check?</td><td>zod schema, core IDs, ≥ 85 % coverage, SPY ≤ 6 days old, finite positive prices, ≥ 6 model portfolios.</td></tr>
  <tr><td>Why a validated colour palette?</td><td>~8 % of men have red-green colour-vision deficiency; returns use blue ↔ red diverging scales and every signal has an icon + label.</td></tr>
</table>
<h2>7.2 Numbers to memorise</h2>
<div class="grid3">
  <div class="kpi"><div class="v">100</div><div class="l">instruments (98 fetched + 2 cash)</div></div>
  <div class="kpi"><div class="v">hourly</div><div class="l">weekday refresh; 4-hourly weekends</div></div>
  <div class="kpi"><div class="v">113</div><div class="l">tests: 87 unit/golden + 26 E2E</div></div>
  <div class="kpi"><div class="v">1e-15</div><div class="l">Ledoit–Wolf agreement with scikit-learn</div></div>
  <div class="kpi"><div class="v">9 ms</div><div class="l">max-Sharpe (6 assets), was 52 ms</div></div>
  <div class="kpi"><div class="v">~220 KB</div><div class="l">gzip initial JS+CSS; worker 24 KB</div></div>
  <div class="kpi"><div class="v">86 KB</div><div class="l">gzip snapshot for all dashboards</div></div>
  <div class="kpi"><div class="v">85 %</div><div class="l">minimum coverage to publish</div></div>
  <div class="kpi"><div class="v">$0</div><div class="l">monthly running cost</div></div>
</div>
<h2>7.3 Honest limitations (say them before you're asked)</h2>
<ul>
  <li>Market data comes from Yahoo's unofficial endpoints; for production I'd license a vendor.</li>
  <li>Stock universe has survivorship bias; model-portfolio backtests are mildly in-sample (Q18).</li>
  <li>Stocks refresh hourly, not in real time; only crypto streams live.</li>
  <li>Holiday forward-fill slightly understates multi-market volatility.</li>
  <li>Taxes, lot-level cost basis and bid-ask spreads are not modelled (flat bp costs only).</li>
  <li>Market Mood is a transparent heuristic, not a validated predictor.</li>
  <li>No accounts or sync; clearing browser storage clears portfolios (share links are the backup).</li>
</ul>
<div class="box good"><h4>Closing line for interviews</h4><p>“The interesting part wasn't any single algorithm — it was making a system that is cheap enough to run forever, careful enough that a beginner can trust its numbers, and honest about what it doesn't know. Every number on the screen is reproducible, tested against an independent reference, and explained in a sentence.”</p></div>`;
