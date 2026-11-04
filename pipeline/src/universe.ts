/**
 * The investable universe and reference instruments.
 *
 * Curated for a beginner-first product: broad, low-cost ETFs as building
 * blocks; the largest US and Indian companies for exploration; indices,
 * volatility, rates and FX as market context. Every description is written
 * for someone who has never invested before.
 */
import type { AssetMeta } from '@frontier/contracts';

type Def = Omit<AssetMeta, 'investable' | 'short'> & { investable?: boolean; short?: string };

const etf = (d: Omit<Def, 'kind'>): Def => ({ kind: 'etf', ...d });
const usStock = (symbol: string, name: string, sector: string, description: string): Def => ({
  id: symbol,
  symbol,
  name,
  kind: 'stock',
  assetClass: 'equity',
  region: 'US',
  currency: 'USD',
  sector,
  description,
  benchmark: 'SPY',
  proxy: sector === 'Technology' || sector === 'Communication' ? 'QQQ' : 'SPY',
});
const inStock = (symbol: string, name: string, sector: string, description: string): Def => ({
  id: symbol.replace('&', ''),
  symbol,
  name,
  kind: 'stock',
  assetClass: 'equity',
  region: 'IN',
  currency: 'INR',
  sector,
  description,
  benchmark: 'NIFTYBEES.NS',
  proxy: 'NSEI',
});

