/**
 * The investable universe and reference instruments — built only from data
 * sources that permit automated access and republication:
 *
 *   AMFI      Indian mutual-fund NAVs (public disclosures; Direct–Growth plans)
 *   FRED      public-domain Treasury yields, T-bills, USD/INR, dollar index,
 *             Brent; VIX (citation required)
 *   Binance   public crypto market data
 *   ECB       euro reference rates (USD/INR cross) via Frankfurter
 *   French    Fama–French academic factor returns (Tuck/Dartmouth)
 *
 * Curated for a beginner: every Indian holding is a real, low-cost fund you
 * can buy today; US exposure is expressed through index funds' NAVs and
 * Treasury indices modelled from public yields. Descriptions are written for
 * someone who has never invested before.
 */
import type { AssetMeta } from '@frontier/contracts';

export type SourceSpec =
  /**
   * AMFI scheme NAV, optionally chain-linked to an older (Regular-plan) scheme,
   * or — for US-equity funds — to the Fama–French US market return in rupees.
   */
  | { type: 'amfi'; code: number; backfill?: number; backfillUs?: 'french-mkt' }
  /** An INR fund re-expressed in USD (rebased to 100 at its first date). */
  | { type: 'inr-to-usd'; from: string }
  | { type: 'fred'; series: string }
  /** Constant-maturity Treasury total-return index modelled from FRED yields. */
  | { type: 'bond'; series: string; maturity: number }
  /** Binance USDT pair; optional older backfill from another instrument (in USD). */
  | { type: 'binance'; symbol: string; backfill?: { id: string; inrToUsd: boolean } }
  /** USD/INR: FRED DEXINUS history + ECB fixings after FRED's last print. */
  | { type: 'usdinr' }
  /** Cash accruing a T-bill yield (percent p.a.). */
  | { type: 'tbill'; series: string }
  /** Fama–French daily factor as a long-short level index. */
  | { type: 'french'; file: 'factors' | 'momentum'; column: string };

type Def = Omit<AssetMeta, 'investable' | 'short' | 'symbol'> & {
  investable?: boolean;
  short?: string;
  symbol?: string;
  src: SourceSpec;
};

const AMFI_URL = 'https://www.amfiindia.com/net-asset-value';

/** An Indian Direct–Growth fund. */
const fund = (
  d: Omit<Def, 'kind' | 'currency' | 'src' | 'provenance'> & {
    code: number;
    backfill?: number;
    backfillUs?: 'french-mkt';
    fundName: string;
    currency?: 'INR';
  },
): Def => {
  const { code, backfill, backfillUs, fundName, ...rest } = d;
  const notes = [
    backfill &&
      ` Before the Direct plan existed (2013) the history uses the Regular plan (scheme ${backfill}), chain-linked — about 0.5–1 % a year more in fees.`,
    backfillUs &&
      ' Before the fund launched (April 2020) the history is the Fama–French US stock-market return converted to rupees.',
  ].filter(Boolean);
  return {
    kind: 'fund',
    currency: 'INR',
    benchmark: 'NIFTY50',
    ...rest,
    src: { type: 'amfi', code, backfill, backfillUs },
    provenance: {
      provider: backfillUs ? 'AMFI · Fama–French · FRED' : 'AMFI',
      detail: `Daily NAV of ${fundName} — Direct Plan, Growth (AMFI scheme ${code}).${notes.join('')}`,
      url: AMFI_URL,
    },
  };
};

