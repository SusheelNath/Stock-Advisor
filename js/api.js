'use strict';

// ─── Timeout-safe fetch ───────────────────────────────────────────────
function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

// ─── Rate-limited REST queue (for polling / one-off calls) ────────────
const RequestQueue = (() => {
  const queue = [];
  let running = 0;
  const MAX = 8, DELAY = 60;
  function next() {
    if (running >= MAX || !queue.length) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve).catch(reject).finally(() => { running--; setTimeout(next, DELAY); });
  }
  return { add(fn) { return new Promise((res, rej) => { queue.push({ fn, resolve: res, reject: rej }); next(); }); } };
})();

// ─── WebSocket — real-time trades (Finnhub) ──────────────────────────
let _ws            = null;
let _wsTimer       = null;
let _wsConnected   = false;

// Plain US tickers (no colon) → Finnhub trade WebSocket for live prices
const WS_INSTRUMENTS = [...WATCHLIST, ...INDICATORS].filter(i =>
  i.finnhub && !i.finnhub.includes(':')
);
// OANDA CFD symbols + LSE symbols → Finnhub forex/exchange WebSocket
const WS_FOREX = [
  { finnhub: 'OANDA:XAU_USD',  id: 'XAUUSD' },
  { finnhub: 'OANDA:DE30_EUR', id: 'GER40'  },
  { finnhub: 'OANDA:JP225_USD',id: 'JPN225' },
  { finnhub: 'OANDA:BCO_USD',  id: 'CRUDE'  },
  { finnhub: 'LSE:SMSN',       id: 'SMSN'   },  // Samsung GDR on London Stock Exchange
];
// Symbol → instrument id lookup
const WS_ID_MAP = {};
WS_INSTRUMENTS.forEach(i => { WS_ID_MAP[i.finnhub] = i.id; });
WS_FOREX.forEach(f       => { WS_ID_MAP[f.finnhub]  = f.id; });

// Set of instrument IDs that Finnhub WS covers — used to enforce source priority
const FINNHUB_WS_IDS = new Set(Object.values(WS_ID_MAP));

// app.js defines onLiveTrade() in global scope — called on every trade tick

function connectWebSocket() {
  if (!API.token || STATE.demoMode) return;
  clearTimeout(_wsTimer);

  _ws = new WebSocket(`wss://ws.finnhub.io?token=${API.token}`);

  _ws.onopen = () => {
    _wsConnected = true;
    console.info('[WS] Connected — subscribing to', WS_INSTRUMENTS.length + WS_FOREX.length, 'symbols');
    WS_INSTRUMENTS.forEach(i => _ws.send(JSON.stringify({ type: 'subscribe', symbol: i.finnhub })));
    WS_FOREX.forEach(f       => _ws.send(JSON.stringify({ type: 'subscribe', symbol: f.finnhub })));
  };

  _ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;

    msg.data.forEach(trade => {
      const id = WS_ID_MAP[trade.s];
      if (!id) return;

      const existing = STATE.quotes[id];

      // Apply index-level scale for QQQ→TECH100 and SPY→USA500.
      // STATE.priceScales[id] = stooqIndexPrice / etfPrice, set during getPrice().
      // Without a scale yet (first tick before getPrice resolves) we skip the update
      // so we never briefly show $460 for Nasdaq.
      const scale = STATE.priceScales?.[id];
      if (scale === undefined && existing === undefined) return; // wait for REST seed
      const effectiveScale = scale ?? 1;
      const scaledPrice = Math.round(trade.p * effectiveScale * 100) / 100;

      // Keep previous close from the REST-fetched quote (Stooq-level for indices)
      const prevClose = existing?._prevClose ?? existing?.price ?? scaledPrice;
      const changePct = prevClose ? ((scaledPrice - prevClose) / prevClose) * 100 : 0;

      STATE.quotes[id] = {
        price:      scaledPrice,
        changePct:  Math.round(changePct * 100) / 100,
        currency:   existing?.currency   ?? 'USD',
        marketState:'REGULAR',
        _prevClose: prevClose,
        _liveTs:    trade.t,
        _live:      true,
        _source:    'ws',
        _fetchedAt: Date.now(),
      };

      if (typeof onLiveTrade === 'function') onLiveTrade(id);
    });
  };

  _ws.onerror  = () => {};
  _ws.onclose  = () => {
    _wsConnected = false;
    console.info('[WS] Closed — reconnecting in 5s');
    _wsTimer = setTimeout(connectWebSocket, 5000);
  };
}

