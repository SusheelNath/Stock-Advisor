'use strict';

// ─── API Configuration ────────────────────────────────────────────────
const API = {
  // ── Finnhub (primary — WebSocket + REST) ──
  get token()          { return localStorage.getItem('finnhub_token') || ''; },
  set token(v)         { localStorage.setItem('finnhub_token', v); },
  FINNHUB_BASE: 'https://finnhub.io/api/v1',

  // ── Twelve Data (secondary — free REST, no proxy needed, covers indices/ETFs) ──
  // Free key: 800 credits/day, 8 req/min — https://twelvedata.com/
  get twelveDataKey()  { return localStorage.getItem('twelvedata_key') || 'a4514624a25f4a94931ceba961ec3c8f'; },
  set twelveDataKey(v) { localStorage.setItem('twelvedata_key', v); },
  TWELVEDATA_BASE: 'https://api.twelvedata.com',

  YAHOO_PROXY: 'https://api.allorigins.win/raw?url=',
  YAHOO_CHART: 'https://query1.finance.yahoo.com/v8/finance/chart/',

  // REST polling interval for non-WebSocket instruments (indices, LSE ETFs)
  // WebSocket instruments (US stocks, OANDA CFDs) update on every trade tick.
  REFRESH_PRICES_MS: 8 * 1000,
  REFRESH_NEWS_MS: 15 * 60 * 1000,
  NEWS_LOOKBACK_DAYS: 2,
};

// ─── Volatility Tiers (for magnitude band calculation) ───────────────
const TIERS = {
  1: { label: 'High Vol',    range: [3, 15] },  // Space small-cap
  2: { label: 'Growth Tech', range: [2, 8]  },  // NVDA, AMD, META, ARM
  3: { label: 'Large Cap',   range: [1, 4]  },  // MSFT, GOOGL, TSM, INTC
  4: { label: 'Storage',     range: [2, 6]  },  // WDC, STX, SNDK
  5: { label: 'Asia Tech',   range: [1, 4]  },  // SMSN, LNVGY
  6: { label: 'ETF/Index',   range: [0.3, 2]},  // Vanguard, indices
  7: { label: 'Commodity',   range: [0.5, 3]},  // Gold, Oil
};

// ─── News Category Impact Multipliers ────────────────────────────────
const CATEGORY_MULTIPLIERS = {
  earnings:     1.5,
  guidance:     1.3,
  ma:           1.4,
  regulatory:   1.2,
  product:      1.0,
  analyst:      0.8,
  geopolitical: 0.9,
  macro:        0.6,
  general:      0.4,
};