const DEFS: Def[] = [
  // ── India: broad market ────────────────────────────────────────────────────
  fund({
    id: 'NIFTY50',
    symbol: 'NIFTY50',
    name: 'UTI Nifty 50 Index Fund',
    short: 'Nifty 50',
    fundName: 'UTI Nifty 50 Index Fund',
    code: 120716,
    backfill: 100822,
    assetClass: 'equity',
    region: 'IN',
    description:
      "India's 50 largest listed companies in one low-cost index fund — the sensible core of almost any Indian portfolio.",
    role: 'Core growth engine',
    tags: ['size'],
  }),
  fund({
    id: 'NIFTYNEXT50',
    symbol: 'NEXT50',
    name: 'ICICI Prudential Nifty Next 50 Index Fund',
    short: 'Nifty Next 50',
    fundName: 'ICICI Prudential Nifty Next 50 Index Fund',
    code: 120684,
    backfill: 112957,
    assetClass: 'equity',
    region: 'IN',
    description:
      "The 50 companies ranked just below the Nifty 50 — tomorrow's potential giants, with bigger swings.",
    role: 'Large/mid-cap growth',
    proxy: 'NIFTY50',
    tags: ['size'],
  }),
  fund({
    id: 'NIFTY500',
    symbol: 'NIFTY500',
    name: 'Motilal Oswal Nifty 500 Index Fund',
    short: 'Nifty 500',
    fundName: 'Motilal Oswal Nifty 500 Index Fund',
    code: 147625,
    assetClass: 'equity',
    region: 'IN',
    description:
      'Five hundred Indian companies — large, mid and small — covering about 90 % of the market in a single fund.',
    role: 'Whole-market core',
    proxy: 'NIFTY50',
    tags: ['size'],
  }),
  fund({
    id: 'MIDCAP150',
    symbol: 'MID150',
    name: 'Motilal Oswal Nifty Midcap 150 Index Fund',
    short: 'Midcap 150',
    fundName: 'Motilal Oswal Nifty Midcap 150 Index Fund',
    code: 147622,
    assetClass: 'equity',
    region: 'IN',
    description:
      'Medium-sized Indian companies: faster growth than the giants, deeper falls when markets turn.',
    role: 'Mid-cap growth',
    proxy: 'NIFTY50',
    tags: ['size'],
  }),
  fund({
    id: 'SMALLCAP250',
    symbol: 'SML250',
    name: 'Motilal Oswal Nifty Smallcap 250 Index Fund',
    short: 'Smallcap 250',
    fundName: 'Motilal Oswal Nifty Smallcap 250 Index Fund',
    code: 147623,
    assetClass: 'equity',
    region: 'IN',
    description:
      'Two hundred and fifty smaller Indian companies — the most volatile part of the stock market, for long horizons only.',
    role: 'Small-company tilt',
    proxy: 'NIFTY50',
    tags: ['size'],
  }),
  // ── India: strategies (smart beta) ─────────────────────────────────────────
  fund({
    id: 'EQUALWEIGHT50',
    symbol: 'N50EW',
    name: 'DSP Nifty 50 Equal Weight Index Fund',
    short: 'Nifty 50 Equal Weight',
    fundName: 'DSP Nifty 50 Equal Weight Index Fund',
    code: 141877,
    assetClass: 'equity',
    region: 'IN',
    description:
      'The same 50 companies as the Nifty 50, but 2 % each — so no single giant dominates your money.',
    role: 'Concentration hedge',
    proxy: 'NIFTY50',
    tags: ['strategy'],
  }),
  fund({
    id: 'MOMENTUM30',
    symbol: 'MOM30',
    name: 'UTI Nifty 200 Momentum 30 Index Fund',
    short: 'Momentum 30',
    fundName: 'UTI Nifty 200 Momentum 30 Index Fund',
    code: 148703,
    assetClass: 'equity',
    region: 'IN',
    description:
      'The 30 stocks with the strongest recent price trends, reshuffled twice a year. Rides winners — and suffers when trends reverse.',
    role: 'Momentum factor',
    proxy: 'NIFTY50',
    tags: ['strategy'],
  }),
  fund({
    id: 'LOWVOL30',
    symbol: 'LOWVOL30',
    name: 'ICICI Prudential Nifty 100 Low Volatility 30 ETF FoF',
    short: 'Low Volatility 30',
    fundName: 'ICICI Prudential Nifty 100 Low Volatility 30 ETF FOF',
    code: 148822,
    assetClass: 'equity',
    region: 'IN',
    description:
      'Thirty large companies whose share prices have moved the least — a calmer way to own stocks.',
    role: 'Defensive equity',
    proxy: 'NIFTY50',
    tags: ['strategy'],
  }),
  fund({
    id: 'VALUE20',
    symbol: 'VALUE20',
    name: 'Nippon India Nifty 50 Value 20 Index Fund',
    short: 'Nifty 50 Value 20',
    fundName: 'Nippon India Nifty 50 Value 20 Index Fund',
    code: 148721,
    assetClass: 'equity',
    region: 'IN',
    description:
      'The 20 Nifty 50 companies that look cheapest relative to their earnings, assets and dividends.',
    role: 'Value factor',
    proxy: 'NIFTY50',
    tags: ['strategy'],
  }),
  fund({
    id: 'QUALITY30',
    symbol: 'QUAL30',
    name: 'Edelweiss Nifty 100 Quality 30 Index Fund',
    short: 'Quality 30',
    fundName: 'Edelweiss Nifty 100 Quality 30 Index Fund',
    code: 149254,
    assetClass: 'equity',
    region: 'IN',
    description:
      'Thirty highly profitable, low-debt companies with steady earnings — businesses that tend to hold up in bad times.',
    role: 'Quality factor',
    proxy: 'NIFTY50',
    tags: ['strategy'],
  }),
  // ── India: sectors & themes ────────────────────────────────────────────────
  ...(
    [
      [
        'NIFTYBANK',
        'BANK',
        'Nifty Bank',
        'Motilal Oswal Nifty Bank Index Fund',
        147620,
        'Financials',
        "India's biggest banks — a concentrated bet on credit growth and the economy.",
      ],
      [
        'NIFTYIT',
        'IT',
        'Nifty IT',
        'ICICI Prudential Nifty IT Index Fund',
        150468,
        'Technology',
        'Software and IT-services exporters such as Infosys and TCS — they earn largely in dollars.',
      ],
      [
        'NIFTYPHARMA',
        'PHARMA',
        'Nifty Pharma',
        'ICICI Prudential Nifty Pharma Index Fund',
        150930,
        'Health Care',
        'Indian drug makers selling generics and specialty medicines at home and abroad.',
      ],
      [
        'FMCG',
        'FMCG',
        'FMCG',
        'ICICI Prudential FMCG Fund',
        120587,
        'Consumer Staples',
        'Everyday-essentials companies — food, soap, toothpaste. Steady when the economy slows. (Actively managed.)',
      ],
      [
        'NIFTYAUTO',
        'AUTO',
        'Nifty Auto',
        'ICICI Prudential Nifty Auto Index Fund',
        150643,
        'Consumer Discretionary',
        'Car, two-wheeler and auto-parts makers — very sensitive to the economic cycle.',
      ],
      [
        'MANUFACTURING',
        'MFG',
        'Manufacturing',
        'Mirae Asset Nifty India Manufacturing ETF Fund of Fund',
        149790,
        'Industrials',
        'Factories and industrial companies — a bet on India becoming a manufacturing hub.',
      ],
      [
        'DEFENCE',
        'DEFENCE',
        'Defence',
        'Motilal Oswal Nifty India Defence Index Fund',
        152712,
        'Industrials',
        'Defence manufacturers and shipyards. A young, hot and very volatile theme.',
      ],
      [
        'REALTY',
        'REALTY',
        'Realty',
        'HDFC Nifty Realty Index Fund',
        152521,
        'Real Estate',
        'Listed property developers — one of the most cyclical corners of the market.',
      ],
      [
        'CONSUMPTION',
        'CONSUMP',
        'Consumption',
        'SBI Nifty India Consumption Index Fund',
        153015,
        'Consumer Discretionary',
        'Companies selling to Indian households — from cars and phones to jewellery and food.',
      ],
    ] as const
  ).map(([id, symbol, short, fundName, code, sector, description]) =>
    fund({
      id,
      symbol,
      name: fundName,
      short,
      fundName,
      code,
      assetClass: 'equity',
      region: 'IN',
      sector,
      description,
      role: 'Sector bet',
      proxy: 'NIFTY50',
      tags: ['sector'],
    }),
  ),
  // ── India: global equity in rupees ─────────────────────────────────────────
  fund({
    id: 'SP500-INR',
    symbol: 'SPX-INR',
    name: 'Motilal Oswal S&P 500 Index Fund',
    short: 'S&P 500 (₹)',
    fundName: 'Motilal Oswal S&P 500 Index Fund',
    code: 148381,
    backfillUs: 'french-mkt',
    assetClass: 'equity',
    region: 'US',
    description:
      "America's 500 largest companies, bought in rupees — gains when US stocks rise and when the rupee weakens.",
    role: 'Global diversifier',
    proxy: 'US-LARGE',
    tags: ['global'],
  }),
  fund({
    id: 'NASDAQ100-INR',
    symbol: 'NDX-INR',
    name: 'Motilal Oswal Nasdaq 100 Fund of Fund',
    short: 'Nasdaq-100 (₹)',
    fundName: 'Motilal Oswal Nasdaq 100 Fund of Fund',
    code: 145552,
    assetClass: 'equity',
    region: 'US',
    description:
      'The 100 biggest Nasdaq companies — Apple, Microsoft, NVIDIA and other tech giants — in rupees.',
    role: 'Global growth',
    proxy: 'US-LARGE',
    tags: ['global'],
  }),
  // ── India: gold, silver, bonds, cash ───────────────────────────────────────
  fund({
    id: 'GOLD-INR',
    symbol: 'GOLD',
    name: 'Nippon India Gold Savings Fund',
    short: 'Gold (₹)',
    fundName: 'Nippon India Gold Savings Fund',
    code: 118663,
    backfill: 105463,
    assetClass: 'commodity',
    region: 'IN',
    description:
      'Physical gold in rupee terms, without lockers or making charges. Gains when gold rises and when the rupee weakens.',
    role: 'Crisis & inflation hedge',
  }),
  fund({
    id: 'SILVER-INR',
    symbol: 'SILVER',
    name: 'Nippon India Silver ETF FoF',
    short: 'Silver (₹)',
    fundName: 'Nippon India Silver ETF FOF',
    code: 149760,
    assetClass: 'commodity',
    region: 'IN',
    description:
      'Physical silver in rupees — part precious metal, part industrial metal, far bumpier than gold.',
    role: 'Precious-metal satellite',
    proxy: 'GOLD-INR',
  }),
  fund({
    id: 'GILT10Y',
    symbol: 'GILT10Y',
    name: 'SBI 10 Year Constant Maturity Gilt Fund',
    short: '10Y Govt Bonds (₹)',
    fundName: 'SBI 10 Year Constant Maturity Gilt Fund',
    code: 120137,
    backfill: 101002,
    assetClass: 'bond',
    region: 'IN',
    description:
      'Government of India bonds with about ten years to maturity — no default risk, but prices move when interest rates do.',
    role: 'Shock absorber',
  }),
  fund({
    id: 'CORPBOND',
    symbol: 'CORPBND',
    name: 'HDFC Corporate Bond Fund',
    short: 'Corporate Bonds (₹)',
    fundName: 'HDFC Corporate Bond Fund',
    code: 118987,
    assetClass: 'bond',
    region: 'IN',
    description:
      'Loans to highly rated Indian companies and PSUs — a little more interest than government bonds.',
    role: 'Income',
    proxy: 'GILT10Y',
  }),
  // ── United States ──────────────────────────────────────────────────────────
  {
    id: 'US-LARGE',
    symbol: 'US500',
    name: 'US Large Caps (S&P 500 index fund, in USD)',
    short: 'US Large Caps',
    kind: 'index',
    assetClass: 'equity',
    region: 'US',
    currency: 'USD',
    description:
      'The 500 largest US companies — the backbone of global investing. Hold it through any low-cost S&P 500 index fund.',
    role: 'Core growth engine',
    benchmark: 'US-LARGE',
    src: { type: 'inr-to-usd', from: 'SP500-INR' },
    provenance: {
      provider: 'AMFI · FRED · ECB · Fama–French',
      detail:
        'An index (first day = 100) built from the daily NAV of the Motilal Oswal S&P 500 Index Fund (AMFI 148381) converted to dollars at the FRED/ECB USD-INR rate, so it includes dividends net of fund costs. Before the fund launched (April 2020) it follows the Fama–French US stock-market return.',
      url: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html',
    },
  },
  {
    id: 'US-TECH',
    symbol: 'NDX',
    name: 'US Tech Giants (Nasdaq-100 fund, in USD)',
    short: 'US Tech (Nasdaq-100)',
    kind: 'index',
    assetClass: 'equity',
    region: 'US',
    currency: 'USD',
    description:
      'The 100 largest Nasdaq companies, dominated by big technology firms. Higher growth, bigger swings.',
    role: 'Growth & innovation tilt',
    benchmark: 'US-LARGE',
    proxy: 'US-LARGE',
    src: { type: 'inr-to-usd', from: 'NASDAQ100-INR' },
    provenance: {
      provider: 'AMFI · FRED · ECB',
      detail:
        'An index (first day = 100) built from the daily NAV of the Motilal Oswal Nasdaq 100 Fund of Fund (AMFI 145552) converted to dollars at the FRED/ECB USD-INR rate.',
      url: AMFI_URL,
    },
  },
  ...(
    [
      [
        'UST2Y',
        'DGS2',
        2,
        '2Y Treasuries',
        'Short-term US government bonds: barely move, earn close to cash.',
        'Cash-like ballast',
      ],
      [
        'UST10Y',
        'DGS10',
        10,
        '10Y Treasuries',
        'Ten-year US government bonds — the classic counterweight to stocks.',
        'Core stabiliser',
      ],
      [
        'UST30Y',
        'DGS30',
        30,
        '30Y Treasuries',
        'Thirty-year US government bonds: very sensitive to interest rates, historically strong in stock crashes.',
        'Crash hedge',
      ],
    ] as const
  ).map(([id, series, maturity, short, description, role]): Def => ({
    id,
    symbol: id,
    name: `US ${maturity}-Year Treasury (modelled total return)`,
    short,
    kind: 'index',
    assetClass: 'bond',
    region: 'US',
    currency: 'USD',
    description: `${description} Hold it through any Treasury fund of similar maturity.`,
    role,
    benchmark: 'US-LARGE',
    tags: ['modelled'],
    src: { type: 'bond', series, maturity },
    provenance: {
      provider: 'FRED (US Treasury, public domain)',
      detail: `Total return of a constant-maturity ${maturity}-year par Treasury, rebuilt daily from the FRED ${series} yield: carry plus exact repricing for yield changes. No fund fees.`,
      url: `https://fred.stlouisfed.org/series/${series}`,
    },
  })),
  {
    id: 'GOLD-USD',
    symbol: 'XAU',
    name: 'Gold in US dollars (PAX Gold)',
    short: 'Gold ($)',
    kind: 'crypto',
    assetClass: 'commodity',
    region: 'GLOBAL',
    currency: 'USD',
    description:
      'The dollar price of gold, tracked through PAX Gold — a token backed one-for-one by vaulted London gold bars.',
    role: 'Crisis & inflation hedge',
    benchmark: 'US-LARGE',
    src: { type: 'binance', symbol: 'PAXGUSDT', backfill: { id: 'GOLD-INR', inrToUsd: true } },
    provenance: {
      provider: 'Binance · AMFI · FRED',
      detail:
        'PAXG/USDT daily closes from Binance public market data. Before August 2020 the history is the Indian gold fund converted to dollars (it also reflects Indian import-duty changes).',
      url: 'https://data-api.binance.vision',
    },
  },
  ...(
    [
      [
        'BTC-USD',
        'BTCUSDT',
        'Bitcoin',
        'BTC',
        'The original cryptocurrency with a fixed supply of 21 million coins. Extremely volatile.',
        undefined,
      ],
      [
        'ETH-USD',
        'ETHUSDT',
        'Ethereum',
        'ETH',
        'The blockchain behind most smart contracts, stablecoins and DeFi. Even more volatile than Bitcoin.',
        'BTC-USD',
      ],
      [
        'SOL-USD',
        'SOLUSDT',
        'Solana',
        'SOL',
        'A fast, low-fee blockchain. A young, highly speculative asset.',
        'BTC-USD',
      ],
    ] as const
  ).map(([id, symbol, name, sym, description, proxy]): Def => ({
    id,
    symbol: sym,
    name,
    short: name,
    kind: 'crypto',
    assetClass: 'crypto',
    region: 'GLOBAL',
    currency: 'USD',
    description,
    role: 'Speculative satellite',
    benchmark: 'US-LARGE',
    ...(proxy ? { proxy } : {}),
    src: { type: 'binance', symbol },
    provenance: {
      provider: 'Binance',
      detail: `${symbol.replace('USDT', '/USDT')} daily closes from Binance public market data (USDT ≈ US dollar).`,
      url: 'https://data-api.binance.vision',
    },
  })),
  // ── Reference instruments (not investable) ─────────────────────────────────
  {
    id: 'VIX',
    symbol: 'VIX',
    name: 'CBOE Volatility Index',
    short: 'VIX',
    kind: 'index',
    assetClass: 'volatility',
    region: 'US',
    currency: 'USD',
    description:
      'The market\'s "fear gauge": the volatility investors expect from US stocks over the next 30 days.',
    investable: false,
    src: { type: 'fred', series: 'VIXCLS' },
    provenance: {
      provider: 'Chicago Board Options Exchange via FRED',
      detail:
        'Source: Chicago Board Options Exchange, CBOE Volatility Index: VIX [VIXCLS], retrieved from FRED. Reprinted with permission.',
      url: 'https://fred.stlouisfed.org/series/VIXCLS',
    },
  },
  {
    id: 'US10Y',
    symbol: 'US10Y',
    name: 'US 10-Year Treasury Yield',
    short: 'US 10Y Yield',
    kind: 'rate',
    assetClass: 'rate',
    region: 'US',
    currency: 'USD',
    description:
      'The interest rate on 10-year US government debt — the anchor for mortgages and valuations worldwide.',
    investable: false,
    src: { type: 'fred', series: 'DGS10' },
    provenance: {
      provider: 'FRED (public domain)',
      detail: 'Market yield on US Treasury securities at 10-year constant maturity [DGS10].',
      url: 'https://fred.stlouisfed.org/series/DGS10',
    },
  },
  {
    id: 'US3M',
    symbol: 'US3M',
    name: 'US 3-Month Treasury Bill Yield',
    short: 'US 3M T-Bill',
    kind: 'rate',
    assetClass: 'rate',
    region: 'US',
    currency: 'USD',
    description: 'The short-term "risk-free" interest rate in US dollars.',
    investable: false,
    src: { type: 'fred', series: 'DTB3' },
    provenance: {
      provider: 'FRED (public domain)',
      detail: '3-month Treasury bill secondary-market rate [DTB3].',
      url: 'https://fred.stlouisfed.org/series/DTB3',
    },
  },
  {
    id: 'USDINR',
    symbol: 'USDINR',
    name: 'US Dollar / Indian Rupee',
    short: 'USD/INR',
    kind: 'fx',
    assetClass: 'currency',
    region: 'GLOBAL',
    currency: 'INR',
    description: 'How many rupees one US dollar buys. Rising means a weaker rupee.',
    investable: false,
    src: { type: 'usdinr' },
    provenance: {
      provider: 'FRED · European Central Bank',
      detail:
        'Federal Reserve H.10 noon rates [DEXINUS] for history, extended with the latest ECB euro reference rates (USD/INR cross) via Frankfurter.',
      url: 'https://fred.stlouisfed.org/series/DEXINUS',
    },
  },
  {
    id: 'DOLLAR',
    symbol: 'USD-IDX',
    name: 'US Dollar Index (broad, trade-weighted)',
    short: 'Dollar Index',
    kind: 'index',
    assetClass: 'currency',
    region: 'GLOBAL',
    currency: 'USD',
    description: "The dollar's value against the currencies of America's main trading partners.",
    investable: false,
    src: { type: 'fred', series: 'DTWEXBGS' },
    provenance: {
      provider: 'FRED (Federal Reserve, public domain)',
      detail: 'Nominal broad US dollar index [DTWEXBGS].',
      url: 'https://fred.stlouisfed.org/series/DTWEXBGS',
    },
  },
  {
    id: 'BRENT',
    symbol: 'BRENT',
    name: 'Brent Crude Oil (spot)',
    short: 'Brent Oil',
    kind: 'index',
    assetClass: 'commodity',
    region: 'GLOBAL',
    currency: 'USD',
    description:
      'The global benchmark price for a barrel of crude oil — it matters for inflation, the rupee and fuel prices.',
    investable: false,
    src: { type: 'fred', series: 'DCOILBRENTEU' },
    provenance: {
      provider: 'US EIA via FRED (public domain)',
      detail: 'Crude oil prices: Brent – Europe [DCOILBRENTEU].',
      url: 'https://fred.stlouisfed.org/series/DCOILBRENTEU',
    },
  },
  ...(
    [
      [
        'FF-SMB',
        'SMB',
        'Size factor (US)',
        'Small minus big: how much small US companies beat large ones.',
        'factors',
        'SMB',
      ],
      [
        'FF-HML',
        'HML',
        'Value factor (US)',
        'High minus low: how much cheap "value" stocks beat expensive "growth" stocks.',
        'factors',
        'HML',
      ],
      [
        'FF-MOM',
        'MOM',
        'Momentum factor (US)',
        'Winners minus losers: how much recent outperformers kept beating recent laggards.',
        'momentum',
        'Mom',
      ],
    ] as const
  ).map(([id, symbol, short, description, file, column]): Def => ({
    id,
    symbol,
    name: `Fama–French ${short}`,
    short,
    kind: 'index',
    assetClass: 'equity',
    region: 'US',
    currency: 'USD',
    description: `${description} An academic long-short portfolio used to explain where returns come from.`,
    investable: false,
    tags: ['factor'],
    src: { type: 'french', file, column },
    provenance: {
      provider: 'Kenneth R. French Data Library',
      detail: `Daily ${column} factor returns (Fama & French), cumulated into an index. Academic data, updated about monthly — it lags the market by several weeks.`,
      url: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html',
    },
  })),
];