function disconnectWebSocket() {
  clearTimeout(_wsTimer);
  if (_ws) { _ws.onclose = null; _ws.close(); _ws = null; }
  _wsConnected = false;
}

// ─── Yahoo Finance WebSocket — real-time for indices, ETFs, futures ──
// wss://streamer.finance.yahoo.com/  — no API key required.
// Covers everything Finnhub WS doesn't: ^NDX, ^GSPC, VUSA.L, IGLN.L,
// JEDI.AS, GC=F (gold), CL=F (crude), ^GDAXI, ^N225, etc.
// Messages are binary protobuf — decoded with a minimal inline parser.

let _yfWs        = null;
let _yfWsTimer   = null;
let _yfConnected = false;

// Yahoo symbol → instrument id. Only instruments NOT already on Finnhub WS.
// scaleFromStooq indices: Yahoo gives the real index level directly (no scaling).
const YF_WS_MAP = {
  '^NDX':    'TECH100',   // Nasdaq-100 — real index level
  '^GSPC':   'USA500',    // S&P 500 — real index level
  'VUSA.L':  'VUSA',
  'VUAG.L':  'VUAG',
  'VWRP.L':  'VWRP',
  'V3PA.AS': 'V3PA',
  'EMAS.SW': 'EMAS',
  'IGLN.L':  'IGLN',
  'SGLN.L':  'SGLN',
  'JEDI.AS': 'JEDI',
  'GC=F':    'XAUUSD',   // Gold futures (≈ spot; backup to OANDA WS)
  'CL=F':    'CRUDE',    // WTI crude  (backup to OANDA WS)
  '^GDAXI':  'GER40',    // DAX backup
  '^N225':   'JPN225',   // Nikkei backup
};

// ── Minimal protobuf decoder (fields we need from YahooFinancePricingData) ──
// Wire types: 0=varint, 1=64-bit, 2=LEN, 5=32-bit(float)
// Field 1 = id (string, LEN), 2 = price (float32), 8 = changePercent (float32),
// 16 = previousClose (float32)
function _decodeYFProto(buf) {
  const u8   = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 0;
  const out = {};

  function varint() {
    let v = 0, s = 0;
    while (pos < u8.length) {
      const b = u8[pos++];
      v |= (b & 0x7F) << s;
      if (!(b & 0x80)) break;
      s += 7;
    }
    return v;
  }

  try {
    while (pos < u8.length) {
      const tag   = varint();
      const field = tag >>> 3;
      const wire  = tag & 0x7;

      if      (wire === 0) { varint(); }           // varint — skip
      else if (wire === 1) { pos += 8; }           // 64-bit — skip
      else if (wire === 2) {                        // length-delimited
        const len = varint();
        if (field === 1) out.id = new TextDecoder().decode(u8.subarray(pos, pos + len));
        pos += len;
      }
      else if (wire === 5) {                        // 32-bit float
        const val = view.getFloat32(pos, true);    // little-endian
        pos += 4;
        if (field === 2)  out.price          = val;
        if (field === 8)  out.changePercent  = val;
        if (field === 16) out.previousClose  = val;
      }
      else break;                                   // unknown wire type
    }
  } catch {}
  return out;
}