// ─── Watchlist ────────────────────────────────────────────────────────
// stooq: direct data source (no CORS proxy), accurate prices for non-US instruments
const WATCHLIST = [
  // Storage / Memory
  { id: 'WDC',    name: 'Western Digital',       ticker: 'WDC',    yahoo: 'WDC',       finnhub: 'WDC',           stooq: 'wdc.us',     sector: 'Storage',        tier: 4, color: '#0078d4' },
  { id: 'STX',    name: 'Seagate Technology',    ticker: 'STX',    yahoo: 'STX',       finnhub: 'STX',           stooq: 'stx.us',     sector: 'Storage',        tier: 4, color: '#00b388' },
  { id: 'SNDK',   name: 'Sandisk',               ticker: 'SNDK',   yahoo: 'SNDK',      finnhub: 'SNDK',          stooq: 'sndk.us',    sector: 'Storage',        tier: 4, color: '#c00000' },
  { id: 'MU',     name: 'Micron Technology',     ticker: 'MU',     yahoo: 'MU',        finnhub: 'MU',            stooq: 'mu.us',      sector: 'Semiconductors', tier: 2, color: '#00bfff' },
  // Semiconductors
  { id: 'TSM',    name: 'Taiwan Semiconductor',  ticker: 'TSM',    yahoo: 'TSM',       finnhub: 'TSM',           stooq: 'tsm.us',     sector: 'Semiconductors', tier: 3, color: '#e02020' },
  { id: 'ARM',    name: 'ARM Holdings',           ticker: 'ARM',    yahoo: 'ARM',       finnhub: 'ARM',           stooq: 'arm.us',     sector: 'Semiconductors', tier: 2, color: '#0091bd' },
  { id: 'INTC',   name: 'Intel',                  ticker: 'INTC',   yahoo: 'INTC',      finnhub: 'INTC',          stooq: 'intc.us',    sector: 'Semiconductors', tier: 3, color: '#0071c5' },
  { id: 'AMD',    name: 'Advanced Micro Dev.',    ticker: 'AMD',    yahoo: 'AMD',       finnhub: 'AMD',           stooq: 'amd.us',     sector: 'Semiconductors', tier: 2, color: '#ed1c24' },
  { id: 'NVDA',   name: 'Nvidia',                 ticker: 'NVDA',   yahoo: 'NVDA',      finnhub: 'NVDA',          stooq: 'nvda.us',    sector: 'Semiconductors', tier: 2, color: '#76b900' },
  // Big Tech
  { id: 'MSFT',   name: 'Microsoft',              ticker: 'MSFT',   yahoo: 'MSFT',      finnhub: 'MSFT',          stooq: 'msft.us',    sector: 'Big Tech',       tier: 3, color: '#00a4ef' },
  { id: 'GOOGL',  name: 'Alphabet (Class A)',     ticker: 'GOOGL',  yahoo: 'GOOGL',     finnhub: 'GOOGL',         stooq: 'googl.us',   sector: 'Big Tech',       tier: 3, color: '#4285f4' },
  { id: 'GOOG',   name: 'Alphabet (Class C)',     ticker: 'GOOG',   yahoo: 'GOOG',      finnhub: 'GOOG',          stooq: 'goog.us',    sector: 'Big Tech',       tier: 3, color: '#34a853' },
  { id: 'META',   name: 'Meta Platforms',         ticker: 'META',   yahoo: 'META',      finnhub: 'META',          stooq: 'meta.us',    sector: 'Big Tech',       tier: 2, color: '#0866ff' },
  // Asia Tech
  { id: 'SMSN',   name: 'Samsung Electronics',   ticker: 'SMSN',   yahoo: 'SMSN.IL',   finnhub: 'LSE:SMSN',      stooq: 'smsn.uk',    sector: 'Asia Tech',      tier: 5, color: '#1428a0', currency: 'GBP' },
  { id: 'LNVGY',  name: 'Lenovo Group',           ticker: 'LNVGY',  yahoo: 'LNVGY',     finnhub: 'LNVGY',         stooq: 'lnvgy.us',   sector: 'Asia Tech',      tier: 5, color: '#e2211c' },
  // Space
  { id: 'RKLB',   name: 'Rocket Lab',             ticker: 'RKLB',   yahoo: 'RKLB',      finnhub: 'RKLB',          stooq: 'rklb.us',    sector: 'Space',          tier: 1, color: '#ff3b30' },
  { id: 'PL',     name: 'Planet Labs',             ticker: 'PL',     yahoo: 'PL',        finnhub: 'PL',            stooq: 'pl.us',      sector: 'Space',          tier: 1, color: '#00a6fb' },
  { id: 'VOYG',   name: 'Voyager Technologies',   ticker: 'VOYG',   yahoo: 'VOYG',      finnhub: 'VOYG',          stooq: 'voyg.us',    sector: 'Space',          tier: 1, color: '#7c3aed' },
  { id: 'LUNR',   name: 'Intuitive Machines',     ticker: 'LUNR',   yahoo: 'LUNR',      finnhub: 'LUNR',          stooq: 'lunr.us',    sector: 'Space',          tier: 1, color: '#0077b5' },
  // Pharma
  { id: 'LLY',    name: 'Eli Lilly',              ticker: 'LLY',    yahoo: 'LLY',       finnhub: 'LLY',           stooq: 'lly.us',     sector: 'Pharma',         tier: 2, color: '#e5005b' },
  { id: 'NVO',    name: 'Novo Nordisk',           ticker: 'NVO',    yahoo: 'NVO',       finnhub: 'NVO',           stooq: 'nvo.us',     sector: 'Pharma',         tier: 2, color: '#009fe3' },
  { id: 'REGN',   name: 'Regeneron',              ticker: 'REGN',   yahoo: 'REGN',      finnhub: 'REGN',          stooq: 'regn.us',    sector: 'Pharma',         tier: 3, color: '#ff6f00' },
  { id: 'VRTX',   name: 'Vertex Pharmaceuticals', ticker: 'VRTX',   yahoo: 'VRTX',      finnhub: 'VRTX',          stooq: 'vrtx.us',    sector: 'Pharma',         tier: 2, color: '#00897b' },
  { id: 'MRK',    name: 'Merck & Co.',            ticker: 'MRK',    yahoo: 'MRK',       finnhub: 'MRK',           stooq: 'mrk.us',     sector: 'Pharma',         tier: 3, color: '#00a651' },
  // Space ETF
  { id: 'JEDI',   name: 'VanEck Space Innov.',    ticker: 'JEDI',   yahoo: 'JEDI.AS',   finnhub: null,            stooq: 'jedi.nl',    twelvedata: 'JEDI:AMS',  sector: 'Space ETF',      tier: 6, color: '#ff6b00', currency: 'EUR' },
  // Commodity
  { id: 'IGLN',   name: 'iShares Phys. Gold',     ticker: 'IGLN',   yahoo: 'IGLN.L',    finnhub: null,            stooq: 'igln.uk',    twelvedata: 'IGLN:LSE',  sector: 'Commodity',      tier: 7, color: '#f0b429', currency: 'GBP' },
  { id: 'XAUUSD', name: 'Gold Spot',              ticker: 'XAUUSD', yahoo: 'GC=F',      finnhub: 'OANDA:XAU_USD', stooq: 'xauusd',     sector: 'Commodity',      tier: 7, color: '#f0b429' },
];

// ─── Indicators ───────────────────────────────────────────────────────
// stooq: direct no-proxy source for accurate index/ETF prices.
// OANDA: live WebSocket CFD feed for non-US indices where supported.
const INDICATORS = [
  // twelvedata: free-tier symbol for Twelve Data API (twelvedata.com) — indices available without paid plan
  { id: 'USA500',  name: 'USA 500 (S&P 500)',       ticker: 'USA500',  yahoo: '^GSPC',   finnhub: 'SPY',            stooq: '^spx',    twelvedata: 'SPX',       type: 'Index',     tier: 6, color: '#3b82f6', scaleFromStooq: true },
  { id: 'TECH100', name: 'USA Tech 100 (Nasdaq)',    ticker: 'TECH100', yahoo: '^NDX',    finnhub: 'QQQ',            stooq: '^ndx',    twelvedata: 'NDX',       type: 'Index',     tier: 6, color: '#8b5cf6', scaleFromStooq: true },
  { id: 'GER40',   name: 'Germany 40 (DAX)',         ticker: 'GER40',   yahoo: '^GDAXI',  finnhub: 'OANDA:DE30_EUR', stooq: '^dax',    twelvedata: 'DAX',       type: 'Index',     tier: 6, color: '#ef4444', currency: 'EUR' },
  { id: 'JPN225',  name: 'Japan 225 (Nikkei)',       ticker: 'JPN225',  yahoo: '^N225',   finnhub: 'OANDA:JP225_USD',stooq: '^nkx',    twelvedata: 'N225',      type: 'Index',     tier: 6, color: '#f97316', currency: 'JPY' },
  { id: 'VUSA',    name: 'Vanguard S&P 500',         ticker: 'VUSA',    yahoo: 'VUSA.L',  finnhub: null,             stooq: 'vusa.uk', twelvedata: 'VUSA:LSE',  type: 'ETF',       tier: 6, color: '#dc2626', currency: 'GBP' },
  { id: 'VUAG',    name: 'Vanguard S&P 500 Acc',     ticker: 'VUAG',    yahoo: 'VUAG.L',  finnhub: null,             stooq: 'vuag.uk', twelvedata: 'VUAG:LSE',  type: 'ETF',       tier: 6, color: '#dc2626', currency: 'GBP' },
  { id: 'VWRP',    name: 'Vanguard FTSE All-World',  ticker: 'VWRP',    yahoo: 'VWRP.L',  finnhub: null,             stooq: 'vwrp.uk', twelvedata: 'VWRP:LSE',  type: 'ETF',       tier: 6, color: '#dc2626', currency: 'GBP' },
  { id: 'V3PA',    name: 'Vanguard ESG Developed',   ticker: 'V3PA',    yahoo: 'V3PA.AS', finnhub: null,             stooq: 'v3pa.nl', twelvedata: 'V3PA:AMS',  type: 'ETF',       tier: 6, color: '#dc2626', currency: 'EUR' },
  { id: 'EMAS',    name: 'SPDR MSCI EM Asia',        ticker: 'EMAS',    yahoo: 'EMAS.SW', finnhub: null,             stooq: 'emas.ch', twelvedata: 'EMAS:SWX',  type: 'ETF',       tier: 6, color: '#22c55e', currency: 'CHF' },
  { id: 'SGLN',    name: 'iShares Phys. Gold (GBP)', ticker: 'SGLN',    yahoo: 'SGLN.L',  finnhub: null,             stooq: 'sgln.uk', twelvedata: 'SGLN:LSE',  type: 'Commodity', tier: 7, color: '#f0b429', currency: 'GBP' },
  { id: 'CRUDE',   name: 'Crude Oil (Brent)',        ticker: 'CRUDE',   yahoo: 'CL=F',    finnhub: 'OANDA:BCO_USD',  stooq: 'cl.f',    twelvedata: 'BCO/USD',   type: 'Commodity', tier: 7, color: '#6b7280' },
];