/** Cash: a real liquid fund in India; T-bill accrual in the US. */
const CASH_DEFS: Def[] = [
  {
    id: 'CASH-INR',
    symbol: 'LIQUID',
    name: 'SBI Liquid Fund',
    short: 'Cash (liquid fund)',
    kind: 'cash',
    assetClass: 'cash',
    region: 'IN',
    currency: 'INR',
    description:
      'A liquid mutual fund: lends for days to weeks to banks and the government. The right home for an emergency fund — near-zero swings, withdrawable in a day.',
    role: 'Dry powder',
    src: { type: 'amfi', code: 119800 },
    provenance: {
      provider: 'AMFI',
      detail:
        'Daily NAV of SBI Liquid Fund — Direct Plan, Growth (AMFI scheme 119800). Its trailing 3-month return is also Frontier’s rupee risk-free rate.',
      url: AMFI_URL,
    },
  },
  {
    id: 'CASH-USD',
    symbol: 'TBILLS',
    name: 'US Dollar Cash (T-Bills)',
    short: 'Cash (T-bills)',
    kind: 'cash',
    assetClass: 'cash',
    region: 'US',
    currency: 'USD',
    description: 'Money earning the short-term US Treasury-bill rate — no market risk, just interest.',
    role: 'Dry powder',
    src: { type: 'tbill', series: 'DTB3' },
    provenance: {
      provider: 'FRED (public domain)',
      detail: 'Interest accrued daily at the 3-month Treasury-bill rate [DTB3].',
      url: 'https://fred.stlouisfed.org/series/DTB3',
    },
  },
];

const toMeta = ({ src: _src, ...d }: Def): AssetMeta => ({
  ...d,
  symbol: d.symbol ?? d.id,
  short: d.short ?? d.name,
  investable: d.investable ?? true,
});

export const UNIVERSE: AssetMeta[] = DEFS.map(toMeta);
export const CASH_ASSETS: AssetMeta[] = CASH_DEFS.map(toMeta);
export const ALL_ASSETS: AssetMeta[] = [...UNIVERSE, ...CASH_ASSETS];

/** Where each instrument's data comes from (pipeline-only; not published). */
export const SOURCES = new Map<string, SourceSpec>([...DEFS, ...CASH_DEFS].map((d) => [d.id, d.src]));

/** Instruments the site cannot work without — the pipeline refuses to publish if any is missing or stale. */
export const CORE_IDS = [
  'NIFTY50',
  'GOLD-INR',
  'GILT10Y',
  'CASH-INR',
  'USDINR',
  'US-LARGE',
  'UST10Y',
  'CASH-USD',
  'BTC-USD',
];

/** Instruments that also get 5-minute intraday bars (24/7 crypto markets). */
export const INTRADAY_IDS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'GOLD-USD'];

export const byId = new Map(ALL_ASSETS.map((a) => [a.id, a]));