function connectYahooWebSocket() {
  if (STATE.demoMode) return;
  clearTimeout(_yfWsTimer);

  _yfWs = new WebSocket('wss://streamer.finance.yahoo.com/');
  _yfWs.binaryType = 'arraybuffer';

  _yfWs.onopen = () => {
    _yfConnected = true;
    const symbols = Object.keys(YF_WS_MAP);
    _yfWs.send(JSON.stringify({ subscribe: symbols }));
    console.info('[YF-WS] Connected — subscribed to', symbols.length, 'symbols:', symbols.join(', '));
  };

  _yfWs.onmessage = (evt) => {
    if (!(evt.data instanceof ArrayBuffer)) return;
    const decoded = _decodeYFProto(evt.data);
    if (!decoded.id || decoded.price == null || decoded.price <= 0) return;

    const id = YF_WS_MAP[decoded.id];
    if (!id) return;

    const existing = STATE.quotes[id];

    // ── Source priority: Finnhub is primary, Yahoo WS is secondary ───────
    // If this instrument has Finnhub WS coverage AND Finnhub fired within the
    // last 30 seconds, discard the Yahoo tick — Finnhub data is authoritative.
    // For instruments Finnhub doesn't cover (indices, LSE/AMS ETFs), Yahoo WS
    // is the primary real-time source and fires freely.
    if (FINNHUB_WS_IDS.has(id)) {
      const finnhubAge = existing?._source === 'ws' ? (Date.now() - existing._fetchedAt) : Infinity;
      if (finnhubAge < 30000) return;  // Finnhub fresh — ignore Yahoo tick
    }

    const price     = Math.round(decoded.price * 100) / 100;
    const prevClose = decoded.previousClose > 0
      ? Math.round(decoded.previousClose * 100) / 100
      : existing?._prevClose ?? price;
    const changePct = decoded.changePercent != null
      ? Math.round(decoded.changePercent * 100) / 100
      : (prevClose ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : 0);

    STATE.quotes[id] = {
      price,
      changePct,
      currency:    existing?.currency   ?? 'USD',
      marketState: 'REGULAR',
      _prevClose:  prevClose,
      _liveTs:     Date.now(),
      _live:       true,
      _source:     'yf-ws',
      _fetchedAt:  Date.now(),
    };

    // For scaleFromStooq indices (TECH100/USA500): update price scale so Finnhub
    // QQQ/SPY WS ticks remain correctly scaled to index level.
    const inst = [...WATCHLIST, ...INDICATORS].find(i => i.id === id);
    if (inst?.scaleFromStooq && STATE.priceScales) {
      const etfQ = Object.entries(STATE.quotes).find(([k]) => {
        const i2 = [...WATCHLIST, ...INDICATORS].find(x => x.id === k);
        return i2?.finnhub && !i2.finnhub.includes(':') && i2.scaleFromStooq && i2.id === id;
      });
      // Scale is recalculated by getPrice() REST calls — leave it alone here.
    }

    if (typeof onLiveTrade === 'function') onLiveTrade(id);
  };

  _yfWs.onerror  = () => {};
  _yfWs.onclose  = () => {
    _yfConnected = false;
    console.info('[YF-WS] Closed — reconnecting in 8s');
    _yfWsTimer = setTimeout(connectYahooWebSocket, 8000);
  };
}

function disconnectYahooWebSocket() {
  clearTimeout(_yfWsTimer);
  if (_yfWs) { _yfWs.onclose = null; _yfWs.close(); _yfWs = null; }
  _yfConnected = false;
}

// ─── Finnhub REST quote (US stocks — initial prevClose seed) ─────────
async function fetchFinnhubQuote(symbol) {
  const url  = `${API.FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${API.token}`;
  const resp = await fetchWithTimeout(url, 6000);
  if (!resp.ok) throw new Error(`Finnhub quote ${resp.status}`);
  const d = await resp.json();
  if (!d || d.c === 0) throw new Error('Empty quote');
  return {
    price:      Math.round(d.c  * 100) / 100,
    changePct:  Math.round(d.dp * 100) / 100,
    currency:   'USD',
    marketState:'REGULAR',
    _prevClose:  d.pc,
    _live:       false,
    _source:     'finnhub',
    _fetchedAt:  Date.now(),
  };
}