// ─── Sentiment Keywords ───────────────────────────────────────────────
const BULLISH_KW = [
  'beat','beats','exceeded','surpass','record','surge','soar','jump','rally','rallies',
  'gain','gains','rise','grew','grow','growth','expand','launch','partnership','deal',
  'contract','wins','awarded','approved','upgrade','outperform','strong',
  'profit','raises guidance','dividend','buyback','breakthrough','investment',
  'positive','acquisition','momentum','order','orders','new product','bullish',
  'above expectations','raised','increased outlook','market share',
  // macro bullish
  'rate cut','cuts rates','dovish','easing','stimulus','blinks','backs down','ceasefire',
  'de-escalation','bypass','bypassing','dips','lower inflation','inflation eases',
  'below expectations on inflation','disinflation',
  // geopolitical bullish
  'peace','deal reached','agreement','mechanism','diplomatic',
];

const BEARISH_KW = [
  'miss','misses','below','disappoints','fell','fall','drop','decline','plunge',
  'slump','cut','cuts','reduce','warning','risk','concern','weak','loss',
  'deficit','debt','lawsuit','fine','penalty','investigation','recall',
  'downgrade','sell','underperform','layoff','layoffs','restructuring',
  'lowers guidance','bearish','ban','restriction','sanction','tariff','delay',
  'cancelled','default','bankruptcy','charges','below expectations','lowered',
  // geopolitical bearish
  'war','conflict','military','strike','attack','tension','escalat','blockade',
  'hormuz','seized','seized ship','hostage','invasion','bomb','missile',
  'pain','deepen','worsens','deepens','harder','tougher','crackdown',
  // macro bearish
  'hawkish','rate hike','hikes rates','tightening','stagflation','recession',
  'unemployment rises','gdp shrinks','debt ceiling','default risk',
];

const CATEGORY_KW = {
  earnings:     ['earnings','revenue','profit','eps','quarterly','results','q1','q2','q3','q4','fiscal year','net income','beat','miss'],
  guidance:     ['guidance','forecast','outlook','expects','projects','raises','lowers','full year','2025','2026'],
  ma:           ['merger','acquisition','acquires','acquired','buyout','takeover','deal','combine','bid'],
  regulatory:   ['fda','sec','regulation','regulatory','investigation','fine','penalty','lawsuit','ban','approved','restriction','antitrust','probe'],
  product:      ['launch','launches','product','chip','model','release','unveil','new','introduce','generation','upgrade'],
  analyst:      ['upgrade','downgrade','price target','analyst','rating','buy','sell','hold','overweight','underweight','cramer','top 10'],
  geopolitical: ['iran','hormuz','russia','ukraine','china','taiwan','war','conflict','sanction','export control','military','strike','attack','middle east','nato','geopolit','trade war','tariff'],
  macro:        ['fed','federal reserve','interest rate','inflation','gdp','economy','recession','cpi','jobs report','unemployment','bond','yield','treasury','rate cut','rate hike','dovish','hawkish','bank of england','ecb','boe'],
};