const DEFS: Def[] = [
  // ── US core ETFs ─────────────────────────────────────────────────────────
  etf({ id: 'SPY', symbol: 'SPY', name: 'SPDR S&P 500 ETF', short: 'S&P 500', assetClass: 'equity', region: 'US', currency: 'USD', description: 'The 500 largest US companies in a single fund — the most traded ETF in the world.', role: 'Core growth engine', benchmark: 'SPY', proxy: 'GSPC' }),
  etf({ id: 'VTI', symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', short: 'US Total Market', assetClass: 'equity', region: 'US', currency: 'USD', description: 'Practically the entire US stock market — large, mid and small companies — for a tiny fee.', role: 'Core growth engine', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'QQQ', symbol: 'QQQ', name: 'Invesco QQQ Trust', short: 'Nasdaq-100', assetClass: 'equity', region: 'US', currency: 'USD', description: 'The 100 largest non-financial companies on the Nasdaq, dominated by big technology firms.', role: 'Growth & innovation tilt', benchmark: 'SPY', proxy: 'IXIC' }),
  etf({ id: 'IWM', symbol: 'IWM', name: 'iShares Russell 2000 ETF', short: 'US Small Caps', assetClass: 'equity', region: 'US', currency: 'USD', description: 'About 2,000 smaller US companies — more volatile, more sensitive to the domestic economy.', role: 'Small-company tilt', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'VEA', symbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF', short: 'Developed ex-US', assetClass: 'equity', region: 'DEV', currency: 'USD', description: 'Companies in developed economies outside the US: Europe, Japan, the UK, Canada, Australia.', role: 'International diversifier', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'VWO', symbol: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', short: 'Emerging Markets', assetClass: 'equity', region: 'EM', currency: 'USD', description: 'Companies in fast-growing emerging economies such as China, India, Taiwan and Brazil.', role: 'Emerging-market growth', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'VNQ', symbol: 'VNQ', name: 'Vanguard Real Estate ETF', short: 'US REITs', assetClass: 'real-estate', region: 'US', currency: 'USD', description: 'Real-estate investment trusts that own offices, apartments, warehouses and data centers, and pay out rent as dividends.', role: 'Real-asset income', benchmark: 'SPY', proxy: 'SPY' }),
  // ── US bonds ─────────────────────────────────────────────────────────────
  etf({ id: 'AGG', symbol: 'AGG', name: 'iShares Core US Aggregate Bond ETF', short: 'US Aggregate Bonds', assetClass: 'bond', region: 'US', currency: 'USD', description: 'Thousands of high-quality US bonds — government, mortgage and corporate — in one fund.', role: 'Core stabiliser', benchmark: 'AGG', proxy: 'IEF' }),
  etf({ id: 'TLT', symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', short: 'Long Treasuries', assetClass: 'bond', region: 'US', currency: 'USD', description: 'Long-term US government bonds. Very sensitive to interest rates, and historically a strong rally candidate when stocks crash.', role: 'Crash hedge', benchmark: 'AGG', proxy: 'IEF' }),
  etf({ id: 'IEF', symbol: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF', short: '7–10Y Treasuries', assetClass: 'bond', region: 'US', currency: 'USD', description: 'Medium-term US government bonds — a balance of income and interest-rate sensitivity.', role: 'Shock absorber', benchmark: 'AGG' }),
  etf({ id: 'SHY', symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', short: 'Short Treasuries', assetClass: 'bond', region: 'US', currency: 'USD', description: 'Short-term US government bonds — barely moves, close to holding cash.', role: 'Cash-like ballast', benchmark: 'AGG' }),
  etf({ id: 'TIP', symbol: 'TIP', name: 'iShares TIPS Bond ETF', short: 'Inflation-linked Bonds', assetClass: 'bond', region: 'US', currency: 'USD', description: 'US government bonds whose principal rises with inflation, protecting purchasing power.', role: 'Inflation protection', benchmark: 'AGG', proxy: 'IEF' }),
  etf({ id: 'LQD', symbol: 'LQD', name: 'iShares iBoxx $ Investment Grade Corporate Bond ETF', short: 'Corporate Bonds', assetClass: 'bond', region: 'US', currency: 'USD', description: 'Bonds issued by large, financially strong US companies; pays more than government bonds.', role: 'Income', benchmark: 'AGG', proxy: 'IEF' }),
  etf({ id: 'HYG', symbol: 'HYG', name: 'iShares iBoxx $ High Yield Corporate Bond ETF', short: 'High-Yield Bonds', assetClass: 'bond', region: 'US', currency: 'USD', description: '"Junk" bonds: higher interest from riskier companies. Behaves partly like stocks in a crisis.', role: 'High income', benchmark: 'AGG', proxy: 'SPY' }),
  // ── Real assets & factors ─────────────────────────────────────────────────
  etf({ id: 'GLD', symbol: 'GLD', name: 'SPDR Gold Shares', short: 'Gold', assetClass: 'commodity', region: 'GLOBAL', currency: 'USD', description: 'Physical gold held in vaults. A centuries-old store of value that often shines in crises.', role: 'Crisis & inflation hedge', benchmark: 'SPY' }),
  etf({ id: 'SLV', symbol: 'SLV', name: 'iShares Silver Trust', short: 'Silver', assetClass: 'commodity', region: 'GLOBAL', currency: 'USD', description: 'Physical silver — part precious metal, part industrial metal, and far more volatile than gold.', role: 'Precious-metal satellite', benchmark: 'SPY', proxy: 'GLD' }),
  etf({ id: 'DBC', symbol: 'DBC', name: 'Invesco DB Commodity Index Tracking Fund', short: 'Commodities', assetClass: 'commodity', region: 'GLOBAL', currency: 'USD', description: 'A basket of commodity futures — crude oil, metals and crops — that tends to rise with inflation.', role: 'Inflation hedge', benchmark: 'SPY' }),
  etf({ id: 'USMV', symbol: 'USMV', name: 'iShares MSCI USA Min Vol Factor ETF', short: 'US Min Volatility', assetClass: 'equity', region: 'US', currency: 'USD', description: 'US stocks selected and weighted to keep volatility low.', role: 'Defensive equity', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'MTUM', symbol: 'MTUM', name: 'iShares MSCI USA Momentum Factor ETF', short: 'US Momentum', assetClass: 'equity', region: 'US', currency: 'USD', description: 'US stocks with the strongest recent price momentum.', role: 'Momentum factor', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'QUAL', symbol: 'QUAL', name: 'iShares MSCI USA Quality Factor ETF', short: 'US Quality', assetClass: 'equity', region: 'US', currency: 'USD', description: 'Highly profitable US companies with strong balance sheets and stable earnings.', role: 'Quality factor', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'IWD', symbol: 'IWD', name: 'iShares Russell 1000 Value ETF', short: 'US Value', assetClass: 'equity', region: 'US', currency: 'USD', description: 'Large US "value" stocks — cheaper relative to their earnings and assets.', role: 'Value factor', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'IWF', symbol: 'IWF', name: 'iShares Russell 1000 Growth ETF', short: 'US Growth', assetClass: 'equity', region: 'US', currency: 'USD', description: 'Large US "growth" stocks — faster-growing, more richly valued companies.', role: 'Growth factor', benchmark: 'SPY', proxy: 'SPY' }),
  etf({ id: 'UUP', symbol: 'UUP', name: 'Invesco DB US Dollar Index Bullish Fund', short: 'US Dollar', assetClass: 'currency', region: 'US', currency: 'USD', description: 'Rises when the US dollar strengthens against other major currencies.', role: 'Dollar exposure', benchmark: 'SPY' }),
  // ── US sectors ───────────────────────────────────────────────────────────
  ...(
    [
      ['XLK', 'Technology', 'Software, chips and hardware: Apple, Microsoft, NVIDIA and peers.'],
      ['XLF', 'Financials', 'Banks, insurers, asset managers and payment companies.'],
      ['XLV', 'Health Care', 'Drug makers, insurers, hospitals and medical-device companies.'],
      ['XLE', 'Energy', 'Oil and gas producers, refiners and equipment makers.'],
      ['XLY', 'Consumer Discretionary', 'Things people want but don\'t need: cars, retail, travel, restaurants.'],
      ['XLP', 'Consumer Staples', 'Everyday essentials — food, drinks, household goods. Steady in recessions.'],
      ['XLI', 'Industrials', 'Aerospace, machinery, railroads, logistics and construction.'],
      ['XLU', 'Utilities', 'Electricity, gas and water providers: regulated, dividend-paying, defensive.'],
      ['XLB', 'Materials', 'Chemicals, metals and mining, packaging.'],
      ['XLRE', 'Real Estate', 'Real-estate investment trusts across the S&P 500.'],
      ['XLC', 'Communication', 'Internet platforms, media and telecom: Alphabet, Meta, Netflix and others.'],
    ] as const
  ).map(([sym, sector, desc]) =>
    etf({ id: sym, symbol: sym, name: `${sector} Select Sector SPDR`, short: `US ${sector}`, assetClass: 'equity', region: 'US', currency: 'USD', sector, description: desc, role: 'Sector bet', benchmark: 'SPY', proxy: 'SPY', tags: ['sector'] }),
  ),
  // ── US mega-cap stocks ───────────────────────────────────────────────────
  usStock('AAPL', 'Apple', 'Technology', 'Makes the iPhone, Mac and a fast-growing services business.'),
  usStock('MSFT', 'Microsoft', 'Technology', 'Windows, Office, Azure cloud and a large stake in the AI boom.'),
  usStock('NVDA', 'NVIDIA', 'Technology', 'Designs the graphics chips (GPUs) that power most AI systems and gaming.'),
  usStock('AVGO', 'Broadcom', 'Technology', 'Networking and custom AI chips plus enterprise software.'),
  usStock('GOOGL', 'Alphabet', 'Communication', 'Google Search, YouTube, Android and Google Cloud.'),
  usStock('META', 'Meta Platforms', 'Communication', 'Facebook, Instagram and WhatsApp — funded by digital advertising.'),
  usStock('NFLX', 'Netflix', 'Communication', 'The largest subscription video-streaming service.'),
  usStock('AMZN', 'Amazon', 'Consumer Discretionary', 'Online retail giant and owner of AWS, the largest cloud platform.'),
  usStock('TSLA', 'Tesla', 'Consumer Discretionary', 'Electric cars, batteries and energy storage. Famous for big price swings.'),
  usStock('BRK-B', 'Berkshire Hathaway', 'Financials', 'Warren Buffett\'s conglomerate: insurance, railways, energy and a huge stock portfolio.'),
  usStock('JPM', 'JPMorgan Chase', 'Financials', 'The largest US bank by assets.'),
  usStock('V', 'Visa', 'Financials', 'Runs the world\'s largest card-payments network and earns a fee per transaction.'),
  usStock('LLY', 'Eli Lilly', 'Health Care', 'Pharmaceutical company behind leading diabetes and weight-loss drugs.'),
  usStock('UNH', 'UnitedHealth', 'Health Care', 'The largest US health insurer, also running clinics and pharmacy services.'),
  usStock('JNJ', 'Johnson & Johnson', 'Health Care', 'Diversified pharmaceutical and medical-technology company.'),
  usStock('XOM', 'Exxon Mobil', 'Energy', 'The largest US oil and gas company.'),
  usStock('PG', 'Procter & Gamble', 'Consumer Staples', 'Household brands like Tide, Gillette and Pampers.'),
  usStock('KO', 'Coca-Cola', 'Consumer Staples', 'Soft drinks sold in 200+ countries — a classic defensive dividend stock.'),
  usStock('COST', 'Costco', 'Consumer Staples', 'Membership warehouse retailer known for loyal customers.'),
  usStock('WMT', 'Walmart', 'Consumer Staples', 'The world\'s largest retailer by revenue.'),
  // ── India ETFs ───────────────────────────────────────────────────────────
  etf({ id: 'NIFTYBEES.NS', symbol: 'NIFTYBEES.NS', name: 'Nippon India ETF Nifty 50 BeES', short: 'Nifty 50 ETF', assetClass: 'equity', region: 'IN', currency: 'INR', description: "India's 50 largest listed companies in one low-cost fund — the default core of an Indian portfolio.", role: 'Core growth engine', benchmark: 'NIFTYBEES.NS', proxy: 'NSEI' }),
  etf({ id: 'JUNIORBEES.NS', symbol: 'JUNIORBEES.NS', name: 'Nippon India ETF Nifty Next 50 Junior BeES', short: 'Nifty Next 50 ETF', assetClass: 'equity', region: 'IN', currency: 'INR', description: 'The next 50 Indian companies after the Nifty 50 — tomorrow\'s potential large caps.', role: 'Mid/large-cap growth', benchmark: 'NIFTYBEES.NS', proxy: 'NSEI' }),
  etf({ id: 'BANKBEES.NS', symbol: 'BANKBEES.NS', name: 'Nippon India ETF Nifty Bank BeES', short: 'Bank Nifty ETF', assetClass: 'equity', region: 'IN', currency: 'INR', sector: 'Financials', description: "India's largest listed banks — a concentrated bet on credit growth.", role: 'Sector bet', benchmark: 'NIFTYBEES.NS', proxy: 'NSEBANK' }),
  etf({ id: 'MON100.NS', symbol: 'MON100.NS', name: 'Motilal Oswal Nasdaq 100 ETF', short: 'Nasdaq-100 (INR)', assetClass: 'equity', region: 'US', currency: 'INR', description: 'US Nasdaq-100 tech giants, bought in rupees on the NSE — international diversification for Indian investors.', role: 'Global growth diversifier', benchmark: 'NIFTYBEES.NS' }),
  etf({ id: 'GOLDBEES.NS', symbol: 'GOLDBEES.NS', name: 'Nippon India ETF Gold BeES', short: 'Gold ETF (INR)', assetClass: 'commodity', region: 'IN', currency: 'INR', description: 'Physical gold in rupee terms. Gains both when gold rises and when the rupee weakens.', role: 'Crisis & inflation hedge', benchmark: 'NIFTYBEES.NS' }),
  etf({ id: 'SILVERBEES.NS', symbol: 'SILVERBEES.NS', name: 'Nippon India Silver ETF', short: 'Silver ETF (INR)', assetClass: 'commodity', region: 'IN', currency: 'INR', description: 'Physical silver in rupee terms.', role: 'Precious-metal satellite', benchmark: 'NIFTYBEES.NS', proxy: 'GOLDBEES.NS' }),
  etf({ id: 'SETF10GILT.NS', symbol: 'SETF10GILT.NS', name: 'SBI ETF 10 Year Gilt', short: '10Y G-Sec ETF', assetClass: 'bond', region: 'IN', currency: 'INR', description: 'Indian government bonds with about ten years to maturity — safe from default, sensitive to interest rates.', role: 'Shock absorber', benchmark: 'NIFTYBEES.NS' }),
  // ── India stocks ─────────────────────────────────────────────────────────
  inStock('RELIANCE.NS', 'Reliance Industries', 'Energy', 'Oil refining, Jio telecom and India\'s largest retail chain under one roof.'),
  inStock('HDFCBANK.NS', 'HDFC Bank', 'Financials', "India's largest private-sector bank."),
  inStock('ICICIBANK.NS', 'ICICI Bank', 'Financials', 'A leading private-sector bank with a big retail and digital franchise.'),
  inStock('SBIN.NS', 'State Bank of India', 'Financials', "India's largest bank, majority-owned by the government."),
  inStock('KOTAKBANK.NS', 'Kotak Mahindra Bank', 'Financials', 'A conservatively run private bank with insurance and asset-management arms.'),
  inStock('AXISBANK.NS', 'Axis Bank', 'Financials', 'One of the largest private-sector banks in India.'),
  inStock('BAJFINANCE.NS', 'Bajaj Finance', 'Financials', 'Consumer-lending powerhouse financing everything from phones to homes.'),
  inStock('INFY.NS', 'Infosys', 'Technology', 'IT-services giant serving global corporations — earns largely in dollars.'),
  inStock('TCS.NS', 'Tata Consultancy Services', 'Technology', "India's largest IT-services company."),
  inStock('HCLTECH.NS', 'HCLTech', 'Technology', 'IT services and engineering software for global clients.'),
  inStock('BHARTIARTL.NS', 'Bharti Airtel', 'Communication', 'Mobile, broadband and digital services across India and Africa.'),
  inStock('ITC.NS', 'ITC', 'Consumer Staples', 'Cigarettes, packaged foods, hotels and paper — a steady cash generator.'),
  inStock('HINDUNILVR.NS', 'Hindustan Unilever', 'Consumer Staples', 'Household brands like Surf, Lux and Dove for over a billion consumers.'),
  inStock('LT.NS', 'Larsen & Toubro', 'Industrials', "India's largest engineering and construction company — a proxy for infrastructure spending."),
  inStock('MARUTI.NS', 'Maruti Suzuki', 'Consumer Discretionary', "India's largest car maker."),
  inStock('M&M.NS', 'Mahindra & Mahindra', 'Consumer Discretionary', 'SUVs, tractors and a broad group of businesses.'),
  inStock('TITAN.NS', 'Titan Company', 'Consumer Discretionary', 'Jewellery (Tanishq), watches and eyewear — a bet on rising incomes.'),
  inStock('ASIANPAINT.NS', 'Asian Paints', 'Materials', "India's largest paint company."),
  inStock('SUNPHARMA.NS', 'Sun Pharmaceutical', 'Health Care', "India's largest drug maker, selling generics and specialty medicines worldwide."),
  inStock('NTPC.NS', 'NTPC', 'Utilities', "India's largest power producer, government-controlled."),
  // ── Crypto ───────────────────────────────────────────────────────────────
  { id: 'BTC-USD', symbol: 'BTC-USD', name: 'Bitcoin', short: 'Bitcoin', kind: 'crypto', assetClass: 'crypto', region: 'GLOBAL', currency: 'USD', description: 'The original cryptocurrency with a fixed supply of 21 million coins. Extremely volatile.', role: 'Speculative satellite', benchmark: 'SPY' },
  { id: 'ETH-USD', symbol: 'ETH-USD', name: 'Ethereum', short: 'Ethereum', kind: 'crypto', assetClass: 'crypto', region: 'GLOBAL', currency: 'USD', description: 'The blockchain behind most smart contracts, stablecoins and DeFi. Even more volatile than Bitcoin.', role: 'Speculative satellite', benchmark: 'SPY', proxy: 'BTC-USD' },
  { id: 'SOL-USD', symbol: 'SOL-USD', name: 'Solana', short: 'Solana', kind: 'crypto', assetClass: 'crypto', region: 'GLOBAL', currency: 'USD', description: 'A fast, low-fee blockchain. A young, highly speculative asset.', role: 'Speculative satellite', benchmark: 'SPY', proxy: 'BTC-USD' },
  // ── Reference instruments (not investable) ────────────────────────────────
  { id: 'GSPC', symbol: '^GSPC', name: 'S&P 500 Index', short: 'S&P 500', kind: 'index', assetClass: 'equity', region: 'US', currency: 'USD', description: 'The benchmark index of 500 large US companies.', investable: false, benchmark: 'GSPC' },
  { id: 'IXIC', symbol: '^IXIC', name: 'Nasdaq Composite', short: 'Nasdaq', kind: 'index', assetClass: 'equity', region: 'US', currency: 'USD', description: 'Every stock listed on the Nasdaq exchange — tech-heavy.', investable: false, benchmark: 'GSPC' },
  { id: 'DJI', symbol: '^DJI', name: 'Dow Jones Industrial Average', short: 'Dow Jones', kind: 'index', assetClass: 'equity', region: 'US', currency: 'USD', description: '30 large, well-known US companies; the oldest US market gauge.', investable: false, benchmark: 'GSPC' },
  { id: 'VIX', symbol: '^VIX', name: 'CBOE Volatility Index', short: 'VIX', kind: 'index', assetClass: 'volatility', region: 'US', currency: 'USD', description: 'The market\'s "fear gauge": expected S&P 500 volatility over the next 30 days.', investable: false },
  { id: 'TNX', symbol: '^TNX', name: 'US 10-Year Treasury Yield', short: 'US 10Y Yield', kind: 'rate', assetClass: 'rate', region: 'US', currency: 'USD', description: 'The interest rate on 10-year US government debt — the anchor for mortgages and valuations.', investable: false },
  { id: 'IRX', symbol: '^IRX', name: 'US 13-Week Treasury Bill Yield', short: 'US 3M T-Bill', kind: 'rate', assetClass: 'rate', region: 'US', currency: 'USD', description: 'The short-term "risk-free" interest rate in US dollars.', investable: false },
  { id: 'NSEI', symbol: '^NSEI', name: 'Nifty 50 Index', short: 'Nifty 50', kind: 'index', assetClass: 'equity', region: 'IN', currency: 'INR', description: "The benchmark index of India's 50 largest companies on the NSE.", investable: false, benchmark: 'NSEI' },
  { id: 'BSESN', symbol: '^BSESN', name: 'BSE Sensex', short: 'Sensex', kind: 'index', assetClass: 'equity', region: 'IN', currency: 'INR', description: "30 of the largest companies on the Bombay Stock Exchange — India's oldest index.", investable: false, benchmark: 'NSEI' },
  { id: 'NSEBANK', symbol: '^NSEBANK', name: 'Nifty Bank Index', short: 'Bank Nifty', kind: 'index', assetClass: 'equity', region: 'IN', currency: 'INR', sector: 'Financials', description: "India's most-traded sector index: its largest banks.", investable: false, benchmark: 'NSEI' },
  { id: 'INDIAVIX', symbol: '^INDIAVIX', name: 'India VIX', short: 'India VIX', kind: 'index', assetClass: 'volatility', region: 'IN', currency: 'INR', description: 'Expected Nifty volatility over the next 30 days — India\'s fear gauge.', investable: false },
  { id: 'USDINR', symbol: 'USDINR=X', name: 'US Dollar / Indian Rupee', short: 'USD/INR', kind: 'fx', assetClass: 'currency', region: 'GLOBAL', currency: 'INR', description: 'How many rupees one US dollar buys. Rising = weaker rupee.', investable: false },
  { id: 'DXY', symbol: 'DX-Y.NYB', name: 'US Dollar Index', short: 'Dollar Index', kind: 'index', assetClass: 'currency', region: 'GLOBAL', currency: 'USD', description: 'The US dollar against a basket of six major currencies.', investable: false },
  { id: 'GC', symbol: 'GC=F', name: 'Gold Futures', short: 'Gold (spot)', kind: 'future', assetClass: 'commodity', region: 'GLOBAL', currency: 'USD', description: 'The price of an ounce of gold in dollars.', investable: false },
  { id: 'CL', symbol: 'CL=F', name: 'Crude Oil Futures (WTI)', short: 'Crude Oil', kind: 'future', assetClass: 'commodity', region: 'GLOBAL', currency: 'USD', description: 'The price of a barrel of US crude oil.', investable: false },
];

/** Constructed cash assets accruing the local risk-free rate. */
export const CASH_ASSETS: AssetMeta[] = [
  { id: 'CASH-USD', symbol: 'CASH-USD', name: 'US Dollar Cash (T-Bills)', short: 'Cash (USD)', kind: 'cash', assetClass: 'cash', region: 'US', currency: 'USD', description: 'Money earning the short-term US Treasury-bill rate — no market risk, just interest.', role: 'Dry powder', investable: true },
  { id: 'CASH-INR', symbol: 'CASH-INR', name: 'Indian Rupee Cash (Liquid Fund)', short: 'Cash (INR)', kind: 'cash', assetClass: 'cash', region: 'IN', currency: 'INR', description: 'Money earning the short-term Indian interest rate, like a liquid mutual fund or sweep deposit.', role: 'Dry powder', investable: true },
];

export const UNIVERSE: AssetMeta[] = DEFS.map((d) => ({
  ...d,
  short: d.short ?? d.name,
  investable: d.investable ?? true,
}));

export const ALL_ASSETS: AssetMeta[] = [...UNIVERSE, ...CASH_ASSETS];

/** Instruments the site cannot work without — the pipeline refuses to publish if any is missing. */
export const CORE_IDS = ['SPY', 'AGG', 'GLD', 'GSPC', 'NSEI', 'NIFTYBEES.NS', 'GOLDBEES.NS', 'USDINR'];

/** Headline instruments that also get 5-minute intraday bars. */
export const INTRADAY_IDS = ['GSPC', 'IXIC', 'NSEI', 'BSESN', 'BTC-USD', 'GC', 'USDINR', 'VIX'];

export const byId = new Map(ALL_ASSETS.map((a) => [a.id, a]));