// ─── Chart range config ───────────────────────────────────────────────
const CHART_RANGES = {
  '1D':  { finnhubDays: 1,    finnhubRes: '5',  yahooRange: '1d',   yahooInterval: '5m'  },
  '3D':  { finnhubDays: 3,    finnhubRes: '15', yahooRange: '5d',   yahooInterval: '15m' },
  '1W':  { finnhubDays: 7,    finnhubRes: '60', yahooRange: '5d',   yahooInterval: '1h'  },
  '2W':  { finnhubDays: 14,   finnhubRes: '60', yahooRange: '1mo',  yahooInterval: '1h'  },
  '1M':  { finnhubDays: 30,   finnhubRes: 'D',  yahooRange: '1mo',  yahooInterval: '1d'  },
  '3M':  { finnhubDays: 90,   finnhubRes: 'D',  yahooRange: '3mo',  yahooInterval: '1d'  },
  '6M':  { finnhubDays: 180,  finnhubRes: 'D',  yahooRange: '6mo',  yahooInterval: '1d'  },
  '1Y':  { finnhubDays: 365,  finnhubRes: 'D',  yahooRange: '1y',   yahooInterval: '1d'  },
  '5Y':  { finnhubDays: 1825, finnhubRes: 'W',  yahooRange: '5y',   yahooInterval: '1wk' },
  'Max': { finnhubDays: 7300, finnhubRes: 'M',  yahooRange: 'max',  yahooInterval: '1mo' },
};

// ─── Yahoo Finance — parallel proxy race ─────────────────────────────
// All proxies fire simultaneously; first valid response wins.
// Worst-case with sequential fallback: 6 × 12 s = 72 s. With Promise.any: ~1–3 s.
const YAHOO_PROXIES = [
  { url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,        unwrap: null },
  { url: (u) => `https://thingproxy.freeboard.io/fetch/${u}`,                         unwrap: null },
  { url: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,                 unwrap: null },
  { url: (u) => `https://cors.eu.org/${u}`,                                           unwrap: null },
  { url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,         unwrap: (j) => JSON.parse(j.contents) },
  { url: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,                     unwrap: null },
  { url: (u) => `https://proxy.cors.sh/${u}`,                                         unwrap: null },
  { url: (u) => `https://yahooproxy.vercel.app/api/quote?symbol=${encodeURIComponent(u)}`, unwrap: null },
];

function _parseYahooResult(result) {
  const meta = result.meta;
  const ts   = result.timestamp;
  const q    = result.indicators?.quote?.[0];
  return {
    timestamps:         ts,
    closes:             q?.close,
    opens:              q?.open,
    highs:              q?.high,
    lows:               q?.low,
    currency:           meta?.currency || 'USD',
    marketState:        meta?.marketState || 'CLOSED',
    regularMarketPrice: meta?.regularMarketPrice,
    previousClose:      meta?.chartPreviousClose ?? meta?.previousClose,
    changePct:          meta?.regularMarketChangePercent,
  };
}