// ─── Instrument Relevance Map ─────────────────────────────────────────
// Keywords in news → which instruments in the watchlist are affected
const RELEVANCE_MAP = [
  { kws: ['nvidia','nvda','h100','h200','blackwell','gpu'],                   ids: ['NVDA'] },
  { kws: ['amd','mi300','radeon','ryzen','epyc'],                            ids: ['AMD'] },
  { kws: ['arm','arm holdings','arm architecture','chip design'],            ids: ['ARM'] },
  { kws: ['intel','intc','gaudi','xeon','foundry'],                          ids: ['INTC'] },
  { kws: ['tsmc','taiwan semiconductor','2nm','3nm','advanced node'],        ids: ['TSM'] },
  { kws: ['microsoft','azure','msft','copilot','teams','activision'],        ids: ['MSFT'] },
  { kws: ['alphabet','google','goog','googl','gemini','waymo','search'],     ids: ['GOOG','GOOGL'] },
  { kws: ['meta','facebook','instagram','whatsapp','llama','zuckerberg'],    ids: ['META'] },
  { kws: ['samsung','smsn','galaxy','hbm','memory chip'],                   ids: ['SMSN'] },
  { kws: ['lenovo','lnvgy','thinkpad','pc market'],                          ids: ['LNVGY'] },
  { kws: ['micron','mu','dram','hbm3','memory'],                             ids: ['MU'] },
  { kws: ['western digital','wdc','hard drive','hdd'],                      ids: ['WDC'] },
  { kws: ['seagate','stx','hard disk','storage drive'],                      ids: ['STX'] },
  { kws: ['sandisk','sndk','flash storage','nand flash'],                    ids: ['SNDK'] },
  { kws: ['rocket lab','rklb','neutron','electron','launch vehicle'],        ids: ['RKLB'] },
  { kws: ['planet labs','pl','earth observation','satellite imagery'],       ids: ['PL'] },
  { kws: ['intuitive machines','lunr','lunar','moon landing','nasa'],        ids: ['LUNR'] },
  { kws: ['voyager','voyg','space defence','government space'],              ids: ['VOYG'] },
  { kws: ['vaneck space','jedi','space etf','space sector'],                 ids: ['JEDI'] },
  { kws: ['gold','xauusd','safe haven','precious metal','bullion'],          ids: ['XAUUSD','IGLN','SGLN'] },
  { kws: ['crude oil','crude','brent','wti','opec','petroleum','barrel'],    ids: ['CRUDE'] },
  { kws: ['hormuz','iran','middle east','oil supply','energy supply'],       ids: ['CRUDE','XAUUSD','IGLN','SGLN'] },
  { kws: ['semiconductor','chip','chipmaker','silicon','wafer'],             ids: ['NVDA','AMD','ARM','INTC','TSM','MU','SMSN'] },
  { kws: ['ai','artificial intelligence','data center','llm','generative'],  ids: ['NVDA','AMD','MSFT','META','GOOG','GOOGL','ARM'] },
  { kws: ['space','satellite','launch','orbit','rocket','lunar'],            ids: ['RKLB','LUNR','PL','VOYG','JEDI'] },
  { kws: ['storage','flash','nand','dram','memory chip','hdd','ssd'],       ids: ['WDC','STX','SNDK','MU'] },
  { kws: ['cloud','hyperscaler','aws','azure','gcp','data centre'],         ids: ['MSFT','GOOG','GOOGL','META','NVDA'] },
  { kws: ['fed','federal reserve','interest rate','bond','yield','inflation'], ids: ['NVDA','AMD','META','MSFT','GOOG','GOOGL','USA500','TECH100'] },
  { kws: ['taiwan','strait','china invasion','export ban','export control'], ids: ['TSM','NVDA','AMD','ARM','SMSN'] },
  { kws: ['s&p 500','s&p500','nasdaq','stock market rally','market selloff'], ids: ['USA500','TECH100','VUSA','VUAG','VWRP'] },
  { kws: ['war','conflict','military strike','geopolitical'],                ids: ['XAUUSD','IGLN','SGLN','CRUDE'] },
  { kws: ['eli lilly','lilly','lly','mounjaro','zepbound','tirzepatide','glp-1','glp1','incretin','obesity drug','weight loss drug'], ids: ['LLY'] },
  { kws: ['ozempic','wegovy','semaglutide','novo nordisk','nvo','oral semaglutide'], ids: ['NVO', 'LLY'] },
  { kws: ['dupixent','dupilumab','regeneron','regn'], ids: ['REGN'] },
  { kws: ['vertex','vrtx','trikafta','kaftrio','casgevy','cystic fibrosis','suzetrigine'], ids: ['VRTX'] },
  { kws: ['merck','mrk','keytruda','pembrolizumab','keytruda patent'], ids: ['MRK'] },
  { kws: ['fda approval','drug approval','clinical trial','phase 3','pharma','biopharma'], ids: ['LLY','NVO','REGN','VRTX','MRK'] },
  { kws: ['glp','obesity','diabetes drug','insulin','weight loss'], ids: ['LLY','NVO'] },
  { kws: ['oncology','cancer drug','immunotherapy','biologics'], ids: ['REGN','MRK','VRTX'] },
];