async function fetchYahooChart(yahooSymbol, interval, range, bustCache = false) {
  const bust     = bustCache ? `&_=${Date.now()}` : '';
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}${bust}`;

  // Race all proxies in parallel — first valid result wins
  const attempts = YAHOO_PROXIES.map(async proxy => {
    const resp   = await fetchWithTimeout(proxy.url(yahooUrl), 10000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw    = await resp.json();
    const parsed = proxy.unwrap ? proxy.unwrap(raw) : raw;
    const result = parsed?.chart?.result?.[0];
    if (!result) throw new Error('no result');
    return _parseYahooResult(result);
  });

  try {
    return await Promise.any(attempts);
  } catch {
    return null;   // all proxies failed
  }
}

async function fetchYahooPrice(yahooSymbol) {
  // Short intraday range + cache-bust ensures live meta.regularMarketPrice
  const result = await fetchYahooChart(yahooSymbol, '5m', '1d', true);
  if (!result) throw new Error(`Yahoo: all proxies failed for ${yahooSymbol}`);

  // Prefer meta.regularMarketPrice — always the live market price, not a closed bar
  const price = result.regularMarketPrice
    ?? result.closes?.filter(v => v != null).slice(-1)[0];
  if (!price) throw new Error('No price data');

  const prev = result.previousClose
    ?? result.closes?.filter(v => v != null).slice(-2)[0]
    ?? price;

  // Prefer meta.regularMarketChangePercent for accurate 1D % vs previous close
  const changePct = result.changePct != null
    ? Math.round(result.changePct * 100) / 100
    : Math.round(((price - prev) / prev) * 10000) / 100;

  return {
    price:      Math.round(price * 100) / 100,
    changePct,
    currency:   result.currency,
    marketState: result.marketState,
    _prevClose:  prev,
    _live:       false,
    _source:     'yahoo',
    _fetchedAt:  Date.now(),
  };
}

// ─── Stooq — direct data feed (no proxy needed, real index levels) ───
// Returns daily OHLCV; the most recent row = current session price.
// Data is ~15-min delayed intraday; accurate index/ETF values (not ETF proxies).
async function fetchStooqPrice(stooqSymbol, currency = 'USD') {
  const to   = new Date();
  const from = new Date(to.getTime() - 7 * 86400000); // 7 days back covers weekends
  const d1   = from.toISOString().slice(0, 10).replace(/-/g, '');
  const d2   = to.toISOString().slice(0, 10).replace(/-/g, '');
  const url  = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${d1}&d2=${d2}&i=d`;
  const resp = await fetchWithTimeout(url, 8000);
  if (!resp.ok) throw new Error(`Stooq HTTP ${resp.status}`);
  const text = await resp.text();
  // Stooq returns "No data found" or HTML when a symbol is invalid
  if (!text || text.includes('No data') || text.trim().startsWith('<')) throw new Error('No Stooq data');
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Stooq: too few rows');
  const headers  = lines[0].toLowerCase().split(',').map(h => h.trim());
  const closeIdx = headers.indexOf('close');
  if (closeIdx < 0) throw new Error('Stooq: no close column');
  // Data is oldest→newest; last row = most recent trading session
  const lastRow = lines[lines.length - 1].split(',');
  const prevRow = lines.length >= 3 ? lines[lines.length - 2].split(',') : null;
  const price     = parseFloat(lastRow[closeIdx]);
  const prevClose = prevRow ? parseFloat(prevRow[closeIdx]) : price;
  if (!price || price <= 0) throw new Error('Stooq: invalid price');
  return {
    price:      Math.round(price     * 100) / 100,
    changePct:  prevRow ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : 0,
    currency,
    marketState: 'REGULAR',
    _prevClose:  prevClose,
    _live:       false,
    _source:     'stooq',
    _fetchedAt:  Date.now(),
  };
}

// ─── Twelve Data — real-time REST (free, no CORS proxy needed) ───────
// Free tier: 800 credits/day, 8 req/min. Covers indices, major ETFs, stocks.
// Get key at https://twelvedata.com/ (free signup, no card required).
// Source priority: Finnhub WS > Twelve Data > Yahoo proxy > Stooq
async function fetchTwelveDataPrice(tdSymbol, currency = 'USD') {
  const key = API.twelveDataKey;
  if (!key) throw new Error('No Twelve Data key configured');

  // Single /quote call returns price + change + prev_close in one request (1 credit)
  const url  = `${API.TWELVEDATA_BASE}/quote?symbol=${encodeURIComponent(tdSymbol)}&apikey=${key}`;
  const resp = await fetchWithTimeout(url, 8000);
  if (!resp.ok) throw new Error(`TwelveData HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.status === 'error' || !d.close) throw new Error(d.message || 'TwelveData: no data');

  const price    = parseFloat(d.close);
  const prevClose = parseFloat(d.previous_close ?? d.close);
  const changePct = d.percent_change != null
    ? Math.round(parseFloat(d.percent_change) * 100) / 100
    : Math.round(((price - prevClose) / prevClose) * 10000) / 100;

  return {
    price:      Math.round(price * 100) / 100,
    changePct,
    currency:   d.currency || currency,
    marketState: d.is_market_open ? 'REGULAR' : 'CLOSED',
    _prevClose:  Math.round(prevClose * 100) / 100,
    _live:       false,
    _source:     'twelvedata',
    _fetchedAt:  Date.now(),
  };
}

// ─── Finnhub news ─────────────────────────────────────────────────────
async function fetchFinnhubNews(symbol) {
  if (!API.token || !symbol) return [];
  const to   = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - API.NEWS_LOOKBACK_DAYS * 86400000).toISOString().split('T')[0];
  const url  = `${API.FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${API.token}`;
  const resp = await fetchWithTimeout(url, 10000);
  if (!resp.ok) throw new Error(`Finnhub news ${resp.status}`);
  const items = await resp.json();
  return Array.isArray(items) ? items.slice(0, 30) : [];
}

async function fetchFinnhubMarketNews() {
  if (!API.token) return [];
  const url  = `${API.FINNHUB_BASE}/news?category=general&token=${API.token}`;
  const resp = await fetchWithTimeout(url, 10000);
  if (!resp.ok) throw new Error(`Finnhub market news ${resp.status}`);
  const items = await resp.json();
  return Array.isArray(items) ? items.slice(0, 20) : [];
}

// ─── Yahoo Finance news (fallback for non-Finnhub instruments) ────────
const YF_NEWS_PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function fetchYahooNews(yahooSymbol) {
  if (!yahooSymbol) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&newsCount=25&enableFuzzyQuery=false`;
  for (const mkProxy of YF_NEWS_PROXIES) {
    try {
      const resp = await fetchWithTimeout(mkProxy(url), 8000);
      if (!resp.ok) continue;
      const data = await resp.json();
      const items = data?.news || [];
      if (!items.length) continue;
      return items.slice(0, 25).map(n => ({
        id:       n.uuid,
        headline: n.title,
        source:   n.publisher,
        datetime: n.providerPublishTime,
        url:      n.link,
        _yfNews:  true,
      }));
    } catch { /* try next proxy */ }
  }
  return [];
}

// ─── Price source selection ───────────────────────────────────────────
function usesFinnhubRest(instrument) {
  const f = instrument.finnhub;
  // scaleFromStooq instruments (QQQ→TECH100, SPY→USA500) use Stooq/Yahoo for charts
  // so that chart prices display at real index levels, not ETF prices.
  return !!(f && !f.includes(':') && !instrument.scaleFromStooq);
}

// ─── Source priority per instrument type ─────────────────────────────
// US stocks / OANDA CFDs : Finnhub WebSocket (tick-level) → Finnhub REST
// Indices (scaleFromStooq): Finnhub WS (scaled) + Stooq || TwelveData || Yahoo (parallel)
// Non-Finnhub ETFs/indices: TwelveData → Yahoo (parallel proxies) → Stooq
//
// JS is single-threaded but all network I/O is async/concurrent.
// Promise.any() races all sources simultaneously — fastest valid response wins.
// Promise.allSettled() fetches all instruments in parallel (see refreshPrices).

async function getPrice(instrument) {
  if (STATE.demoMode) {
    const base = DEMO_PRICES[instrument.id];
    if (!base) return null;
    const j = (Math.random() - 0.5) * 0.001 * base.price;
    return { ...base, price: Math.round((base.price + j) * 100) / 100, _live: false };
  }

  const cur = instrument.currency || 'USD';

  // ── 1a. scaleFromStooq indices (TECH100/NDX, USA500/S&P) ──────────────
  // Fetch ETF (Finnhub REST, live) + index level (TwelveData || Stooq || Yahoo) in parallel.
  // ETF/index ratio → STATE.priceScales so WS ticks are correctly scaled.
  if (API.token && instrument.finnhub && instrument.scaleFromStooq) {
    return RequestQueue.add(async () => {
      const idxSources = [];
      if (instrument.twelvedata && API.twelveDataKey)
        idxSources.push(fetchTwelveDataPrice(instrument.twelvedata, cur));
      if (instrument.stooq)
        idxSources.push(fetchStooqPrice(instrument.stooq, cur));
      if (instrument.yahoo)
        idxSources.push(fetchYahooPrice(instrument.yahoo));

      const [etfResult, idxResult] = await Promise.allSettled([
        fetchFinnhubQuote(instrument.finnhub),
        idxSources.length ? Promise.any(idxSources) : Promise.reject(new Error('no index source')),
      ]);

      if (idxResult.status === 'fulfilled') {
        const idx = idxResult.value;
        if (etfResult.status === 'fulfilled' && etfResult.value.price > 0)
          STATE.priceScales[instrument.id] = idx.price / etfResult.value.price;
        return idx;
      }
      if (etfResult.status === 'fulfilled') return etfResult.value;
      throw new Error('all price sources failed for ' + instrument.id);
    });
  }

  // ── 1b. Finnhub REST (US stocks + OANDA CFDs with finnhub symbol) ─────
  if (API.token && instrument.finnhub) {
    return RequestQueue.add(() =>
      fetchFinnhubQuote(instrument.finnhub).catch(() => {
        const fallbacks = [];
        if (instrument.twelvedata && API.twelveDataKey)
          fallbacks.push(fetchTwelveDataPrice(instrument.twelvedata, cur));
        if (instrument.stooq)
          fallbacks.push(fetchStooqPrice(instrument.stooq, cur));
        if (instrument.yahoo)
          fallbacks.push(fetchYahooPrice(instrument.yahoo));
        if (fallbacks.length) return Promise.any(fallbacks);
        throw new Error('all price sources failed');
      })
    );
  }

  // ── 2. Non-Finnhub instruments (LSE/Euronext ETFs, no WS coverage) ───
  // Race TwelveData + Yahoo proxies + Stooq simultaneously.
  return RequestQueue.add(async () => {
    const sources = [];
    if (instrument.twelvedata && API.twelveDataKey)
      sources.push(fetchTwelveDataPrice(instrument.twelvedata, cur));
    if (instrument.yahoo)
      sources.push(fetchYahooPrice(instrument.yahoo));
    if (instrument.stooq)
      sources.push(fetchStooqPrice(instrument.stooq, cur));
    if (!sources.length) throw new Error('no price source configured for ' + instrument.id);
    return Promise.any(sources);
  });
}

async function getNews(instrument) {
  if (STATE.demoMode) {
    return (DEMO_NEWS[instrument.id] || DEMO_NEWS._default).map(i => ({ ...i }));
  }

  const fh = instrument.finnhub;

  // Plain US tickers → Finnhub company-news (best source), Yahoo as fallback
  if (API.token && fh && !fh.includes(':')) {
    return RequestQueue.add(async () => {
      const items = await fetchFinnhubNews(fh).catch(() => []);
      if (items.length) return items;
      // Finnhub returned empty — try Yahoo
      return fetchYahooNews(instrument.yahoo || fh).catch(() => []);
    });
  }

  // LSE symbols (e.g. LSE:SMSN) — Finnhub company-news rarely works for these; use Yahoo
  if (fh && fh.startsWith('LSE:') && instrument.yahoo) {
    return RequestQueue.add(() => fetchYahooNews(instrument.yahoo).catch(() => []));
  }

  // OANDA / FX / commodity symbols — no company-news endpoint; use Yahoo
  if (fh && fh.startsWith('OANDA:') && instrument.yahoo) {
    return RequestQueue.add(() => fetchYahooNews(instrument.yahoo).catch(() => []));
  }

  // No finnhub symbol (ETFs, LSE/AMS instruments) — use Yahoo
  if (instrument.yahoo) {
    return RequestQueue.add(() => fetchYahooNews(instrument.yahoo).catch(() => []));
  }

  return [];
}

async function getMarketNews() {
  if (STATE.demoMode) return [];
  return RequestQueue.add(() => fetchFinnhubMarketNews());
}

// ─── Historical OHLCV for chart ───────────────────────────────────────
async function fetchChartData(instrument, rangeKey = '1M') {
  const cfg = CHART_RANGES[rangeKey] || CHART_RANGES['1M'];

  // Try Finnhub candles for US stocks first (no proxy needed)
  if (API.token && usesFinnhubRest(instrument)) {
    const to   = Math.floor(Date.now() / 1000);
    const from = to - cfg.finnhubDays * 86400;
    const url  = `${API.FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(instrument.finnhub)}&resolution=${cfg.finnhubRes}&from=${from}&to=${to}&token=${API.token}`;
    try {
      const resp = await fetchWithTimeout(url, 10000);
      const d    = await resp.json();
      if (d.s === 'ok' && Array.isArray(d.t) && d.t.length > 1) {
        return { timestamps: d.t, closes: d.c, opens: d.o, highs: d.h, lows: d.l, currency: STATE.quotes[instrument.id]?.currency || 'USD' };
      }
    } catch {}
  }

  // Fallback: Yahoo Finance via proxy
  return fetchYahooChart(instrument.yahoo, cfg.yahooInterval, cfg.yahooRange);
}

// ─── Batch loaders ────────────────────────────────────────────────────
// onEach(id) is called as each instrument resolves — enables progressive UI updates
async function loadAllPrices(onEach) {
  const all = [...WATCHLIST, ...INDICATORS];
  await Promise.allSettled(all.map(async (inst) => {
    const q = await getPrice(inst).catch(() => null);
    if (q) STATE.quotes[inst.id] = q;
    onEach?.(inst.id);  // always tick progress even on failure
  }));
}

// ─── Earnings Calendar (Finnhub) ──────────────────────────────────────
// ─── Finnhub Insider Transactions ────────────────────────────────────
async function fetchInsiderTransactions(symbol) {
  if (!API.token || !symbol) return [];
  // Fetch 6 months back so we always have meaningful history
  const to   = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
  const url  = `${API.FINNHUB_BASE}/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${API.token}`;
  const resp = await fetchWithTimeout(url, 10000);
  if (!resp.ok) throw new Error(`Finnhub insider ${resp.status}`);
  const data = await resp.json();
  // data.data is the array; filter to open-market buys/sells only (not awards/options)
  return Array.isArray(data?.data) ? data.data : [];
}

async function fetchEarningsCalendar(fromDate, toDate) {
  if (!API.token) return [];
  const url = `${API.FINNHUB_BASE}/calendar/earnings?from=${fromDate}&to=${toDate}&token=${API.token}`;
  const resp = await fetchWithTimeout(url, 10000);
  if (!resp.ok) throw new Error(`Finnhub earnings ${resp.status}`);
  const data = await resp.json();
  return data?.earningsCalendar || [];
}

async function loadAllNews(onEach) {
  const marketNews = await getMarketNews().catch(() => []);
  const all = [...WATCHLIST, ...INDICATORS];

  INDICATORS.forEach(i => {
    STATE.news[i.id] = [...(STATE.news[i.id] || []), ...marketNews].slice(0, 15);
  });

  await Promise.allSettled(all.map(async (inst) => {
    const items = await getNews(inst).catch(() => []);
    const merged = [...items, ...(STATE.news[inst.id] || [])];
    const seen   = new Set();
    STATE.news[inst.id] = merged.filter(item => {
      const key = item.id || item.headline;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40);
    onEach?.(inst.id);
  }));
}