// ─── Demo News Data ───────────────────────────────────────────────────
// Realistic mock news per sector, used in demo mode
const DEMO_NEWS = {
  NVDA: [
    { id:1, datetime: Date.now()/1000 - 3600,    source:'Reuters',          headline:'Nvidia Data Center Revenue Surges 427% YoY, Beats Estimates by $2.4B', summary:'Nvidia reported record data center revenue of $22.6B in Q1, driven by explosive demand for H100 and H200 GPUs from cloud hyperscalers. The result beat the Wall Street consensus by over 10%.', _micro:true,  _cat:'earnings',     _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 7200,    source:'Financial Times',  headline:'US Expands AI Chip Export Restrictions to 40 New Countries', summary:'The Commerce Department announced that Nvidia\'s A100 and H100 series GPUs will require export licences for shipment to an expanded list of countries, potentially reducing Nvidia\'s total addressable market by an estimated 8–12%.', _micro:false, _cat:'regulatory',   _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 18000,   source:'Bloomberg',        headline:'Microsoft Doubles Nvidia GPU Order for Azure AI Infrastructure', summary:'Microsoft has placed the largest ever single order for Nvidia H200 GPUs, totalling an estimated $10B investment for Azure\'s AI supercomputer fleet. This underpins strong multi-year demand visibility for Nvidia.', _micro:true,  _cat:'product',      _sent:'bullish' },
    { id:4, datetime: Date.now()/1000 - 36000,   source:'CNBC',             headline:'Fed Holds Rates Steady, Signals Two Cuts Possible in 2025', summary:'The Federal Reserve kept interest rates at 5.25–5.50% but hinted at easing in H2 2025 if inflation continues to cool. Positive for high-growth tech valuations including Nvidia.', _micro:false, _cat:'macro',        _sent:'bullish' },
    { id:5, datetime: Date.now()/1000 - 50000,   source:'Wall Street Journal', headline:'Morgan Stanley Raises Nvidia Price Target to $1,100 on AI Supercycle Thesis', summary:'Analysts at Morgan Stanley revised their 12-month Nvidia price target upward, citing sustained enterprise AI capex growth and Nvidia\'s 80%+ share in accelerated computing.', _micro:true,  _cat:'analyst',      _sent:'bullish' },
    { id:6, datetime: Date.now()/1000 - 72000,   source:'TechCrunch',       headline:'AMD MI300X Gains Traction at Meta, Threatening Nvidia\'s Monopoly', summary:'Meta confirmed deployment of AMD MI300X accelerators for inference workloads, representing the most significant enterprise win yet for AMD against Nvidia in AI data centers.', _micro:true,  _cat:'general',      _sent:'bearish' },
  ],
  RKLB: [
    { id:1, datetime: Date.now()/1000 - 5000,    source:'Space News',       headline:'Rocket Lab Awarded $515M NSSL Phase 3 Lane 1 Contract by US Space Force', summary:'Rocket Lab secured a major US Space Force contract to provide launch services for national security payloads, significantly expanding its government revenue base.', _micro:true,  _cat:'ma',           _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 15000,   source:'Reuters',          headline:'Rocket Lab Neutron Launch Vehicle Delayed 12 Months to 2026', summary:'Rocket Lab confirmed that its larger Neutron rocket, intended to compete with SpaceX Falcon 9, will not fly until late 2026 due to propulsion development challenges.', _micro:true,  _cat:'product',      _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 40000,   source:'Bloomberg',        headline:'US Space Economy Projected to Reach $1.8T by 2035, Goldman Report', summary:'Goldman Sachs published a bullish outlook for the commercial space sector, forecasting compounding growth driven by satellite broadband, earth observation, and government contracts.', _micro:false, _cat:'macro',        _sent:'bullish' },
    { id:4, datetime: Date.now()/1000 - 80000,   source:'CNBC',             headline:'Rocket Lab Q1 Revenue Up 69% YoY But Misses Estimates, Loss Widens', summary:'Rocket Lab reported Q1 revenue of $137M (+69% YoY) but this came in below consensus of $142M. Net loss widened to $55M as R&D spending on Neutron and solar panels division accelerated.', _micro:true,  _cat:'earnings',     _sent:'bearish' },
  ],
  MSFT: [
    { id:1, datetime: Date.now()/1000 - 4000,    source:'Bloomberg',        headline:'Microsoft Azure AI Revenue Grows 33% QoQ, Copilot Now at 100M MAU', summary:'Microsoft\'s cloud division reported accelerating AI-driven growth, with Azure AI services now representing 11% of total Azure revenue. Copilot reached 100M monthly active users across enterprise customers.', _micro:true,  _cat:'earnings',     _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 20000,   source:'Reuters',          headline:'EU Antitrust Regulator Opens Probe into Microsoft Teams Bundling', summary:'The European Commission has launched a formal investigation into Microsoft\'s practice of bundling Teams with Microsoft 365, following complaints from rivals. A fine of up to 10% of annual revenue is theoretically possible.', _micro:true,  _cat:'regulatory',   _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 55000,   source:'Financial Times',  headline:'Fed Rate Cut Expectations Boost Tech Sector, Nasdaq Gains 1.2%', summary:'Growing expectations of Federal Reserve rate cuts in September drove broad-based gains in technology stocks, with growth-oriented names outperforming.', _micro:false, _cat:'macro',        _sent:'bullish' },
  ],
  TSM: [
    { id:1, datetime: Date.now()/1000 - 6000,    source:'Reuters',          headline:'TSMC Arizona Fab Achieves 2nm Yield Milestone Ahead of Schedule', summary:'Taiwan Semiconductor\'s Arizona facility has successfully produced 2nm chips with yields meeting production-quality thresholds, a significant milestone for TSMC\'s US expansion and its key customer Apple.', _micro:true,  _cat:'product',      _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 22000,   source:'Bloomberg',        headline:'US-China Tensions Escalate Over Taiwan Strait Military Exercises', summary:'China conducted its largest military exercises near Taiwan in three years, raising concerns about supply chain risk for TSMC, which manufactures the majority of the world\'s advanced semiconductors.', _micro:false, _cat:'geopolitical', _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 45000,   source:'CNBC',             headline:'TSMC Raises 2025 Revenue Guidance on AI Chip Demand Surge', summary:'TSMC raised its full-year 2025 revenue guidance to 30%+ growth (USD terms), citing surging orders from Nvidia, AMD and Apple for advanced node chips.', _micro:true,  _cat:'guidance',     _sent:'bullish' },
  ],
  XAUUSD: [
    { id:1, datetime: Date.now()/1000 - 3600,    source:'Reuters',          headline:'Gold Hits All-Time High Above $3,500 as Dollar Weakens on Fed Signals', summary:'Gold prices surged to a new all-time high as the US dollar fell following dovish comments from Fed Chair Powell. Central bank buying from China and India continues to underpin demand.', _micro:false, _cat:'macro',        _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 14000,   source:'Financial Times',  headline:'Middle East Ceasefire Talks Reduce Safe-Haven Demand for Gold', summary:'Progress in Gaza ceasefire negotiations reduced geopolitical risk premium in gold prices, with analysts suggesting $150–200/oz of the rally may be unwound if tensions continue to ease.', _micro:false, _cat:'geopolitical', _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 35000,   source:'Bloomberg',        headline:'China PBoC Adds 8.6T Gold to Reserves for 18th Consecutive Month', summary:'The People\'s Bank of China disclosed continued gold accumulation in its reserves, as part of a broader de-dollarisation strategy. Central bank demand has been a key structural driver of gold prices.', _micro:false, _cat:'macro',        _sent:'bullish' },
  ],
  AMD: [
    { id:1, datetime: Date.now()/1000 - 8000,    source:'CNBC',             headline:'AMD MI300X Shipments Triple in Q1, Sets $5B Run Rate for AI Accelerators', summary:'AMD reported that MI300X GPU shipments accelerated sharply in Q1 2025, implying an annualised revenue run rate of approximately $5B from AI accelerators — its fastest-growing segment.', _micro:true,  _cat:'earnings',     _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 30000,   source:'Wall Street Journal', headline:'AMD and Qualcomm Reportedly in Advanced Talks to Acquire Intel Assets', summary:'Unconfirmed reports suggest AMD and Qualcomm are separately evaluating bids for parts of Intel\'s foundry business. If confirmed, this could reshape the semiconductor landscape significantly.', _micro:false, _cat:'ma',           _sent:'bullish' },
    { id:3, datetime: Date.now()/1000 - 60000,   source:'Reuters',          headline:'Semiconductor Export Controls Tighten Further on Advanced Chips to China', summary:'The US Commerce Department expanded restrictions on advanced semiconductor exports including AMD\'s MI300X to China, impacting AMD\'s Chinese data center revenue which accounts for an estimated 15% of AI segment sales.', _micro:true,  _cat:'regulatory',   _sent:'bearish' },
  ],
  META: [
    { id:1, datetime: Date.now()/1000 - 9000,    source:'Reuters',          headline:'Meta AI Daily Active Users Hit 1 Billion Across WhatsApp, Messenger and Instagram', summary:'Meta reported that its AI assistant has now reached 1 billion monthly active interactions, reinforcing its Llama model strategy and advertising personalisation roadmap.', _micro:true,  _cat:'product',      _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 40000,   source:'Bloomberg',        headline:'EU Fines Meta €1.2B for GDPR Violations in Cross-Border Data Transfers', summary:'The Irish Data Protection Commission issued a landmark €1.2B fine against Meta for transferring EU user data to the US without adequate safeguards. Meta has said it will appeal.', _micro:true,  _cat:'regulatory',   _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 70000,   source:'CNBC',             headline:'Meta Raises Full-Year Capex Guidance to $72B on AI Infrastructure Build-Out', summary:'Meta increased its 2025 capital expenditure guidance to $64–72B, significantly above prior guidance of $60–65B, reflecting accelerated AI data center investment. Some investors expressed concern about near-term margin pressure.', _micro:true,  _cat:'guidance',     _sent:'mixed' },
  ],
  LLY: [
    { id:1, datetime: Date.now()/1000 - 4000,    source:'Reuters',          headline:'Eli Lilly Tirzepatide Phase 3 Trial Hits Primary Endpoint for Heart Failure', summary:'Lilly\'s tirzepatide (Mounjaro/Zepbound) demonstrated a statistically significant 38% reduction in heart failure hospitalisation risk in the SUMMIT trial, broadening the drug\'s addressable market well beyond obesity and diabetes into cardiovascular disease.', _micro:true,  _cat:'product',    _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 18000,   source:'Bloomberg',        headline:'GLP-1 Market to Exceed $130B by 2030, Lilly and Novo Nordisk Dominant', summary:'Morgan Stanley projects the GLP-1 drug market will reach $130B annually by 2030, with Eli Lilly\'s tirzepatide and Novo Nordisk\'s semaglutide accounting for over 80% of market share. Lilly\'s once-weekly oral pill pipeline could further extend its lead.', _micro:false, _cat:'analyst',    _sent:'bullish' },
    { id:3, datetime: Date.now()/1000 - 42000,   source:'Wall Street Journal', headline:'FDA Approves Zepbound for Sleep Apnea — First Drug Approved for the Condition', summary:'The FDA granted approval for Eli Lilly\'s Zepbound (tirzepatide) as the first pharmacological treatment for moderate-to-severe obstructive sleep apnoea, a market of ~30 million US patients. Analysts estimate this could add $3–5B in peak annual revenue.', _micro:true,  _cat:'regulatory', _sent:'bullish' },
    { id:4, datetime: Date.now()/1000 - 75000,   source:'CNBC',             headline:'Lilly Q1 Revenue Surges 45% on Mounjaro and Zepbound Demand, Raises Full-Year Guidance', summary:'Eli Lilly reported Q1 revenue of $8.77B (+45% YoY), driven by Mounjaro ($2.3B) and Zepbound ($517M). The company raised full-year guidance to $42–43.5B, above consensus. Manufacturing capacity expansion remains the primary constraint on growth.', _micro:true,  _cat:'earnings',   _sent:'bullish' },
  ],
  NVO: [
    { id:1, datetime: Date.now()/1000 - 5000,    source:'Reuters',          headline:'Novo Nordisk Wegovy Supply Constraints Ease as New Facilities Come Online', summary:'Novo Nordisk confirmed that manufacturing capacity for semaglutide (Wegovy/Ozempic) is expanding materially in 2025 after $6B in capex, reducing the supply shortages that have capped revenue growth and share gain over the past two years.', _micro:true,  _cat:'product',    _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 22000,   source:'Bloomberg',        headline:'Novo Nordisk Oral Semaglutide Phase 3 Shows 15% Weight Loss — Rivals Lilly Pill', summary:'Novo\'s once-daily oral semaglutide achieved 15% average body weight reduction in a 68-week Phase 3 trial, positioning it to compete with Eli Lilly\'s oral tirzepatide. An oral GLP-1 option significantly expands the addressable market.', _micro:true,  _cat:'product',    _sent:'bullish' },
    { id:3, datetime: Date.now()/1000 - 55000,   source:'Financial Times',  headline:'Lilly Tirzepatide Superiority Data Pressures Novo Nordisk Shares', summary:'Head-to-head trial data showing Lilly\'s tirzepatide produces greater weight loss than semaglutide weighed on Novo Nordisk shares. Analysts debated whether the efficacy gap would translate to meaningful market share loss given Novo\'s entrenched prescriber relationships.', _micro:true,  _cat:'analyst',    _sent:'bearish' },
    { id:4, datetime: Date.now()/1000 - 90000,   source:'CNBC',             headline:'Novo Nordisk Q1 Revenue Up 22% but Misses Estimates on Wegovy Mix Shift', summary:'Novo Nordisk reported Q1 sales of DKK65.3B (+22% YoY) but missed consensus by 3% as Wegovy revenue came in below expectations. Management maintained full-year guidance of 16–24% sales growth.', _micro:true,  _cat:'earnings',   _sent:'bearish' },
  ],
  REGN: [
    { id:1, datetime: Date.now()/1000 - 8000,    source:'Wall Street Journal', headline:'Regeneron Dupixent Approved for COPD — Massive New Indication Opens $10B+ Market', summary:'The FDA approved Dupixent (dupilumab) for chronic obstructive pulmonary disease with type-2 inflammation, the first new class of COPD drug in a decade. Analysts estimate peak sales for this indication of $3–5B, adding to Dupixent\'s existing $13B base across atopic dermatitis, asthma, and other indications.', _micro:true,  _cat:'regulatory', _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 30000,   source:'Reuters',          headline:'Regeneron and Sanofi Raise Dupixent Peak Sales Forecast to $20B+', summary:'In an investor update, Regeneron and partner Sanofi raised their long-term peak sales target for Dupixent to over $20B annually, underpinned by continued label expansions and strong new patient starts globally.', _micro:true,  _cat:'guidance',   _sent:'bullish' },
    { id:3, datetime: Date.now()/1000 - 65000,   source:'Bloomberg',        headline:'Regeneron Cancer Drug VEGF Bispecific Shows Promise in Phase 2 Lung Trial', summary:'Regeneron\'s early-stage oncology pipeline delivered positive Phase 2 data for its VEGF/PD-1 bispecific antibody in non-small cell lung cancer, demonstrating a 58% objective response rate in first-line patients. Full Phase 3 trial to begin H2 2025.', _micro:true,  _cat:'product',    _sent:'bullish' },
  ],
  VRTX: [
    { id:1, datetime: Date.now()/1000 - 6000,    source:'Reuters',          headline:'Vertex Casgevy Gene Therapy Approved in US for Sickle Cell Disease — First Functional Cure', summary:'The FDA approved Casgevy (exa-cel), developed by Vertex and CRISPR Therapeutics, as the first CRISPR-based gene therapy for sickle cell disease. With a list price of $2.2M per patient, Vertex holds a first-mover advantage in gene therapy economics.', _micro:true,  _cat:'regulatory', _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 28000,   source:'Bloomberg',        headline:'Vertex Trikafta Franchise Extends Monopoly as Generic Threat Recedes to 2037+', summary:'Vertex\'s cystic fibrosis franchise (Trikafta/Kaftrio) faces no credible generic competition until at least 2037 after a series of patent reinforcements. The drug treats ~90% of all CF patients and generated $9.8B in 2024 revenue with ~80% gross margins.', _micro:true,  _cat:'analyst',    _sent:'bullish' },
    { id:3, datetime: Date.now()/1000 - 58000,   source:'CNBC',             headline:'Vertex Pain Drug Suzetrigine Approved — Enters $10B Non-Opioid Market', summary:'The FDA approved Vertex\'s suzetrigine (VX-548) for moderate-to-severe acute pain as the first new mechanism pain drug in over 20 years and the first non-opioid option in this class. Analysts see $2–4B peak revenue potential as a first-mover in a market historically dominated by opioids.', _micro:true,  _cat:'regulatory', _sent:'bullish' },
    { id:4, datetime: Date.now()/1000 - 85000,   source:'Financial Times',  headline:'Vertex Q1 Net Revenue +12% to $2.77B, Raises Full-Year CF Guidance', summary:'Vertex reported Q1 net revenue of $2.77B (+12% YoY), beating consensus of $2.68B, driven by continued Trikafta penetration in newly eligible patient populations. Full-year CF guidance raised to $11.0–11.2B.', _micro:true,  _cat:'earnings',   _sent:'bullish' },
  ],
  MRK: [
    { id:1, datetime: Date.now()/1000 - 9000,    source:'Reuters',          headline:'Merck Keytruda Wins FDA Approval in 4 New Cancer Types — Total Indications Now 40+', summary:'The FDA granted additional approvals for Keytruda (pembrolizumab) in bladder cancer, cervical cancer adjuvant, colorectal cancer, and biliary tract cancer. Keytruda is now approved in over 40 indications, cementing its position as the world\'s best-selling oncology drug.', _micro:true,  _cat:'regulatory', _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 35000,   source:'Bloomberg',        headline:'Merck Keytruda Patent Cliff Risk in 2028 Looms Despite Pipeline Progress', summary:'Analysts flagged Merck\'s dependence on Keytruda (50%+ of operating income) ahead of its 2028 US patent expiry. Biosimilar entry could cut Keytruda revenue by 30–50% within 2 years. Merck\'s MK-1454 and subcutaneous Keytruda formulations are key to defending the franchise.', _micro:true,  _cat:'analyst',    _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 62000,   source:'Wall Street Journal', headline:'Merck Acquires Prometheus Biosciences for $10.8B to Enter Autoimmune Market', summary:'Merck completed its $10.8B acquisition of Prometheus Biosciences, gaining access to PRA023, a TL1A antibody in Phase 3 for Crohn\'s disease and ulcerative colitis. The deal marks Merck\'s strategic push beyond oncology into immunology ahead of the Keytruda cliff.', _micro:true,  _cat:'ma',         _sent:'bullish' },
    { id:4, datetime: Date.now()/1000 - 88000,   source:'CNBC',             headline:'Merck Q1 Revenue $15.8B +9% YoY, Keytruda Grows 20% to $7.0B', summary:'Merck reported Q1 revenue of $15.8B (+9%), with Keytruda sales of $7.0B (+20%) ahead of consensus. The company raised full-year EPS guidance by $0.10 at the midpoint. Animal health and vaccine divisions added incremental diversification.', _micro:true,  _cat:'earnings',   _sent:'bullish' },
  ],
  _default: [
    { id:1, datetime: Date.now()/1000 - 10000,   source:'Reuters',          headline:'Tech Sector Rallies as Nasdaq Breaks Above Key Resistance Level', summary:'Broad-based technology sector gains were driven by improving sentiment around AI-related earnings and reduced fears of further Fed tightening.', _micro:false, _cat:'macro',        _sent:'bullish' },
    { id:2, datetime: Date.now()/1000 - 35000,   source:'Bloomberg',        headline:'US-China Trade War Escalation Risk Weighs on Global Tech Supply Chains', summary:'Analysts warned of heightened supply chain disruption risk following new US tariff proposals on Chinese electronics. Asian tech manufacturers and their US supply chain partners face margin headwinds.', _micro:false, _cat:'geopolitical', _sent:'bearish' },
    { id:3, datetime: Date.now()/1000 - 60000,   source:'Financial Times',  headline:'Institutional Investors Rotate Into AI Infrastructure Stocks', summary:'Data from Goldman Sachs shows significant institutional rotation from defensive sectors into AI infrastructure plays including semiconductors, data center equipment and cloud providers.', _micro:false, _cat:'general',      _sent:'bullish' },
  ],
};

const DEMO_EARNINGS = [
  { symbol: 'REGN', date: '2026-05-28', epsEst: 12.40, hour: 'amc', quarter: 'Q1 2026' },
  { symbol: 'MRK',  date: '2026-05-29', epsEst:  1.82, hour: 'bmo', quarter: 'Q1 2026' },
  { symbol: 'LLY',  date: '2026-06-03', epsEst:  3.95, hour: 'bmo', quarter: 'Q1 2026' },
  { symbol: 'VRTX', date: '2026-06-05', epsEst:  4.20, hour: 'amc', quarter: 'Q1 2026' },
  { symbol: 'NVO',  date: '2026-06-09', epsEst:  0.71, hour: 'bmo', quarter: 'Q1 2026' },
  { symbol: 'NVDA', date: '2026-06-11', epsEst:  0.85, hour: 'amc', quarter: 'Q1 2026' },
  { symbol: 'MSFT', date: '2026-06-17', epsEst:  2.95, hour: 'amc', quarter: 'Q3 FY2026' },
];

const MACRO_EVENTS = [
  { date: '2026-05-29', name: 'PCE Inflation',      type: 'pce',  impact: 'medium' },
  { date: '2026-06-05', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-06-10', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
  { date: '2026-06-10', name: 'FOMC Decision',       type: 'fed',  impact: 'high'   },
  { date: '2026-06-26', name: 'PCE Inflation',       type: 'pce',  impact: 'medium' },
  { date: '2026-07-10', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-07-14', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
  { date: '2026-07-29', name: 'FOMC Decision',       type: 'fed',  impact: 'high'   },
  { date: '2026-07-31', name: 'PCE Inflation',       type: 'pce',  impact: 'medium' },
  { date: '2026-08-07', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-08-12', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
  { date: '2026-09-04', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-09-11', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
  { date: '2026-09-16', name: 'FOMC Decision',       type: 'fed',  impact: 'high'   },
  { date: '2026-10-02', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-10-13', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
  { date: '2026-10-28', name: 'FOMC Decision',       type: 'fed',  impact: 'high'   },
  { date: '2026-11-06', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-11-12', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
  { date: '2026-12-04', name: 'Jobs Report (NFP)',   type: 'jobs', impact: 'high'   },
  { date: '2026-12-09', name: 'FOMC Decision',       type: 'fed',  impact: 'high'   },
  { date: '2026-12-10', name: 'CPI Release',         type: 'cpi',  impact: 'high'   },
];

// Demo prices (representative, not current)
const DEMO_PRICES = {
  WDC: { price: 45.76, changePct: -0.44, currency: 'USD' },
  STX: { price: 74.41, changePct: -0.93, currency: 'USD' },
  TSM: { price: 175.20, changePct: -0.66, currency: 'USD' },
  SNDK: { price: 63.80, changePct: -0.47, currency: 'USD' },
  MU: { price: 107.44, changePct: -1.47, currency: 'USD' },
  GOOG: { price: 172.68, changePct: -0.50, currency: 'USD' },
  META: { price: 578.30, changePct: -0.46, currency: 'USD' },
  GOOGL: { price: 170.52, changePct: -0.52, currency: 'USD' },
  SMSN: { price: 47.38, changePct: 5.57, currency: 'USD' },
  LNVGY: { price: 33.86, changePct: 4.31, currency: 'USD' },
  ARM: { price: 128.45, changePct: 0.98, currency: 'USD' },
  INTC: { price: 22.83, changePct: -1.73, currency: 'USD' },
  RKLB: { price: 22.55, changePct: -6.54, currency: 'USD' },
  AMD: { price: 106.62, changePct: -2.53, currency: 'USD' },
  MSFT: { price: 418.80, changePct: -0.54, currency: 'USD' },
  PL: { price: 3.24, changePct: -0.66, currency: 'USD' },
  IGLN: { price: 46.85, changePct: 0.78, currency: 'GBP' },
  NVDA: { price: 115.46, changePct: -1.57, currency: 'USD' },
  XAUUSD: { price: 3320.40, changePct: -0.14, currency: 'USD' },
  VOYG: { price: 8.25, changePct: -2.45, currency: 'USD' },
  LUNR: { price: 7.18, changePct: -1.60, currency: 'USD' },
  LLY:  { price: 798.20, changePct: -1.24, currency: 'USD' },
  NVO:  { price: 104.80, changePct: -0.88, currency: 'USD' },
  REGN: { price: 718.40, changePct:  0.42, currency: 'USD' },
  VRTX: { price: 468.55, changePct:  1.14, currency: 'USD' },
  MRK:  { price: 131.20, changePct: -0.33, currency: 'USD' },
  JEDI: { price: 28.42, changePct: 5.07, currency: 'EUR' },
  USA500:  { price: 5842.33,  changePct: -0.29, currency: 'USD' },
  TECH100: { price: 29455.00, changePct:  0.38, currency: 'USD' },
  GER40: { price: 23650.10, changePct: 1.86, currency: 'EUR' },
  JPN225: { price: 37892.50, changePct: -0.28, currency: 'JPY' },
  VUSA: { price: 104.57, changePct: 0.56, currency: 'GBP' },
  VUAG: { price: 106.32, changePct: 0.57, currency: 'GBP' },
  VWRP: { price: 138.14, changePct: 0.88, currency: 'GBP' },
  V3PA: { price: 9.11, changePct: 2.03, currency: 'EUR' },
  EMAS: { price: 98.38, changePct: 1.80, currency: 'CHF' },
  SGLN: { price: 65.38, changePct: 0.28, currency: 'GBP' },
  CRUDE: { price: 99.10, changePct: -0.09, currency: 'USD' },  // WTI front-month CL=F
};
