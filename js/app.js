'use strict';

// ─── Global State ─────────────────────────────────────────────────────
const STATE = {
  activeId: null,
  activeTab: 'watchlist',
  activeHorizon: 'short',
  chartRange: '1M',
  demoMode: false,
  quotes: {},
  news: {},
  signals: {},
  notifications: [],
  unreadCount: 0,
  priceTimer: null,
  newsTimer: null,
  clockTimer: null,
  priceScales: {},   // QQQ/SPY → actual index-level scale factors for WebSocket
  chartData:   {},   // id → { rangeKey → {timestamps,closes,...,_cachedAt} }
  showProjection: false,  // Feature 11: compound projector toggle
  heatmapPeriod: '1D',   // Overview heatmap period tab
  overlays: { ma50: false, ma200: false, rsi: false },
  earnings: [],
  insiders: {},   // id → { data: [...], fetchedAt: ts } | 'loading' | 'error'
};

// ─── Market Hours ──────────────────────────────────────────────────────
// Exchange → {tz, open, close} in local exchange time (24h HH:MM)
const EXCHANGE_HOURS = {
  NYSE:     { tz: 'America/New_York',    open: '09:30', close: '16:00', label: 'NYSE'      },
  NASDAQ:   { tz: 'America/New_York',    open: '09:30', close: '16:00', label: 'NASDAQ'    },
  LSE:      { tz: 'Europe/London',       open: '08:00', close: '16:30', label: 'LSE'       },
  EURONEXT: { tz: 'Europe/Amsterdam',    open: '09:00', close: '17:30', label: 'Euronext'  },
  TSE:      { tz: 'Asia/Tokyo',          open: '09:00', close: '15:30', label: 'TSE'       },
  FOREX:    { tz: 'UTC',                 open: '00:00', close: '23:59', label: '24/7 FX'   },
};

// Which exchange each instrument trades on
const INSTRUMENT_EXCHANGE = {
  WDC:'NASDAQ', STX:'NASDAQ', SNDK:'NASDAQ', MU:'NASDAQ', TSM:'NYSE', ARM:'NASDAQ',
  INTC:'NASDAQ', AMD:'NASDAQ', NVDA:'NASDAQ', MSFT:'NASDAQ', GOOGL:'NASDAQ', GOOG:'NASDAQ',
  META:'NASDAQ', SMSN:'LSE', LNVGY:'NYSE', LLY:'NYSE', NVO:'NYSE', REGN:'NASDAQ', VRTX:'NASDAQ', MRK:'NYSE', RKLB:'NASDAQ', PL:'NASDAQ', VOYG:'NASDAQ',
  LUNR:'NASDAQ', JEDI:'EURONEXT', IGLN:'LSE', XAUUSD:'FOREX',
  USA500:'NYSE', TECH100:'NASDAQ', GER40:'EURONEXT', JPN225:'TSE',
  VUSA:'LSE', VUAG:'LSE', VWRP:'LSE', V3PA:'EURONEXT', EMAS:'EURONEXT',
  SGLN:'LSE', CRUDE:'FOREX',
};

// ─── Macro Factor Sensitivities ───────────────────────────────────────
// market: beta to broad US market (higher = more correlated)
// oil:    positive = benefits from rising oil; negative = hurt by oil, benefits from oil dip
// gold:   positive = safe-haven (benefits from gold rising); negative = risk-on (benefits from gold dipping)
// intl:   true = priced/listed outside USD → USD strength headwind
const MACRO_SENSITIVITIES = {
  NVDA:  { market: 2.0, oil: -0.8, gold: -1.0 },
  AMD:   { market: 1.8, oil: -0.6, gold: -0.9 },
  MU:    { market: 1.5, oil: -0.4, gold: -0.8 },
  TSM:   { market: 1.4, oil: -0.5, gold: -0.7, intl: true },
  ARM:   { market: 1.7, oil: -0.5, gold: -0.9 },
  INTC:  { market: 1.2, oil: -0.3, gold: -0.5 },
  WDC:   { market: 1.3, oil: -0.3, gold: -0.6 },
  STX:   { market: 1.3, oil: -0.3, gold: -0.6 },
  SNDK:  { market: 1.3, oil: -0.3, gold: -0.6 },
  MSFT:  { market: 1.5, oil: -0.5, gold: -0.8 },
  GOOGL: { market: 1.5, oil: -0.4, gold: -0.7 },
  GOOG:  { market: 1.5, oil: -0.4, gold: -0.7 },
  META:  { market: 1.6, oil: -0.3, gold: -0.7 },
  SMSN:  { market: 1.2, oil: -0.4, gold: -0.5, intl: true },
  LNVGY: { market: 1.1, oil: -0.4, gold: -0.4, intl: true },
  LLY:   { market: 0.5, oil: -0.1, gold:  0.3 },
  NVO:   { market: 0.5, oil: -0.1, gold:  0.3, intl: true },
  REGN:  { market: 0.5, oil: -0.1, gold:  0.3 },
  VRTX:  { market: 0.5, oil: -0.1, gold:  0.2 },
  MRK:   { market: 0.4, oil: -0.1, gold:  0.4 },
  RKLB:  { market: 1.9, oil: -0.5, gold: -1.0 },
  PL:    { market: 1.7, oil: -0.4, gold: -0.9 },
  VOYG:  { market: 1.6, oil: -0.3, gold: -0.8 },
  LUNR:  { market: 1.8, oil: -0.4, gold: -1.0 },
  JEDI:  { market: 1.5, oil: -0.4, gold: -0.7, intl: true },
  VUSA:  { market: 1.0, oil: -0.2, gold: -0.5 },
  VUAG:  { market: 1.0, oil: -0.2, gold: -0.5 },
  VWRP:  { market: 0.9, oil: -0.1, gold: -0.4 },
  V3PA:  { market: 0.9, oil: -0.1, gold: -0.4, intl: true },
  EMAS:  { market: 0.8, oil:  0.1, gold: -0.3, intl: true },
};

const MACRO_TRAIT_NOTES = {
  NVDA:  'AI accelerator leader — highest market beta in list; data center energy costs directly impact margins',
  AMD:   'High-beta growth; AI/MI300X ramp accelerates in risk-on cycles; amplified in both directions',
  MU:    'Memory cycles are leveraged plays on data center expansion — amplified in broad market moves',
  TSM:   'ADR pricing creates USD headwind in dollar-strength environment; fab energy is ~15% of COGS',
  ARM:   'Royalty model at a high valuation multiple — sentiment swings amplified in both directions',
  INTC:  'Foundry turnaround lowers correlation with sector; lower beta than NVDA/AMD near-term',
  WDC:   'HDD/NAND demand follows AI training storage cycle — directionally in line with semis',
  STX:   'HDD market stabilizing; demand driven by nearline cloud storage expansion',
  SNDK:  'Flash pricing recovery correlates with broader semiconductor demand cycle',
  MSFT:  'Azure + AI Copilot upsell accelerate in macro-confident enterprise environments',
  GOOGL: 'Ad revenue is a risk-on proxy; Cloud + AI diversification adds second-order upside',
  GOOG:  'Ad revenue is a risk-on proxy; Cloud + AI diversification adds second-order upside',
  META:  'Ad revenue directly tracks consumer confidence; Meta AI infra benefits from cheap energy',
  SMSN:  'Memory + foundry dual exposure; KRW vs USD can offset upside for US holders',
  LNVGY: 'Server & PC refresh benefiting from AI enterprise rollout; CNY listing introduces FX drag',
  LLY:   'GLP-1 pipeline is secular growth — macro largely irrelevant; slight defensive character caps upside in rallies',
  NVO:   'Ozempic/Wegovy demand is macro-independent; DKK/USD headwind in strong-dollar environments',
  REGN:  'Dupixent + Eylea are demand-inelastic biologics; defensive profile limits macro-driven upside',
  VRTX:  'CF franchise is condition-driven; gene-editing optionality is long-duration and macro-insensitive',
  MRK:   'Most defensive name in list — Keytruda revenues are healthcare-cycle independent; gold-like character',
  RKLB:  'Speculative launch vehicle — very high beta; low liquidity amplifies macro swings significantly',
  PL:    'Satellite imagery SaaS; govt/intelligence contracts provide a floor, but sentiment drives valuation',
  VOYG:  'Early-stage space infrastructure; near-term price driven almost entirely by risk appetite',
  LUNR:  'Lunar surface contracts give visible revenue; near-term stock is a pure sentiment proxy',
  JEDI:  'EU defense-linked contracts partially insulate from pure risk-on swings; EUR/USD cross drag',
  VUSA:  'Pure S&P 500 tracker — clean market beta, no stock-specific noise',
  VUAG:  'S&P 500 GBP-accumulating — near-perfect beta, minor GBP/USD drag',
  VWRP:  'All-world diversification smooths single-market volatility; slight EM lag in pure US rallies',
  V3PA:  'All-world EUR share class; EUR/USD introduces mild variance vs pure USD exposure',
  EMAS:  'EM equity exposure adds commodity linkage (oil exporters) and USD headwind for EM assets',
};

function getExchangeNow(exchangeKey) {
  const ex = EXCHANGE_HOURS[exchangeKey];
  if (!ex) return null;
  try {
    const now = new Date();
    // Get current time in the exchange timezone
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ex.tz, hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short',
    }).formatToParts(now);
    const hm = parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value;
    const day = parts.find(p => p.type === 'weekday').value; // Mon–Sun
    const isWeekend = day === 'Sat' || day === 'Sun';
    return { hm, isWeekend, tz: ex.tz, open: ex.open, close: ex.close, label: ex.label };
  } catch { return null; }
}

function getMarketState(id) {
  const exKey = INSTRUMENT_EXCHANGE[id];
  if (!exKey) return { state: 'unknown', label: '—' };
  const ex = EXCHANGE_HOURS[exKey];
  if (!ex) return { state: 'unknown', label: '—' };
  if (exKey === 'FOREX') return { state: 'open', label: '24/7' };

  const info = getExchangeNow(exKey);
  if (!info) return { state: 'unknown', label: '—' };
  if (info.isWeekend) return { state: 'closed', label: ex.label + ' · Weekend' };

  const [oh, om] = ex.open.split(':').map(Number);
  const [ch, cm] = ex.close.split(':').map(Number);
  const [nh, nm] = info.hm.split(':').map(Number);
  const nowMin  = nh * 60 + nm;
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;

  // Premarket: 1h before open (US only)
  const preMin = openMin - 60;

  if (nowMin >= openMin && nowMin < closeMin) return { state: 'open',      label: ex.label + ' Open'        };
  if (nowMin >= preMin  && nowMin < openMin)  return { state: 'premarket', label: ex.label + ' Pre-market'  };
  if (nowMin >= closeMin && nowMin < closeMin + 240) return { state: 'aftermarket', label: ex.label + ' After-hours' };
  return { state: 'closed', label: ex.label + ' Closed' };
}

function timeUntilEvent(id) {
  const exKey = INSTRUMENT_EXCHANGE[id];
  if (!exKey || exKey === 'FOREX') return null;
  const ex = EXCHANGE_HOURS[exKey];
  const info = getExchangeNow(exKey);
  if (!info || info.isWeekend) return null;

  const [oh, om] = ex.open.split(':').map(Number);
  const [ch, cm] = ex.close.split(':').map(Number);
  const [nh, nm] = info.hm.split(':').map(Number);
  const nowMin   = nh * 60 + nm;
  const openMin  = oh * 60 + om;
  const closeMin = ch * 60 + cm;

  let minsLeft = null;
  let eventLabel = '';
  if (nowMin < openMin) { minsLeft = openMin - nowMin; eventLabel = 'opens in'; }
  else if (nowMin < closeMin) { minsLeft = closeMin - nowMin; eventLabel = 'closes in'; }
  if (minsLeft == null) return null;

  const h = Math.floor(minsLeft / 60);
  const m = minsLeft % 60;
  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `${eventLabel} ${timeStr}`;
}

function marketStateDot(state) {
  const map = { open: 'dot-open', premarket: 'dot-premarket', aftermarket: 'dot-aftermarket', closed: 'dot-closed', '24/7': 'dot-open' };
  return map[state] || 'dot-closed';
}

// ─── Helpers ──────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function fmtPrice(p, currency) {
  if (p == null) return '—';
  const syms = { USD: '$', GBP: '£', EUR: '€', JPY: '¥', CHF: 'Fr' };
  const sym = syms[currency] || '';
  return sym + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtAge(ts) {
  const h = (Date.now() / 1000 - ts) / 3600;
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function fmtQuoteAge(q) {
  if (!q || !q._fetchedAt) return null;
  const ageMs  = Date.now() - q._fetchedAt;
  const ageSec = Math.floor(ageMs / 1000);

  // Stooq — ~15 min exchange-delayed daily close
  if (q._source === 'stooq') return '~15m delay';

  // Twelve Data REST — polled, current quote (~1 min freshness)
  if (q._source === 'twelvedata') return ageMs < (API.REFRESH_PRICES_MS + 3000) ? '● TD Live' : `${ageSec < 60 ? ageSec + 's' : Math.floor(ageSec/60) + 'm'} ago`;

  // Yahoo Finance WebSocket — truly real-time (every tick)
  if (q._source === 'yf-ws' && q._live && ageMs < 60000) return '● Live';

  // Finnhub WebSocket tick — truly live (every trade)
  if (q._live && q._source === 'ws' && ageMs < 60000) return '● Live';

  // Finnhub REST or Yahoo — live if freshly polled (<= poll interval + 2s slack)
  if ((q._source === 'finnhub' || q._source === 'yahoo') && ageMs < (API.REFRESH_PRICES_MS + 2000)) return '● Live';

  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  return `${Math.floor(ageMin / 60)}h ago`;
}
function sentimentColor(s) {
  return s === 'bullish' ? '#00d084' : s === 'bearish' ? '#ff3b5c' : '#f5a623';
}
function confidenceStars(c) {
  return c === 'high' ? '●●●' : c === 'medium' ? '●●○' : '●○○';
}
function directionArrow(d) {
  return d === 'bullish' ? '▲' : d === 'bearish' ? '▼' : '◆';
}
function directionLabel(d) {
  return d === 'bullish' ? 'BULLISH' : d === 'bearish' ? 'BEARISH' : 'MIXED';
}
function avatarInitials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function categoryLabel(cat) {
  const labels = {
    earnings: 'Earnings', guidance: 'Guidance', ma: 'M&A', regulatory: 'Regulatory',
    product: 'Product', analyst: 'Analyst', geopolitical: 'Geopolitical', macro: 'Macro', general: 'General'
  };
  return labels[cat] || cat;
}

// ─── Signal Accuracy Log (Feature 6) ─────────────────────────────────
function logSignal(instrument, signal) {
  const q = STATE.quotes[instrument.id];
  if (!q) return;
  let log = [];
  try { log = JSON.parse(localStorage.getItem('signal_log') || '[]'); } catch(e) { log = []; }
  // Skip if most recent entry for this instrument has same direction AND was logged within last hour
  const recent = log.find(e => e.id === instrument.id);
  if (recent && recent.direction === signal.direction && (Date.now() - recent.ts) < 3600000) return;
  // Prepend new entry
  log.unshift({
    id: instrument.id,
    direction: signal.direction,
    price: q.price,
    ts: Date.now(),
    band: signal.magnitudeBand,
    confidence: signal.confidence,
  });
  // Cap at 200 entries
  log = log.slice(0, 200);
  localStorage.setItem('signal_log', JSON.stringify(log));
}

function getSignalLogEntries(id) {
  try {
    const log = JSON.parse(localStorage.getItem('signal_log') || '[]');
    return log.filter(e => e.id === id);
  } catch(e) { return []; }
}

function getSignalLogEntry(id) {
  const entries = getSignalLogEntries(id);
  return entries[0] || null;
}

function renderSignalAccuracy(id) {
  const entries = getSignalLogEntries(id);
  if (!entries.length) return '';
  const q = STATE.quotes[id];
  const current = q?.price;
  const currency = q?.currency || 'USD';

  const last5 = entries.slice(0, 5);
  const rows = last5.map(entry => {
    const daysAgo = Math.round((Date.now() - entry.ts) / 86400000);
    const ageLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : daysAgo + 'd ago';
    const dirColor = sentimentColor(entry.direction);
    const arrow = directionArrow(entry.direction);
    let outcomeHtml = '—';
    if (current && entry.price) {
      const pctChange = ((current - entry.price) / entry.price) * 100;
      const sign = pctChange >= 0 ? '+' : '';
      const col = pctChange >= 0 ? 'var(--green)' : 'var(--red)';
      const check = (entry.direction === 'bullish' && pctChange > 0) || (entry.direction === 'bearish' && pctChange < 0) ? ' ✓' : ' ✗';
      outcomeHtml = `<span style="color:${col}">${sign}${pctChange.toFixed(1)}%${check}</span>`;
    }
    return `<tr>
      <td><span style="color:${dirColor};font-weight:700">${arrow} ${entry.direction}</span></td>
      <td>${entry.price != null ? fmtPrice(entry.price, currency) : '—'}</td>
      <td>${ageLabel}</td>
      <td>${entry.band || '—'}</td>
      <td>${outcomeHtml}</td>
    </tr>`;
  }).join('');

  return `<div class="signal-history">
    <div class="signal-history-hdr">Signal History</div>
    <table class="signal-history-table">
      <thead><tr><th>Signal</th><th>Entry</th><th>Age</th><th>Band</th><th>Outcome</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Feature 14: Sentiment Velocity ──────────────────────────────────
function getSentimentVelocity(id) {
  const news = STATE.news[id] || [];
  if (news.length === 0) return null;
  const freshBull = news.filter(n => n._sentiment === 'bullish' && (n._ageHours ?? 99) < 24).length;
  const olderBull = news.filter(n => n._sentiment === 'bullish' && (n._ageHours ?? 99) >= 24).length;
  const freshBear = news.filter(n => n._sentiment === 'bearish' && (n._ageHours ?? 99) < 24).length;
  if (freshBull >= 3)                              return { level: 'fast',     icon: '↑↑', label: 'Accelerating', color: '#00d084' };
  if (freshBull >= 2 && freshBull > olderBull)     return { level: 'rising',   icon: '↑',  label: 'Rising',       color: '#00d084' };
  if (freshBull > 0  && freshBull <= olderBull)    return { level: 'steady',   icon: '→',  label: 'Steady',       color: '#f5a623' };
  if (freshBear >= 2)                              return { level: 'bearfast', icon: '↓↓', label: 'Declining',    color: '#ff3b5c' };
  if (freshBear > 0  && olderBull > 0)             return { level: 'slowing',  icon: '↓',  label: 'Slowing',      color: '#ff3b5c' };
  return null;
}

// ─── Period-specific return estimates (1M / 3M / 6M) ─────────────────
function estimateReturnForPeriod(inst, sig, period) {
  if (period === '1M') return estimateReturn(inst, sig, 'medium');
  if (period === '6M') return estimateReturn(inst, sig, 'long');
  if (period === '3M') {
    const med  = estimateReturn(inst, sig, 'medium');
    const lng  = estimateReturn(inst, sig, 'long');
    const sign = lng.sign;
    const lo   = Math.max(med.lo, Math.round((med.lo * 0.35 + lng.lo * 0.65) * 10) / 10);
    const hi   = Math.max(lo + 1, Math.round((med.hi * 0.35 + lng.hi * 0.65) * 10) / 10);
    return { lo, hi, sign };
  }
  return estimateReturn(inst, sig, 'medium');
}

// ─── Technical Indicator Math ─────────────────────────────────────────
function calcSMA(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1).filter(v => v != null);
    return slice.length < period ? null : Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 100) / 100;
  });
}

function calcRSI(values, period = 14) {
  const clean = values.filter(v => v != null);
  if (clean.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = clean[i] - clean[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < clean.length; i++) {
    const d = clean[i] - clean[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

// ─── Feature 8: Break-Even Time Estimator ────────────────────────────
function calcBreakeven(h, inst) {
  const q   = STATE.quotes[h.id];
  const sig = STATE.signals[h.id];
  if (!q || !sig || sig.direction === 'bearish') return null;
  const currentPrice = q.price;
  if (currentPrice >= h.avgPrice) return null;  // not underwater
  const gapPct = ((h.avgPrice - currentPrice) / currentPrice) * 100;
  const retEst = estimateReturn(inst, sig, 'medium');
  if (!retEst || retEst.lo <= 0) return null;
  const weeklyGainPct = retEst.lo / 6; // medium = ~6 weeks
  return Math.ceil(gapPct / weeklyGainPct);
}

// ─── Feature 10: Entry Price Optimizer ───────────────────────────────
function calcEntryZone(inst, q, sig) {
  if (!q || !sig || sig.direction !== 'bullish') return null;
  const currentPrice = q.price;
  const changePct    = q.changePct ?? 0;
  const tier         = inst.tier || 6;
  const range        = TIERS[tier]?.range || [1, 4];
  const currency     = q.currency || 'USD';
  let upper, lower, note;

  if (changePct <= -(range[1] * 0.7)) {
    upper = currentPrice * 1.005;
    lower = currentPrice * (1 - range[0] / 200);
    note  = 'Deep flush — entry reasonable near current';
  } else if (changePct < -(range[0])) {
    upper = currentPrice;
    lower = currentPrice * (1 - range[0] / 150);
    note  = 'Moderate dip — partial entry now, scale in on further weakness';
  } else if (changePct < 0) {
    upper = currentPrice * (1 - range[0] / 200);
    lower = currentPrice * (1 - range[0] / 100);
    note  = `Wait for ~${range[0].toFixed(1)}%+ flush for better entry`;
  } else {
    upper = currentPrice * (1 - range[0] / 150);
    lower = currentPrice * (1 - range[0] / 80);
    note  = 'No dip yet — monitor for pullback to entry zone';
  }
  return { upper, lower, note, currency };
}

// ─── Feature 9: Sector Rotation Detector ─────────────────────────────
function detectSectorRotation() {
  const sectors = {};
  const all = [...WATCHLIST, ...INDICATORS];
  all.forEach(inst => {
    const sector = inst.sector || inst.type || 'Other';
    if (!sectors[sector]) sectors[sector] = { fresh: 0, older: 0, name: sector };
    (STATE.news[inst.id] || []).forEach(n => {
      const age  = n._ageHours ?? 48;
      const bull = n._sentiment === 'bullish';
      const bear = n._sentiment === 'bearish';
      if (bull) { if (age < 24) sectors[sector].fresh++; else sectors[sector].older++; }
      if (bear) { if (age < 24) sectors[sector].fresh -= 0.5; else sectors[sector].older -= 0.5; }
    });
  });
  const list    = Object.values(sectors).filter(s => s.fresh > 0 || s.older > 0);
  const rising  = list.filter(s => s.fresh >= 2 && s.fresh > s.older * 1.3).sort((a,b) => b.fresh - a.fresh).slice(0, 3);
  const fading  = list.filter(s => s.older >= 2 && s.older > s.fresh * 1.5).sort((a,b) => b.older - a.older).slice(0, 2);
  return { rising, fading };
}

// ─── Feature 12: Risk Concentration Warning ───────────────────────────
function calcConcentration() {
  const holdings = loadHoldings();
  if (holdings.length === 0) return null;
  const all = [...WATCHLIST, ...INDICATORS];
  const sectorValues = {};
  let totalValue = 0;
  holdings.forEach(h => {
    const inst = all.find(i => i.id === h.id);
    if (!inst) return;
    const pl = calcHoldingPL(h);
    const val = pl ? pl.currentValue : h.shares * h.avgPrice;
    const sector = inst.sector || inst.type || 'Other';
    sectorValues[sector] = (sectorValues[sector] || 0) + val;
    totalValue += val;
  });
  if (totalValue === 0) return null;
  const breakdown = Object.entries(sectorValues)
    .map(([sector, val]) => ({ sector, val, pct: (val / totalValue) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  const overweight = breakdown.filter(s => s.pct > 35);
  return { breakdown, overweight, totalValue };
}

// ─── Notification System ──────────────────────────────────────────────
function pushNotification(instrument, signal, isNew = false) {
  if (!isNew) return;
  // Log signal for accuracy tracking
  logSignal(instrument, signal);
  const n = {
    id: Date.now(),
    instrumentId: instrument.id,
    name: instrument.name,
    ticker: instrument.ticker,
    direction: signal.direction,
    band: signal.magnitudeBand,
    confidence: signal.confidence,
    newsCount: signal.newsCount,
    ts: Date.now(),
    read: false,
  };
  STATE.notifications.unshift(n);
  STATE.unreadCount++;
  $('notif-count').textContent = STATE.unreadCount;
  $('notif-count').classList.remove('hidden');
  showAlertBanner(n);
  renderNotifPanel();
}

function showAlertBanner(n) {
  const banner = $('alert-banner');
  const arrow = directionArrow(n.direction);
  const color = sentimentColor(n.direction);
  $('alert-banner-text').innerHTML =
    `<span style="color:${color}">${arrow} ${n.ticker}</span> — ${n.name}: <strong>${directionLabel(n.direction)}</strong> signal detected · ${n.band} potential · ${n.confidence.toUpperCase()} confidence · ${n.newsCount} news items`;
  banner.className = 'alert-banner ' + n.direction;
  banner.classList.remove('hidden');
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.add('hidden'), 8000);
}

function renderNotifPanel() {
  const list = $('notif-list');
  if (STATE.notifications.length === 0) {
    list.innerHTML = '<p class="empty-notif">No alerts yet — signals appear here when material news hits your instruments.</p>';
    return;
  }
  list.innerHTML = STATE.notifications.slice(0, 30).map(n => `
    <div class="notif-item ${n.read ? 'read' : 'unread'}" onclick="selectInstrumentById('${n.instrumentId}')">
      <div class="notif-ticker" style="color:${sentimentColor(n.direction)}">${directionArrow(n.direction)}</div>
      <div class="notif-body">
        <div class="notif-name">${n.name}</div>
        <div class="notif-headline">
          <span style="color:${sentimentColor(n.direction)}">${directionLabel(n.direction)}</span>
          · <strong>${n.band}</strong> · ${n.confidence.toUpperCase()} confidence
        </div>
        <div class="notif-meta">${n.ticker} · ${n.newsCount} news items · ${fmtAge(n.ts / 1000)}</div>
      </div>
    </div>
  `).join('');
}

function toggleNotifPanel() {
  const panel = $('notif-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    STATE.notifications.forEach(n => n.read = true);
    STATE.unreadCount = 0;
    $('notif-count').classList.add('hidden');
    renderNotifPanel();
  }
}

function clearAllAlerts() {
  STATE.notifications = [];
  STATE.unreadCount = 0;
  $('notif-count').classList.add('hidden');
  renderNotifPanel();
}

// ─── Sidebar Rendering ────────────────────────────────────────────────
function renderSidebar() {
  renderList('watchlist-list', WATCHLIST);
  renderList('indicators-list', INDICATORS);
  // Refresh overview panel if no instrument is selected
  if (!STATE.activeId) renderOverview();
}

// Friendly display names for sidebar group headers
const SECTOR_DISPLAY = {
  'Semiconductors': 'Chips & Semiconductors',
  'Storage':        'Storage & Memory',
  'Big Tech':       'Big Tech',
  'Asia Tech':      'Asia Tech',
  'Space':          'Space Stocks',
  'Space ETF':      'Space ETF',
  'Pharma':         'Pharma & Biotech',
  'Commodity':      'Commodities',
  'Index':          'Market Indices',
  'ETF':            'ETFs',
};

// Preferred sector order for the sidebar
const SECTOR_ORDER = [
  'Semiconductors','Storage','Big Tech','Asia Tech','Space','Space ETF','Pharma','Commodity',
  'Index','ETF',
];

function renderList(containerId, instruments) {
  const container = $(containerId);
  if (!container) return;

  // Group by sector/type, preserving preferred order
  const groups = {};
  instruments.forEach(inst => {
    const grp = inst.sector || inst.type || 'Other';
    (groups[grp] = groups[grp] || []).push(inst);
  });

  // Sort groups by SECTOR_ORDER, then alphabetically for any not in the list
  const sortedGroups = Object.keys(groups).sort((a, b) => {
    const ai = SECTOR_ORDER.indexOf(a);
    const bi = SECTOR_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Persist which groups are open — default all closed
  if (!window._groupOpen) window._groupOpen = {};

  let html = '';
  for (const grp of sortedGroups) {
    const items = groups[grp];
    const displayName = SECTOR_DISPLAY[grp] || grp;
    const key  = containerId + ':' + grp;
    const open = !!window._groupOpen[key];  // default closed
    html += `
      <div class="list-group-label ${open ? 'group-open' : 'group-closed'}"
           data-group-key="${key}"
           onclick="toggleGroup('${key}')">
        <span class="group-name">${displayName}</span>
        <div class="group-label-right">
          <span class="group-count">${items.length}</span>
          <span class="group-chevron">${open ? '▾' : '▸'}</span>
        </div>
      </div>
      <div class="group-items" data-group-items="${key}" style="${open ? '' : 'display:none'}">
        ${items.map(inst => renderCard(inst)).join('')}
      </div>`;
  }
  container.innerHTML = html;
}

function toggleGroup(key) {
  if (!window._groupOpen) window._groupOpen = {};
  window._groupOpen[key] = !window._groupOpen[key];
  const open = window._groupOpen[key];

  const lbl   = document.querySelector(`[data-group-key="${key}"]`);
  const items = document.querySelector(`[data-group-items="${key}"]`);
  if (!lbl || !items) return;

  lbl.classList.toggle('group-open',   open);
  lbl.classList.toggle('group-closed', !open);
  const chevron = lbl.querySelector('.group-chevron');
  if (chevron) chevron.textContent = open ? '▾' : '▸';
  items.style.display = open ? '' : 'none';
}

function renderCard(inst) {
  const q         = STATE.quotes[inst.id];
  const sig       = STATE.signals[inst.id];
  const isActive  = STATE.activeId === inst.id;
  const isLive    = q?._live === true;

  const priceStr   = q ? fmtPrice(q.price, q.currency) : '—';
  const changePct  = q?.changePct ?? null;
  const changeClass = changePct == null ? '' : changePct >= 0 ? 'positive' : 'negative';
  const changeStr  = changePct == null ? '' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;

  const badgeHtml = sig ? `
    <div class="signal-badge ${sig.direction}">
      ${directionArrow(sig.direction)} ${sig.direction === 'bullish' ? 'Bull' : sig.direction === 'bearish' ? 'Bear' : 'Mixed'}
    </div>
  ` : '';

  const confHtml  = sig ? `<span class="conf-stars" title="Confidence: ${sig.confidence}">${confidenceStars(sig.confidence)}</span>` : '';
  const newsCount = STATE.news[inst.id]?.length || 0;
  const newsBadge = newsCount > 0 ? `<span class="news-count">${newsCount} news</span>` : '';
  const proxyNote = '';
  // Always render live dot with stable ID — updateRefreshBars toggles visibility each second
  const _srcTip = { ws: 'Finnhub WebSocket — every trade tick', 'yf-ws': 'Yahoo Finance WebSocket — every tick', twelvedata: 'Twelve Data REST — polled every 8s', stooq: '~15min exchange-delayed (Stooq)', yahoo: 'Yahoo Finance REST — parallel proxy race', finnhub: 'Finnhub REST — polled' };
  const liveDot   = `<span class="live-dot${isLive ? '' : ' ldot-hidden'}" id="ldot-${inst.id}" title="${_srcTip[q?._source] || 'REST polled'}"></span>`;
  const ageStr    = fmtQuoteAge(q);
  const ageCls    = ageStr === '● Live' ? 'price-age live' : 'price-age';
  // Always render the span with a stable ID so updateRefreshBars() can patch text in-place
  const ageHtml   = `<span class="${ageCls}" id="cage-${inst.id}">${ageStr || ''}</span>`;

  // Market state dot
  const mkt     = getMarketState(inst.id);
  const mktDot  = `<span class="mkt-dot ${marketStateDot(mkt.state)}" title="${mkt.label}"></span>`;

  // Signal accuracy inline
  const sigAcc = getSignalLogEntry(inst.id);
  let sigAccHtml = '';
  if (sigAcc) {
    const q2 = STATE.quotes[inst.id];
    const daysAgo = Math.round((Date.now() - sigAcc.ts) / 86400000);
    const ageLabel = daysAgo === 0 ? 'today' : daysAgo + 'd ago';
    let perfStr = '';
    if (q2?.price && sigAcc.price) {
      const pct = ((q2.price - sigAcc.price) / sigAcc.price) * 100;
      const col = pct >= 0 ? 'var(--green)' : 'var(--red)';
      perfStr = ` <span style="color:${col}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
    }
    sigAccHtml = `<span class="signal-accuracy-inline">sig ${ageLabel}${perfStr}</span>`;
  }

  // Feature 14: sentiment velocity badge
  const vel = getSentimentVelocity(inst.id);
  const velHtml = vel ? `<span class="vel-badge vel-${vel.level}" title="Signal velocity: ${vel.label}" style="color:${vel.color}">${vel.icon}</span>` : '';

  return `
    <div class="inst-card ${isActive ? 'active' : ''}" onclick="selectInstrumentById('${inst.id}')" id="card-${inst.id}">
      <div class="card-avatar" style="background:${inst.color}22;border-color:${inst.color}44">
        <span style="color:${inst.color}">${avatarInitials(inst.name)}</span>
      </div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${inst.name} ${mktDot} ${liveDot}</div>
          <div class="card-price ${changeClass}">${priceStr}</div>
        </div>
        <div class="card-bottom">
          <div class="card-sub">
            <span class="card-ticker">${inst.ticker}</span>
            ${proxyNote}
            ${newsBadge}
            ${velHtml}
            ${ageHtml}
            ${sigAccHtml}
          </div>
          <div class="card-right">
            ${confHtml}
            ${changePct != null ? `<span class="card-change ${changeClass}"><span class="change-period">1D</span>${changeStr}</span>` : ''}
            ${badgeHtml}
          </div>
        </div>
      </div>
      <div class="card-refresh-track"><div class="card-refresh-bar" id="rbar-${inst.id}"></div></div>
    </div>
  `;
}

// ─── Detail Panel Rendering ───────────────────────────────────────────
// ─── Insider Transactions ─────────────────────────────────────────────
async function loadInsiderTransactions(inst) {
  if (!inst.finnhub || inst.finnhub.includes(':')) return; // non-US — no insider data
  if (STATE.demoMode) return; // demo mode has no real API
  const cached = STATE.insiders[inst.id];
  if (cached && cached !== 'loading' && cached !== 'error') {
    const age = Date.now() - (cached.fetchedAt || 0);
    if (age < 6 * 60 * 60 * 1000) return; // fresh enough (6h TTL)
  }
  if (cached === 'loading') return;

  STATE.insiders[inst.id] = 'loading';
  try {
    const sym  = inst.finnhub; // plain US ticker
    const rows = await RequestQueue.add(() => fetchInsiderTransactions(sym));
    STATE.insiders[inst.id] = { data: rows, fetchedAt: Date.now() };
    // If the user is still on this instrument, patch the insider section in-place
    if (STATE.activeId === inst.id) {
      const container = document.getElementById('insider-section');
      if (container) container.outerHTML = renderInsiderSection(inst);
    }
  } catch {
    STATE.insiders[inst.id] = 'error';
  }
}

function renderInsiderSection(inst) {
  const cached = STATE.insiders[inst.id];

  // Non-US instruments don't have Finnhub insider data
  if (!inst.finnhub || inst.finnhub.includes(':')) return '';

  // Loading / error states
  if (!cached || cached === 'loading') {
    return `<div id="insider-section" class="insider-section">
      <div class="insider-header">
        <h3 class="insider-title">Insider Transactions</h3>
        <span class="insider-sub">6-month window · SEC filings</span>
      </div>
      <div class="insider-loading">Loading insider data…</div>
    </div>`;
  }
  if (cached === 'error') {
    return `<div id="insider-section" class="insider-section">
      <div class="insider-header">
        <h3 class="insider-title">Insider Transactions</h3>
      </div>
      <div class="insider-loading">Unable to load — check API key or try again later.</div>
    </div>`;
  }

  const rows = cached.data || [];

  // Only open-market purchases (P) and sales (S); skip awards/grants/options exercise
  const openMarket = rows
    .filter(r => r.transactionCode === 'P' || r.transactionCode === 'S')
    .sort((a, b) => new Date(b.transactionDate || b.filingDate) - new Date(a.transactionDate || a.filingDate))
    .slice(0, 6);

  if (!openMarket.length) {
    return `<div id="insider-section" class="insider-section">
      <div class="insider-header">
        <h3 class="insider-title">Insider Transactions</h3>
        <span class="insider-sub">6-month window · SEC filings</span>
      </div>
      <div class="insider-loading">No open-market buys or sells in the past 6 months.</div>
    </div>`;
  }

  // Aggregate summary: net shares bought vs sold
  let totalBought = 0, totalSold = 0, buyCount = 0, sellCount = 0;
  openMarket.forEach(r => {
    const shares = Math.abs(r.change ?? r.share ?? 0);
    if (r.transactionCode === 'P') { totalBought += shares; buyCount++; }
    else                           { totalSold   += shares; sellCount++; }
  });

  const netBuyer = totalBought > totalSold;
  const netLabel = netBuyer
    ? `Net buyers — ${buyCount} purchase${buyCount !== 1 ? 's' : ''} vs ${sellCount} sale${sellCount !== 1 ? 's' : ''}`
    : `Net sellers — ${sellCount} sale${sellCount !== 1 ? 's' : ''} vs ${buyCount} purchase${buyCount !== 1 ? 's' : ''}`;
  const netClass = netBuyer ? 'net-buy' : 'net-sell';

  const fmtShares = (n) => {
    n = Math.abs(n ?? 0);
    return n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();
  };
  const fmtValue = (shares, price) => {
    if (!price || !shares) return '';
    const v = Math.abs(shares) * price;
    return v >= 1000000 ? `$${(v / 1000000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`;
  };

  const rowsHtml = openMarket.map(r => {
    const isBuy   = r.transactionCode === 'P';
    const shares  = Math.abs(r.change ?? r.share ?? 0);
    const price   = r.transactionPrice;
    const value   = fmtValue(shares, price);
    const date    = (r.transactionDate || r.filingDate || '').slice(0, 10);
    const name    = (r.name || 'Unknown').replace(/\//g, ' ').trim();
    // Shorten very long names
    const shortName = name.length > 28 ? name.slice(0, 26) + '…' : name;

    return `<div class="insider-row">
      <div class="insider-type-badge ${isBuy ? 'buy' : 'sell'}">${isBuy ? 'BUY' : 'SELL'}</div>
      <div class="insider-info">
        <div class="insider-name">${shortName}</div>
        <div class="insider-date">${date}</div>
      </div>
      <div class="insider-nums">
        <div class="insider-shares">${fmtShares(shares)} shares</div>
        ${value ? `<div class="insider-value">${value}</div>` : ''}
        ${price ? `<div class="insider-price">@ $${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div id="insider-section" class="insider-section">
    <div class="insider-header">
      <h3 class="insider-title">Insider Transactions</h3>
      <span class="insider-sub">6-month window · open-market only · SEC filings</span>
    </div>
    <div class="insider-net ${netClass}">${netLabel}</div>
    <div class="insider-list">${rowsHtml}</div>
  </div>`;
}

function renderDetail(inst) {
  const q = STATE.quotes[inst.id];
  const sig = STATE.signals[inst.id];
  const news = STATE.news[inst.id] || [];
  const detail = $('instrument-detail');
  const empty = $('empty-state');
  empty.classList.add('hidden');
  $('overview-panel').classList.add('hidden');
  detail.classList.remove('hidden');

  const changePct = q?.changePct ?? null;
  const changeClass = changePct == null ? '' : changePct >= 0 ? 'positive' : 'negative';
  const changeStr = changePct == null ? '' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;

  const sigBlock = sig ? `
    <div class="signal-box ${sig.direction}">
      <div class="sig-direction">
        <span class="sig-arrow">${directionArrow(sig.direction)}</span>
        <span class="sig-label">${directionLabel(sig.direction)}</span>
      </div>
      <div class="sig-row">
        <div class="sig-stat">
          <div class="sig-stat-label">Magnitude Band</div>
          <div class="sig-stat-value">${sig.magnitudeBand}</div>
        </div>
        <div class="sig-stat">
          <div class="sig-stat-label">Confidence</div>
          <div class="sig-stat-value">${sig.confidence.toUpperCase()} ${confidenceStars(sig.confidence)}</div>
        </div>
        <div class="sig-stat">
          <div class="sig-stat-label">Based on</div>
          <div class="sig-stat-value">${sig.newsCount} news items</div>
        </div>
      </div>
      <div class="sig-disclaimer">
        Magnitude band is a probability range based on this stock's typical volatility for this news category — not a price target.
        Always verify before acting.
      </div>
    </div>
  ` : `<div class="signal-box mixed"><p class="no-signal">No news signal data available. Ensure your Finnhub key is set or use demo mode.</p></div>`;

  // News breakdown
  const newsHtml = news.length === 0
    ? '<p class="no-news">No news items found for this instrument.</p>'
    : news.map(item => renderNewsItem(item, inst)).join('');

  detail.innerHTML = `
    <div class="detail-nav-bar">
      <button class="back-btn" onclick="goToOverview()">← Overview</button>
    </div>
    <div class="detail-header">
      <div class="detail-avatar" style="background:${inst.color}22;border-color:${inst.color}55">
        <span style="color:${inst.color}">${avatarInitials(inst.name)}</span>
      </div>
      <div class="detail-title">
        <h2>${inst.name}</h2>
        <div class="detail-meta">
          <span class="detail-ticker">${inst.ticker}</span>
          <span class="detail-sector">${inst.sector || inst.type || ''}</span>
          ${(() => {
            const mkt = getMarketState(inst.id);
            const until = timeUntilEvent(inst.id);
            return `<span class="market-state ${mkt.state}"><span class="mkt-dot ${marketStateDot(mkt.state)}"></span> ${mkt.label}${until ? ' · ' + until : ''}</span>`;
          })()}
          ${q?._live ? `<span class="live-badge">● LIVE</span>` : ''}
        </div>
      </div>
    </div>

    <div class="detail-price-row">
      <div class="detail-price">${q ? fmtPrice(q.price, q.currency) : '—'}</div>
      ${changePct != null ? `<div class="detail-change ${changeClass}"><span class="change-period">1D</span>${changeStr}</div>` : ''}
    </div>

    <div class="chart-section">
      <div class="chart-header">
        <span class="chart-title">Price History</span>
        <span class="chart-loading" id="chart-loading">Loading…</span>
      </div>
      <div class="chart-range-tabs">
        ${['1D','3D','1W','2W','1M','3M','1Y','5Y','Max'].map(r =>
          `<button class="chart-range-btn ${r === (STATE.chartRange || '1M') ? 'active' : ''}"
            onclick="switchChartRange('${r}')">${r}</button>`
        ).join('')}
      </div>
      <div class="overlay-controls">
        <button class="overlay-btn ${STATE.overlays.ma50  ? 'active' : ''}" onclick="toggleOverlay('ma50')">MA50</button>
        <button class="overlay-btn ${STATE.overlays.ma200 ? 'active' : ''}" onclick="toggleOverlay('ma200')">MA200</button>
        <button class="overlay-btn ${STATE.overlays.rsi   ? 'active' : ''}" onclick="toggleOverlay('rsi')">RSI 14</button>
      </div>
      <div class="chart-wrap">
        <canvas id="price-chart"></canvas>
      </div>
      <div id="rsi-panel" class="rsi-panel hidden"></div>
    </div>

    ${sigBlock}
    ${renderSignalAccuracy(inst.id)}

    ${renderInsiderSection(inst)}

    <div class="news-section">
      <div class="news-section-header">
        <h3>Full News Breakdown</h3>
        <span class="news-section-sub">${news.length} items · last ${API.NEWS_LOOKBACK_DAYS * 24}h</span>
      </div>
      <div class="news-list">
        ${newsHtml}
      </div>
    </div>
  `;

  // Kick off async insider fetch — will patch the section when it lands
  loadInsiderTransactions(inst);
}

function newsItemMagnitude(item, inst) {
  // Per-article magnitude band: combines the article's category + instrument tier
  const cat   = item._category || 'general';
  const sent  = item._sentiment || 'mixed';
  const base  = TIERS[inst.tier]?.range ?? [1, 4];
  const mult  = CATEGORY_MULTIPLIERS[cat] ?? 0.4;
  // Recency multiplier: fresher news = larger potential move
  const ageH  = item._ageHours ?? 24;
  const age   = ageH < 6 ? 1.2 : ageH < 24 ? 1.0 : 0.7;
  if (sent === 'mixed') {
    // Mixed/neutral still has an uncertainty range — show with tilde
    const hi = Math.round(base[1] * mult * age * 0.4 * 10) / 10;
    return hi > 0 ? `~0–${hi}%` : null;
  }
  const lo    = Math.round(base[0] * mult * age * 10) / 10;
  const hi    = Math.round(base[1] * mult * age * 10) / 10;
  const sign  = sent === 'bullish' ? '+' : '−';
  return `${sign}${lo}–${hi}%`;
}

// ─── Sector Allocation Donut ──────────────────────────────────────────
const SECTOR_COLORS = {
  'Semiconductors':'#8b5cf6','Pharma':'#e5005b','Storage':'#0078d4',
  'Big Tech':'#4285f4','Asia Tech':'#1428a0','Space':'#ff3b30',
  'Space ETF':'#ff6b00','Commodity':'#f0b429','Index':'#3b82f6','ETF':'#dc2626',
};

function renderSectorDonut(holdings) {
  const canvas = document.getElementById('sector-donut');
  if (!canvas) return;
  if (_donutChart) { _donutChart.destroy(); _donutChart = null; }

  const all = [...WATCHLIST, ...INDICATORS];
  const sectorValues = {};
  holdings.forEach(h => {
    const inst = all.find(i => i.id === h.id);
    if (!inst) return;
    const pl = calcHoldingPL(h);
    const val = pl ? pl.currentValue : h.shares * h.avgPrice;
    const sector = inst.sector || inst.type || 'Other';
    sectorValues[sector] = (sectorValues[sector] || 0) + val;
  });

  const labels = Object.keys(sectorValues);
  const data   = labels.map(l => Math.round(sectorValues[l] * 100) / 100);
  const total  = data.reduce((a, b) => a + b, 0);
  const colors = labels.map(l => SECTOR_COLORS[l] || '#8888aa');

  _donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: { color: '#8888aa', font: { size: 11 }, boxWidth: 12, padding: 8 }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.parsed;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
              return `  $${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ─── Chart Rendering ──────────────────────────────────────────────────
let _activeChart = null;
let _chartInst   = null;
let _donutChart  = null;

function xAxisDateFormat(rangeKey) {
  switch (rangeKey) {
    case '1D':  return ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    case '3D':  return ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    case '1W':
    case '2W':  return ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    case '1M':
    case '3M':  return ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    case '1Y':
    case '5Y':  return ts => new Date(ts * 1000).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    case 'Max': return ts => new Date(ts * 1000).getFullYear().toString();
    default:    return ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
}

function maxTicksForRange(rangeKey) {
  return { '1D': 8, '3D': 6, '1W': 7, '2W': 7, '1M': 8, '3M': 8, '1Y': 12, '5Y': 10, 'Max': 10 }[rangeKey] || 8;
}

// ─── Chart cache helpers ──────────────────────────────────────────────
// Per-range TTLs: short for intraday (stale fast), longer for daily+ (rarely changes)
const CHART_CACHE_TTL = {
  '1D': 20 * 60 * 1000,  '3D': 30 * 60 * 1000,  '1W': 60 * 60 * 1000,
  '2W':  2 * 60 * 60 * 1000, '1M':  4 * 60 * 60 * 1000, '3M':  6 * 60 * 60 * 1000,
  '6M': 12 * 60 * 60 * 1000, '1Y': 24 * 60 * 60 * 1000, '5Y': 24 * 60 * 60 * 1000,
  'Max': 48 * 60 * 60 * 1000,
};

function cacheChart(id, rangeKey, data) {
  if (!STATE.chartData[id]) STATE.chartData[id] = {};
  const entry = { ...data, _cachedAt: Date.now() };
  STATE.chartData[id][rangeKey] = entry;
  // Persist to localStorage so charts survive page reload
  try {
    localStorage.setItem(`chart_${id}_${rangeKey}`, JSON.stringify(entry));
  } catch {
    // localStorage full — evict all chart entries and retry once
    Object.keys(localStorage).filter(k => k.startsWith('chart_')).forEach(k => localStorage.removeItem(k));
    try { localStorage.setItem(`chart_${id}_${rangeKey}`, JSON.stringify(entry)); } catch {}
  }
}

function loadChartFromStorage(id, rangeKey) {
  try {
    const raw = localStorage.getItem(`chart_${id}_${rangeKey}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const ttl = CHART_CACHE_TTL[rangeKey] || 4 * 60 * 60 * 1000;
    if (Date.now() - (entry._cachedAt || 0) > ttl) {
      localStorage.removeItem(`chart_${id}_${rangeKey}`);
      return null;
    }
    return entry;
  } catch { return null; }
}

// Synchronously draw the chart from already-fetched data
function renderChartFromData(inst, rangeKey, data) {
  const canvas = $('price-chart');
  if (!canvas) return;
  if (_activeChart) { _activeChart.destroy(); _activeChart = null; }

  const fmtDate  = xAxisDateFormat(rangeKey);
  const labels   = data.timestamps.map(fmtDate);
  const closes   = data.closes.map(v => v == null ? null : Math.round(v * 100) / 100);
  const currency = data.currency || STATE.quotes[inst.id]?.currency || 'USD';
  const first    = closes.find(v => v != null);
  const last     = [...closes].reverse().find(v => v != null);
  const trend    = (last >= first) ? '#00d084' : '#ff3b5c';

  const datasets = [{
    data: closes,
    borderColor: trend,
    backgroundColor: trend + '15',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: trend,
    fill: true,
    tension: 0.25,
    spanGaps: true,
    label: 'Price',
  }];

  if (STATE.overlays?.ma50) {
    const ma50 = calcSMA(closes, 50);
    datasets.push({ label: 'MA50', data: ma50, borderColor: '#f5a623', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4, 3], spanGaps: true, tension: 0 });
  }
  if (STATE.overlays?.ma200) {
    const ma200 = calcSMA(closes, 200);
    datasets.push({ label: 'MA200', data: ma200, borderColor: '#8b5cf6', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4, 3], spanGaps: true, tension: 0 });
  }

  _activeChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: STATE.overlays?.ma50 || STATE.overlays?.ma200, labels: { color: '#8888aa', font: { size: 10 }, boxWidth: 16, padding: 10 } },
        tooltip: {
          backgroundColor: '#0f0f1c',
          borderColor: '#1e1e38',
          borderWidth: 1,
          titleColor: '#8888aa',
          bodyColor: '#e8e8f4',
          padding: 10,
          callbacks: {
            title: items => items[0]?.label || '',
            label: ctx => {
              if (ctx.dataset.label === 'MA50' || ctx.dataset.label === 'MA200') {
                return ctx.raw != null ? `  ${ctx.dataset.label}: ${fmtPrice(ctx.raw, currency)}` : null;
              }
              return ctx.raw != null ? `  ${fmtPrice(ctx.raw, currency)}` : '  —';
            },
          }
        }
      },
      scales: {
        x: {
          grid:  { color: '#1e1e3815', drawBorder: false },
          ticks: { color: '#44446a', maxTicksLimit: maxTicksForRange(rangeKey), font: { size: 10 }, maxRotation: 0 }
        },
        y: {
          position: 'right',
          grid:  { color: '#1e1e3815', drawBorder: false },
          ticks: { color: '#44446a', font: { size: 10 }, callback: v => fmtPrice(v, currency) }
        }
      }
    }
  });

  // RSI panel update
  const rsiEl = $('rsi-panel');
  if (rsiEl) {
    if (STATE.overlays?.rsi) {
      const validCloses = closes.filter(v => v != null);
      const rsiVal = validCloses.length >= 15 ? calcRSI(validCloses, 14) : null;
      if (rsiVal != null) {
        const rsiColor = rsiVal >= 70 ? '#ff3b5c' : rsiVal <= 30 ? '#00d084' : '#8888aa';
        const rsiLabel = rsiVal >= 70 ? 'Overbought' : rsiVal <= 30 ? 'Oversold' : 'Neutral';
        rsiEl.innerHTML = `<div class="rsi-row">
          <span class="rsi-label">RSI(14)</span>
          <div class="rsi-track">
            <div class="rsi-fill" style="width:${Math.min(100, rsiVal)}%;background:${rsiColor}"></div>
            <div class="rsi-ob-line"></div>
            <div class="rsi-os-line"></div>
          </div>
          <span class="rsi-value" style="color:${rsiColor}">${rsiVal.toFixed(1)} <span class="rsi-status">${rsiLabel}</span></span>
        </div>`;
        rsiEl.classList.remove('hidden');
      } else {
        rsiEl.classList.add('hidden');
      }
    } else {
      rsiEl.classList.add('hidden');
    }
  }
}

// Cache-first chart loader.
// If data is cached → renders immediately (zero loading time).
// If not cached → fetches with a loading indicator, then caches for next time.
// Stale cache (> 10 min) is refreshed silently in the background.
async function loadChart(inst, rangeKey) {
  rangeKey   = rangeKey || STATE.chartRange || '1M';
  _chartInst = inst;

  const loadingEl = $('chart-loading');
  const canvas    = $('price-chart');
  if (!canvas) return;

  // ── Serve from cache immediately ─────────────────────────────────────
  // Check in-memory first, then localStorage (survives page reload)
  let cached = STATE.chartData?.[inst.id]?.[rangeKey];
  if (!cached?.closes?.length) {
    const stored = loadChartFromStorage(inst.id, rangeKey);
    if (stored?.closes?.length && stored?.timestamps?.length) {
      if (!STATE.chartData[inst.id]) STATE.chartData[inst.id] = {};
      STATE.chartData[inst.id][rangeKey] = stored;
      cached = stored;
    }
  }

  if (cached?.closes?.length && cached?.timestamps?.length) {
    if (loadingEl) loadingEl.textContent = '';
    renderChartFromData(inst, rangeKey, cached);

    // If stale beyond the TTL, refresh silently in background
    const ttl = CHART_CACHE_TTL[rangeKey] || 10 * 60 * 1000;
    if (Date.now() - (cached._cachedAt || 0) > ttl) {
      fetchChartData(inst, rangeKey).then(fresh => {
        if (!fresh?.closes?.length) return;
        cacheChart(inst.id, rangeKey, fresh);
        if (_chartInst?.id === inst.id && STATE.chartRange === rangeKey) {
          renderChartFromData(inst, rangeKey, fresh);
        }
      }).catch(() => {});
    }
    return;
  }

  // ── Not in cache yet — fetch with indicator ───────────────────────────
  if (loadingEl) loadingEl.textContent = 'Loading…';
  if (_activeChart) { _activeChart.destroy(); _activeChart = null; }

  const data = await fetchChartData(inst, rangeKey).catch(() => null);

  if (!data?.closes?.length || !data?.timestamps?.length) {
    if (loadingEl) loadingEl.textContent = 'Chart unavailable';
    return;
  }

  cacheChart(inst.id, rangeKey, data);
  if (loadingEl) loadingEl.textContent = '';
  // Guard: user may have switched while we were fetching
  if (_chartInst?.id !== inst.id) return;
  renderChartFromData(inst, rangeKey, data);
}

function switchChartRange(rangeKey) {
  STATE.chartRange = rangeKey;
  document.querySelectorAll('.chart-range-btn').forEach(b =>
    b.classList.toggle('active', b.textContent === rangeKey)
  );
  if (_chartInst) loadChart(_chartInst, rangeKey);
}

function toggleOverlay(key) {
  STATE.overlays[key] = !STATE.overlays[key];
  document.querySelectorAll('.overlay-btn').forEach(b => {
    const map = { 'MA50': 'ma50', 'MA200': 'ma200', 'RSI 14': 'rsi' };
    const k = map[b.textContent.trim()];
    if (k !== undefined) b.classList.toggle('active', STATE.overlays[k]);
  });
  if (_chartInst) loadChart(_chartInst, STATE.chartRange);
}

// ─── Background chart pre-loader ─────────────────────────────────────
// Pre-fetches 1M and 1D for every instrument using the rate-limited RequestQueue.
// Runs in background after startup — by the time the user first clicks a stock,
// charts are already cached and render instantly.
// Debounced overview refresh — batches rapid successive cache updates into one render.
let _overviewRefreshTimer = null;
function scheduleOverviewRefresh(forPeriod) {
  clearTimeout(_overviewRefreshTimer);
  _overviewRefreshTimer = setTimeout(() => {
    if (!STATE.activeId && STATE.heatmapPeriod === forPeriod) renderOverview();
  }, 150);
}

async function preloadAllCharts() {
  const all    = [...WATCHLIST, ...INDICATORS];
  const ranges = ['1D', '1W', '1M', '3M'];
  // Load ALL instrument×range combinations in parallel through the rate-limited queue.
  // Previously we awaited each range sequentially, so 1W didn't start until all 33×1M
  // fetches finished (~10s+). Now every range starts loading immediately — by the time
  // the user clicks a heatmap tab, most tiles already have data.
  await Promise.allSettled(
    all.flatMap(inst => ranges.map(rangeKey =>
      RequestQueue.add(() =>
        fetchChartData(inst, rangeKey)
          .then(data => {
            if (data?.closes?.length) {
              cacheChart(inst.id, rangeKey, data);
              scheduleOverviewRefresh(rangeKey);
            }
          })
          .catch(() => {})
      )
    ))
  );
}

// ─── Recommendations helpers ──────────────────────────────────────────
// Extract upper bound from magnitude band strings like "+2.0–5.0%" or "0–1%"
function parseMagUpper(band) {
  if (!band || band === '—') return 0;
  const m = band.match(/(\d+(?:\.\d+)?)%/g);
  if (!m) return 0;
  return parseFloat(m[m.length - 1]);
}

// ─── Horizon-aware scoring ────────────────────────────────────────────
function scoreForHorizon(inst, q, sig, pct, horizon) {
  const conf  = sig.confidence === 'high' ? 3 : sig.confidence === 'medium' ? 2 : 1;
  const dir   = sig.direction;
  const news  = sig.newsCount || 0;
  const tier  = inst.tier || 6;
  const cat   = sig.topCategory || 'general';

  const dipBonus    = pct < 0 ? Math.abs(pct) * 2 : -Math.abs(pct) * 0.5;
  const growthBonus = (8 - tier) * 1.5;
  const magBonus    = parseMagUpper(sig.magnitudeBand) * 0.4;
  const newsBonus   = Math.min(news, 10) * 0.3;
  const breakdown   = sig.breakdown || [];
  const freshest    = breakdown.reduce((min, n) => Math.min(min, n._ageHours ?? 999), 999);

  if (horizon === 'short') {
    const bullBonus = dir === 'bullish' ? conf * 4 : dir === 'mixed' ? conf * 0.3 : -5;
    const recency   = freshest < 6 ? 6 : freshest < 24 ? 3 : freshest < 48 ? 1 : -2;
    const catBonus  = { earnings:5, ma:5, guidance:4, analyst:3, regulatory:2, geopolitical:3, product:2, macro:1, general:0 }[cat] ?? 0;
    return { score: dipBonus * 1.2 + bullBonus * 1.3 + recency + catBonus + newsBonus * 1.5,
             dipBonus, bullBonus, upsideBonus: recency + catBonus, newsBonus };
  }

  if (horizon === 'medium') {
    const bullBonus  = dir === 'bullish' ? conf * 4 : dir === 'mixed' ? conf * 0.8 : -3;
    const catBonus   = { guidance:5, earnings:4, product:4, analyst:3, ma:3, macro:3, regulatory:2, geopolitical:1, general:1 }[cat] ?? 1;
    const macroBonus = getSupportingIndicators(inst).length > 0 ? 3 : 0;
    return { score: dipBonus * 0.8 + bullBonus + catBonus + macroBonus + growthBonus * 0.4 + newsBonus,
             dipBonus, bullBonus, upsideBonus: catBonus + macroBonus + growthBonus * 0.4, newsBonus };
  }

  if (horizon === 'long') {
    const bullBonus   = dir === 'bullish' ? conf * 3 : dir === 'mixed' ? conf * 1.5 : -1;
    const sectorScore = { 'Space':10,'Semiconductors':9,'Big Tech':7,'Pharma':8,'Storage':5,'Asia Tech':4,'Space ETF':5,'Commodity':4 }[inst.sector] ?? 3;
    return { score: dipBonus * 0.3 + bullBonus * 0.7 + growthBonus * 2.0 + sectorScore + magBonus * 0.5,
             dipBonus, bullBonus, upsideBonus: growthBonus * 2.0 + sectorScore, newsBonus };
  }
  return { score: 0, dipBonus: 0, bullBonus: 0, upsideBonus: 0, newsBonus: 0 };
}

// ─── Estimated return by horizon ─────────────────────────────────────
function estimateReturn(inst, sig, horizon) {
  const conf    = sig.confidence === 'high' ? 1.0 : sig.confidence === 'medium' ? 0.72 : 0.45;
  const dir     = sig.direction;
  const dirMult = dir === 'bullish' ? 1.0 : dir === 'mixed' ? 0.55 : 0.25;
  const tier    = inst.tier || 6;
  const base    = TIERS[tier]?.range || [1, 4];
  const catM    = CATEGORY_MULTIPLIERS[sig.topCategory] || 0.5;
  const sign    = dir === 'bearish' ? '−' : '+';

  if (horizon === 'short') {
    const lo = Math.max(0.5, Math.round(base[0] * catM * conf * dirMult * 10) / 10);
    const hi = Math.max(lo + 0.5, Math.round(base[1] * catM * conf * dirMult * 10) / 10);
    return { lo, hi, label: '1–14 days', sign };
  }
  if (horizon === 'medium') {
    const lo = Math.max(1, Math.round(base[0] * catM * conf * dirMult * 2.5 * 10) / 10);
    const hi = Math.max(lo + 1, Math.round(base[1] * catM * conf * dirMult * 2.5 * 10) / 10);
    return { lo, hi, label: '3–6 weeks', sign };
  }
  if (horizon === 'long') {
    const tr = { 1:[20,120], 2:[15,65], 3:[10,30], 4:[12,45], 5:[8,28], 6:[5,18], 7:[6,22] }[tier] ?? [10,35];
    const lo = Math.max(5, Math.round(tr[0] * conf * dirMult * 10) / 10);
    const hi = Math.max(lo + 5, Math.round(tr[1] * conf * dirMult * 10) / 10);
    return { lo, hi, label: '3–6 months', sign };
  }
  return { lo: 0, hi: 0, label: '', sign: '+' };
}

// ─── Horizon-specific intel text ─────────────────────────────────────
function buildHorizonIntel(inst, q, sig, pct, horizon) {
  const breakdown = sig.breakdown || [];
  const freshest  = breakdown.reduce((min, n) => Math.min(min, n._ageHours ?? 999), 999);
  const cat       = sig.topCategory || 'general';
  const tier      = inst.tier || 6;
  const stopPct   = ((TIERS[tier]?.range[1] || 4) * 0.8).toFixed(1);

  if (horizon === 'short') {
    const entry = pct <= -3 && sig.confidence !== 'low'
      ? '🟢 Entry window open — dip is real with an active signal'
      : pct <= -1
      ? '🟡 Shallow dip — consider waiting for a larger flush'
      : '🔴 No dip yet — do not chase; monitor for pullback';
    const cAge = freshest < 6  ? '🔥 Breaking catalyst (< 6h old)'
               : freshest < 24 ? '✓ Fresh catalyst (today)'
               : freshest < 48 ? '⚠ Catalyst aging (yesterday) — check for follow-up news'
               :                 '⚠ Stale signal — confirm it is still active before acting';
    return `<b>Entry signal:</b> ${entry}<br><b>Catalyst freshness:</b> ${cAge}<br><b>Suggested stop-loss:</b> ~−${stopPct}% from entry (tier-based)<br><b>Exit rule:</b> If no follow-through within 7–10 trading days, exit and reassess.`;
  }

  if (horizon === 'medium') {
    const macros = getSupportingIndicators(inst);
    const macro  = macros.length > 0
      ? `${macros.map(m => m.inst.ticker).join(', ')} are bullish — sector tailwind confirmed.`
      : 'No supporting macro indicators currently bullish — relies on company-specific catalyst alone.';
    const catLine = {
      guidance:     'Guidance revisions typically reprice over 2–4 weeks as buy-side models update.',
      earnings:     'Post-earnings repricing usually plays out over 2–4 weeks of institutional repositioning.',
      product:      'Product catalysts take 3–6 weeks to show in demand and revenue expectation updates.',
      analyst:      'Analyst upgrades often trigger 1–3 weeks of institutional follow-through buying.',
      ma:           'M&A repricing is swift — days to weeks depending on deal certainty.',
      macro:        'Macro tailwinds can sustain a sector for weeks if confirmed by follow-on data prints.',
      geopolitical: 'Geopolitical catalysts often mean-revert — reassess if situation stabilises.',
      regulatory:   'Regulatory clarity events reprice over weeks as legal and financial teams assess impact.',
      general:      'Monitor for a harder follow-on signal to build conviction over the next 3–6 weeks.',
    }[cat] || 'Monitor for confirming catalysts over the next 3–6 weeks.';
    return `<b>Catalyst playthrough:</b> ${catLine}<br><b>Macro support:</b> ${macro}<br><b>Watch for:</b> Analyst revisions, earnings guidance, or sector news that confirms or invalidates the thesis within 3–6 weeks.`;
  }

  if (horizon === 'long') {
    const theses = {
      'Space':          'Space economy projected to reach $1.8T by 2035 (Goldman Sachs). Government contracts (NSSL, NASA, DoD) provide revenue floors; commercial satellite broadband is the secular growth driver. High binary risk on individual missions.',
      'Semiconductors': 'AI infrastructure supercycle driving multi-year chip demand. TSMC capacity constraints, GPU compute scarcity, and HBM memory supply are structural tailwinds through 2026+. US-China export controls are the primary downside risk.',
      'Big Tech':        'AI monetisation is in early innings. Cloud hyperscaler revenue lines expanding (Azure AI, Google Cloud AI, Meta AI). Rate sensitivity and antitrust are primary multiple-compression risks.',
      'Storage':         'HDD/SSD storage cycle bottoming. AI training data and inference storage demand is inflecting. Watch inventory normalisation for the cycle confirmation signal.',
      'Asia Tech':       'Structural tech demand growth continues but geopolitical discount persists. Exposed to China/Taiwan risk and USD cross-rate moves — size positions accordingly.',
      'Space ETF':       'Diversified space sector exposure reduces single-mission binary risk. Grows with the sector at lower individual-stock volatility than RKLB or LUNR alone.',
      'Commodity':       'Gold: structural de-dollarisation central bank buying provides a floor. Crude: OPEC+ supply management and geopolitical risk premium are key swing factors.',
    };
    const risks = {
      'Space':          'Mission failure · dilutive equity raises · contract delays · government funding cuts.',
      'Semiconductors': 'Export control escalation · US-China geopolitical flashpoint · demand cycle reversal.',
      'Big Tech':        'Antitrust regulatory action · AI capex ROI disappointment · Fed tightening restart.',
      'Storage':         'Demand recovery slower than expected · flash pricing pressure from oversupply.',
      'Asia Tech':       'Taiwan Strait military escalation · China economic slowdown · currency depreciation.',
      'Space ETF':       'Space sector de-rating · government contract budget cuts · risk-off rotation.',
      'Commodity':       'US dollar strengthening · demand destruction · OPEC+ supply surprise.',
    };
    const thesis = theses[inst.sector] || 'Structural growth sector — monitor earnings cadence and sector tailwinds over the holding period.';
    const risk   = risks[inst.sector]  || 'Sector-specific and macroeconomic risks apply over the 3–6 month horizon.';
    return `<b>Structural thesis:</b> ${thesis}<br><b>Key risks (3–6m):</b> ${risk}`;
  }
  return '';
}

function switchHorizon(h) {
  STATE.activeHorizon = h;
  renderRecommendations();
}

function buildRecoReason(inst, q, sig, pct, dipBonus, bullBonus) {
  const priceStr = fmtPrice(q.price, q.currency);
  const ws       = sig.weightedScore != null ? sig.weightedScore.toFixed(2) : null;

  // ── Driving news items (most recent bullish ones first) ───────────────
  const breakdown   = sig.breakdown || STATE.news[inst.id] || [];
  const bullishNews = breakdown.filter(n => n._sentiment === (sig.direction === 'bearish' ? 'bearish' : 'bullish'))
    .sort((a, b) => (a._ageHours || 99) - (b._ageHours || 99));
  const topItem   = bullishNews[0];
  const freshness = topItem ? (topItem._ageHours < 2 ? 'breaking' : topItem._ageHours < 8 ? 'today' : topItem._ageHours < 24 ? 'yesterday' : `${Math.round(topItem._ageHours / 24)}d ago`) : null;

  // ── Short-term take (today / next 1-2 days) ───────────────────────────
  let stLine;
  if (pct < -5 && sig.confidence === 'high') {
    stLine = `<b>Short-term:</b> ${inst.ticker} is down <b>${Math.abs(pct).toFixed(1)}%</b> today at ${priceStr} — a sharp flush with a high-confidence bullish catalyst. Strong asymmetric entry: the news says up, the price says down. Watch for a bounce in today's session or tomorrow open.`;
  } else if (pct < -2 && sig.confidence !== 'low') {
    stLine = `<b>Short-term:</b> ${inst.ticker} dropped <b>${Math.abs(pct).toFixed(1)}%</b> to ${priceStr} today. Dip is real but not panic-level — bullish news gives it a floor. Wait for price to stop falling before entering; a same-day reversal is possible.`;
  } else if (pct < 0) {
    stLine = `<b>Short-term:</b> Minor dip of <b>${Math.abs(pct).toFixed(1)}%</b> to ${priceStr}. Low urgency — no screaming entry right now. Monitor for a larger pullback to improve the risk/reward.`;
  } else {
    stLine = `<b>Short-term:</b> ${inst.ticker} is already <b>+${pct.toFixed(1)}%</b> today at ${priceStr} — this is momentum, not a dip. If you missed the move, wait for a retracement before chasing.`;
  }

  // ── Catalyst specifics ────────────────────────────────────────────────
  let catalystLine = '';
  if (topItem) {
    const catLabel = categoryLabel(topItem._category || 'general').toUpperCase();
    catalystLine = `<b>Catalyst (${freshness}):</b> "${topItem.headline}" — [${catLabel}]`;
    if (sig.newsCount > 1) catalystLine += ` + ${sig.newsCount - 1} more supporting items`;
    catalystLine += '.';
  } else {
    catalystLine = `<b>Signal basis:</b> ${sig.newsCount} news item${sig.newsCount !== 1 ? 's' : ''} — no single headline dominant.`;
  }

  // ── Signal quality for this specific reading ──────────────────────────
  const scoreStr = ws != null ? ` (score ${ws > 0 ? '+' : ''}${ws})` : '';
  const sigLine  = `<b>Signal quality:</b> ${sig.confidence.toUpperCase()} confidence${scoreStr} · ${sig.newsCount} item${sig.newsCount !== 1 ? 's' : ''} · ${categoryLabel(sig.topCategory)} dominant · band <b>${sig.magnitudeBand}</b>.`;

  // ── Medium-term take (days to weeks) ─────────────────────────────────
  let mtLine;
  if (sig.topCategory === 'earnings') {
    mtLine = `<b>Medium-term:</b> Earnings catalyst — if the beat/guidance holds, institutional re-rating can play out over 2–4 weeks. Watch for analyst price target revisions in the next 48h.`;
  } else if (sig.topCategory === 'guidance') {
    mtLine = `<b>Medium-term:</b> Raised guidance is a multi-week catalyst. Market needs time to reprice estimates. The ${sig.magnitudeBand} band can unfold over 1–3 weeks if no negative revisions follow.`;
  } else if (sig.topCategory === 'analyst') {
    mtLine = `<b>Medium-term:</b> Analyst upgrades often trigger institutional follow-through over days to weeks, especially if consensus is shifting. Monitor for additional upgrades.`;
  } else if (sig.topCategory === 'ma') {
    mtLine = `<b>Medium-term:</b> M&A can be binary and fast-moving. If the deal progresses, ${sig.magnitudeBand} is realistic over days to weeks — but deal risk cuts both ways.`;
  } else if (sig.topCategory === 'product') {
    mtLine = `<b>Medium-term:</b> Product catalysts play out over weeks as adoption/revenue expectations get repriced. The ${sig.magnitudeBand} band is achievable over 2–6 weeks.`;
  } else if (sig.topCategory === 'geopolitical') {
    mtLine = `<b>Medium-term:</b> Geopolitical moves are often short-lived overreactions. The ${sig.magnitudeBand} recovery band could come quickly — but hold tight stops since reversals are also fast.`;
  } else if (sig.topCategory === 'macro') {
    mtLine = `<b>Medium-term:</b> Macro tailwind for the whole sector — ${inst.name} benefits if it has direct exposure. Verify it does before sizing. Could sustain ${sig.magnitudeBand} over days to weeks.`;
  } else {
    mtLine = `<b>Medium-term:</b> General news flow. Less conviction than a hard catalyst — the ${sig.magnitudeBand} band is possible over 1–2 weeks but treat it as tentative until a cleaner signal emerges.`;
  }

  return [stLine, catalystLine, sigLine, mtLine].join('<br><br>');
}

function getSupportingIndicators(inst) {
  // Find indicators with bullish signals that are relevant to this instrument's sector
  const relevant = [];
  for (const ind of INDICATORS) {
    const sig = STATE.signals[ind.id];
    if (!sig || sig.direction === 'bearish') continue;
    // Sector relevance heuristic
    const isTech = ['Semiconductors','Big Tech','Storage','Asia Tech'].includes(inst.sector);
    const isSpace = ['Space','Space ETF'].includes(inst.sector);
    const isCommodity = inst.sector === 'Commodity';
    const isETF = inst.sector === 'Space ETF';
    if (isTech && (ind.id === 'TECH100' || ind.id === 'USA500')) relevant.push({ inst: ind, sig });
    else if (isSpace && (ind.id === 'USA500' || ind.id === 'TECH100' || ind.type === 'ETF')) relevant.push({ inst: ind, sig });
    else if (isCommodity && (ind.id === 'CRUDE' || ind.id === 'SGLN')) relevant.push({ inst: ind, sig });
    else if (ind.id === 'USA500') relevant.push({ inst: ind, sig });
  }
  // Deduplicate and cap at 4
  const seen = new Set();
  return relevant.filter(r => { if (seen.has(r.inst.id)) return false; seen.add(r.inst.id); return true; }).slice(0, 4);
}

// ─── Recommendations — Buy the Dip ───────────────────────────────────
let _recoRefreshTimer = null;

function renderRecommendations() {
  const container = $('recommendations-list');
  if (!container) return;

  const horizon = STATE.activeHorizon || 'short';

  // Horizon-specific direction filter
  const passesFilter = (dir) => {
    if (horizon === 'short')  return dir === 'bullish';
    if (horizon === 'medium') return dir !== 'bearish';
    return dir !== 'bearish'; // long: include mixed
  };

  const scored = WATCHLIST.map(inst => {
    const q   = STATE.quotes[inst.id];
    const sig = STATE.signals[inst.id];
    if (!q || !sig || !passesFilter(sig.direction)) return null;

    const pct    = q.changePct ?? 0;
    const { score, dipBonus, bullBonus, upsideBonus, newsBonus } = scoreForHorizon(inst, q, sig, pct, horizon);
    const retEst = estimateReturn(inst, sig, horizon);

    return { inst, q, sig, pct, score, dipBonus, bullBonus, upsideBonus, newsBonus, retEst };
  }).filter(Boolean);

  const top10 = scored.sort((a, b) => b.score - a.score).slice(0, 10);

  const lastRefreshed = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const horizonSub = {
    short:  'Dip depth · catalyst freshness · signal confidence',
    medium: 'Catalyst playthrough · macro alignment · growth tier',
    long:   'Structural thesis · sector momentum · long-term potential',
  }[horizon];

  const disclaimer = {
    short:  'Short-term signals decay fast — re-check daily. Ranked: dip depth, catalyst freshness, signal confidence.',
    medium: 'Medium-term: allow 3–6 weeks for catalysts to play through. Ranked: catalyst type, macro alignment, growth tier.',
    long:   'Long-term: tune out daily noise — the structural thesis matters. Ranked: sector growth potential, tier, signal quality.',
  }[horizon];

  const tabsHtml = `
    <div class="horizon-tabs">
      <button class="htab ${horizon === 'short'  ? 'active' : ''}" data-h="short"  onclick="switchHorizon('short')">
        <span class="htab-icon">⚡</span>
        <span class="htab-label">Short Term</span>
        <span class="htab-sub">days – 2 wks</span>
      </button>
      <button class="htab ${horizon === 'medium' ? 'active' : ''}" data-h="medium" onclick="switchHorizon('medium')">
        <span class="htab-icon">📈</span>
        <span class="htab-label">Medium Term</span>
        <span class="htab-sub">~1 month</span>
      </button>
      <button class="htab ${horizon === 'long'   ? 'active' : ''}" data-h="long"   onclick="switchHorizon('long')">
        <span class="htab-icon">🚀</span>
        <span class="htab-label">Long Term</span>
        <span class="htab-sub">3 – 6 months</span>
      </button>
    </div>
  `;

  const topbar = `
    <div class="reco-topbar">
      <div>
        <div class="reco-motto">Buy the Dip 📉→📈</div>
        <div class="reco-sub">Top ${top10.length > 0 ? top10.length : '—'} · ${horizonSub} · ${lastRefreshed}</div>
      </div>
      <button class="reco-refresh-btn" onclick="renderRecommendations()" title="Refresh now">⟳ Refresh</button>
    </div>
  `;

  if (top10.length === 0) {
    container.innerHTML = topbar + tabsHtml + `<div class="reco-empty"><p>Not enough signal data yet.</p><p>Prices and news are still loading.</p></div>`;
    return;
  }

  container.innerHTML = topbar + tabsHtml
    + top10.map((s, rank) => renderRecoCard(s, rank + 1)).join('')
    + `<div class="reco-disclaimer">${disclaimer} Not financial advice — always verify before investing.</div>`;
}

function renderRecoCard(s, rank) {
  const { inst, q, sig, pct, score, dipBonus, bullBonus, upsideBonus, newsBonus, retEst } = s;
  const horizon     = STATE.activeHorizon || 'short';
  const priceStr    = fmtPrice(q.price, q.currency);
  const changeStr   = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const changeClass = pct >= 0 ? 'positive' : 'negative';
  const rankColors  = ['#f0b429','#c0c0c0','#cd7f32','#4a9eff','#4a9eff','#4a9eff','#4a9eff','#4a9eff','#4a9eff','#4a9eff'];

  const whyText = buildRecoReason(inst, q, sig, pct, dipBonus, bullBonus);

  // Earnings proximity badge
  const today2 = new Date(); today2.setHours(0,0,0,0);
  const earnEntry = (STATE.earnings || []).find(e => e.symbol === inst.finnhub || e.symbol === inst.ticker);
  let earnBadgeHtml = '';
  if (earnEntry) {
    const daysToEarn = Math.round((new Date(earnEntry.date + 'T00:00:00') - today2) / 86400000);
    if (daysToEarn >= 0 && daysToEarn <= 14) {
      const col = daysToEarn <= 3 ? 'var(--red)' : daysToEarn <= 7 ? 'var(--amber)' : 'var(--text-sub)';
      earnBadgeHtml = `<span class="earn-badge" style="border-color:${col}44;color:${col}">Earnings ${daysToEarn === 0 ? 'today' : daysToEarn === 1 ? 'tomorrow' : `in ${daysToEarn}d`}</span>`;
    }
  }

  // ── Return estimate banner (with R/R ratio 7c) ───────────────────────
  const retColor   = sig.direction === 'bullish' ? '#00d084' : '#f5a623';
  // Position sizing hint (7b)
  const posSizeHint = inst.tier <= 1
    ? 'Consider \u22645% of portfolio per position'
    : inst.tier === 2
    ? 'Consider \u226410% of portfolio per position'
    : 'Consider \u226415% of portfolio per position';
  // Risk/Reward ratio (7c): reward = retEst.hi, risk = tier range[1] * 0.8
  const stopPctVal = (TIERS[inst.tier]?.range[1] || 4) * 0.8;
  const rrRatio = retEst && retEst.hi > 0 && stopPctVal > 0
    ? (retEst.hi / stopPctVal).toFixed(1)
    : null;
  const retEstHtml = retEst && retEst.hi > 0 ? `
    <div class="reco-ret-est" style="border-color:${retColor}33;background:${retColor}08">
      <div class="reco-ret-inner">
        <span class="reco-ret-label">Est. return</span>
        <span class="reco-ret-value" style="color:${retColor}">${retEst.sign}${retEst.lo}–${retEst.hi}%</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
        <span class="reco-ret-period">${retEst.label}</span>
        ${rrRatio ? `<span class="reco-ret-period" title="Risk:Reward — risk=${stopPctVal.toFixed(1)}% stop, reward=${retEst.hi}% est.">R/R: 1:${rrRatio}</span>` : ''}
      </div>
    </div>
    <div style="font-size:0.68rem;color:var(--text-muted);padding:0 2px 6px;font-style:italic">${posSizeHint}</div>
  ` : '';

  // ── Feature 10: Entry price optimizer ────────────────────────────────
  const entryZone = calcEntryZone(inst, q, sig);
  const entryZoneHtml = entryZone ? `
    <div class="entry-zone-card">
      <span class="entry-zone-label">Entry zone</span>
      <span class="entry-zone-range">${fmtPrice(entryZone.lower, entryZone.currency)} – ${fmtPrice(entryZone.upper, entryZone.currency)}</span>
      <span class="entry-zone-note">${entryZone.note}</span>
    </div>
  ` : '';

  // ── Horizon-specific intel ────────────────────────────────────────────
  const intelText  = buildHorizonIntel(inst, q, sig, pct, horizon);
  const intelLabel = { short: '⚡ Short-term intel', medium: '📈 Medium-term intel', long: '🚀 Long-term thesis' }[horizon];
  const horizonIntelHtml = intelText ? `
    <div class="reco-horizon-intel">
      <div class="reco-section-label">${intelLabel}</div>
      <div class="reco-horizon-text">${intelText}</div>
    </div>
  ` : '';

  // ── News drivers ──────────────────────────────────────────────────────
  const newsItems = (STATE.news[inst.id] || []).slice(0, 3);
  const macroSupport = getSupportingIndicators(inst);

  const macroHtml = macroSupport.length > 0 ? `
    <div class="reco-macro">
      <div class="reco-section-label">Macro support</div>
      <div class="reco-macro-tags">
        ${macroSupport.map(m => `
          <span class="reco-macro-tag ${m.sig.direction}" style="border-color:${m.inst.color}44;color:${m.inst.color}">
            ${directionArrow(m.sig.direction)} ${m.inst.ticker}
          </span>
        `).join('')}
      </div>
    </div>
  ` : '';

  const newsHeadlinesHtml = newsItems.length > 0 ? `
    <div class="reco-news-drivers">
      <div class="reco-section-label">Key signal drivers (${sig.newsCount} total news items)</div>
      ${newsItems.map(item => {
        const sent = item._sentiment || 'mixed';
        const cat  = item._category  || 'general';
        const mag  = newsItemMagnitude(item, inst);
        const col  = sentimentColor(sent);
        return `
          <div class="reco-news-row">
            <span class="reco-news-arrow" style="color:${col}">${directionArrow(sent)}</span>
            <div class="reco-news-content">
              <div class="reco-news-hl">${item.headline}</div>
              <div class="reco-news-meta">
                <span class="news-tag cat" style="font-size:0.62rem">${categoryLabel(cat).toUpperCase()}</span>
                <span class="news-sent-badge" style="color:${col};border-color:${col}44;font-size:0.65rem">${sent.charAt(0).toUpperCase() + sent.slice(1)}</span>
                ${mag ? `<span class="news-mag-badge" style="color:${col};border-color:${col}44;font-size:0.65rem">${mag}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="reco-card" onclick="selectInstrumentById('${inst.id}')">
      <div class="reco-left">
        <div class="reco-rank" style="color:${rankColors[rank-1]}">#${rank}</div>
        <div class="reco-score-pill" title="Horizon score">${score.toFixed(1)}</div>
        <div class="reco-score-breakdown">
          <div class="reco-score-item" title="Dip entry bonus">
            <span class="reco-score-lbl">Dip</span>
            <span class="${dipBonus > 0 ? 'positive' : 'negative'}">${dipBonus >= 0 ? '+' : ''}${dipBonus.toFixed(1)}</span>
          </div>
          <div class="reco-score-item" title="Signal confidence bonus">
            <span class="reco-score-lbl">Signal</span>
            <span class="${bullBonus > 0 ? 'positive' : 'negative'}">${bullBonus >= 0 ? '+' : ''}${bullBonus.toFixed(1)}</span>
          </div>
          <div class="reco-score-item" title="Growth + horizon catalyst bonus">
            <span class="reco-score-lbl">Upside</span>
            <span class="positive">+${Math.max(0, upsideBonus).toFixed(1)}</span>
          </div>
          <div class="reco-score-item" title="News volume bonus">
            <span class="reco-score-lbl">News</span>
            <span class="positive">+${newsBonus.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div class="reco-body">
        <div class="reco-top-row">
          <div class="reco-avatar" style="background:${inst.color}22;border-color:${inst.color}44">
            <span style="color:${inst.color}">${avatarInitials(inst.name)}</span>
          </div>
          <div class="reco-title">
            <div class="reco-name">${inst.name}</div>
            <div class="reco-ticker-meta">
              <span class="card-ticker">${inst.ticker}</span>
              <span class="reco-sector-tag">${inst.sector}</span>
              <span class="reco-tier-tag">Vol Tier ${inst.tier}</span>
            </div>
          </div>
          <div class="reco-price-col">
            <div class="reco-price">${priceStr}</div>
            <div class="reco-change ${changeClass}">${changeStr}</div>
          </div>
        </div>

        <div class="reco-signal-row">
          <span class="signal-badge ${sig.direction}">${directionArrow(sig.direction)} ${directionLabel(sig.direction)}</span>
          <span class="reco-band">${sig.magnitudeBand}</span>
          <span class="conf-stars">${confidenceStars(sig.confidence)}</span>
          <span class="reco-conf-label">${sig.confidence.toUpperCase()}</span>
          ${earnBadgeHtml}
        </div>

        ${retEstHtml}
        ${entryZoneHtml}

        ${horizon !== 'long' ? `
        <div class="reco-why">
          <div class="reco-section-label">Signal analysis</div>
          <div class="reco-why-text">${whyText}</div>
        </div>` : ''}

        ${horizonIntelHtml}
        ${newsHeadlinesHtml}
        ${macroHtml}
      </div>
    </div>
  `;
}

function renderNewsItem(item, inst) {
  const cat       = item._category  || 'general';
  const sent      = item._sentiment || 'mixed';
  const micro     = item._micro;
  const age       = fmtAge(item.datetime);
  const kws       = item._matchedKws || [];
  const color     = sentimentColor(sent);
  const sentIcon  = sent === 'bullish' ? '▲' : sent === 'bearish' ? '▼' : '◆';
  const sentLabel = sent === 'bullish' ? 'Bullish' : sent === 'bearish' ? 'Bearish' : 'Neutral';
  const affected  = item._affected || [];
  const impact    = item._impact || '';
  const magBand   = newsItemMagnitude(item, inst);

  // Affected instrument tags
  const affectedHtml = affected.length > 0 ? `
    <div class="news-affected">
      <span class="news-affected-label">Affects:</span>
      ${affected.map(i => `
        <span class="news-affected-tag" style="border-color:${i.color}44;color:${i.color}" title="${i.name}">${i.ticker}</span>
      `).join('')}
    </div>
  ` : '';

  // Impact analysis
  const impactHtml = impact ? `
    <div class="news-impact">
      <div class="news-impact-label">Portfolio impact</div>
      <div class="news-impact-text">${impact}</div>
    </div>
  ` : '';

  // Signal driver keywords
  const kwsHtml = kws.length > 0 ? `
    <div class="news-kws">
      <span class="news-kws-label">Signal drivers:</span>
      ${kws.map(k => `<code>${k}</code>`).join(' ')}
    </div>
  ` : '';

  return `
    <div class="news-item sentiment-${sent}">
      <div class="news-tags">
        <span class="news-tag ${micro ? 'micro' : 'macro'}">${micro ? 'MICRO' : 'MACRO'}</span>
        <span class="news-tag cat">${categoryLabel(cat).toUpperCase()}</span>
        <span class="news-age">${age}</span>
      </div>

      <div class="news-headline">
        <span class="news-sent-icon" style="color:${color}">${sentIcon}</span>
        ${item.headline}
      </div>

      <div class="news-source-row">
        <span class="news-source">${item.source || ''}</span>
        <span class="news-sent-badge" style="color:${color};border-color:${color}44">${sentLabel}</span>
        ${magBand ? `<span class="news-mag-badge" style="color:${color};border-color:${color}44">${magBand} est. impact</span>` : ''}
      </div>

      ${item.summary && item.summary !== item.headline ? `<div class="news-summary">${item.summary}</div>` : ''}

      ${affectedHtml}
      ${impactHtml}
      ${kwsHtml}

      ${item.url && item.url !== '#' ? `<a class="news-link" href="${item.url}" target="_blank" rel="noopener">Read full story →</a>` : ''}
    </div>
  `;
}

// ─── On-demand news fetch (called when instrument has no news yet) ────
async function ensureNews(inst) {
  if ((STATE.news[inst.id] || []).length > 0) return; // already loaded
  const items = await getNews(inst).catch(() => []);
  if (!items.length) return;
  const merged = [...items, ...(STATE.news[inst.id] || [])];
  const seen = new Set();
  STATE.news[inst.id] = merged.filter(item => {
    const key = item.id || item.headline;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 25);
  const sig = computeSignal(STATE.news[inst.id], inst);
  STATE.signals[inst.id] = sig;
  if (sig.breakdown?.length > 0) STATE.news[inst.id] = sig.breakdown;
  patchCard(inst.id);
  if (STATE.activeId === inst.id) renderDetail(inst);
}

// ─── Instrument Selection ─────────────────────────────────────────────
function selectInstrumentById(id) {
  const inst = [...WATCHLIST, ...INDICATORS].find(i => i.id === id);
  if (!inst) return;
  STATE.activeId = id;

  // Update active card highlight
  document.querySelectorAll('.inst-card').forEach(c => c.classList.remove('active'));
  const card = $(`card-${id}`);
  if (card) card.classList.add('active');

  renderDetail(inst);
  loadChart(inst, STATE.chartRange); // async — serves from localStorage cache or fetches

  // Fetch news on-demand if not yet loaded for this instrument
  if (!STATE.news[id] || STATE.news[id].length === 0) ensureNews(inst);

  // On mobile: switch to detail view
  if (window.innerWidth < 768) showView('detail');

  // Notify if there's a signal
  const sig = STATE.signals[id];
  if (sig && sig.newsCount > 0) {
    const banner = $('alert-banner');
    const arrow = directionArrow(sig.direction);
    const color = sentimentColor(sig.direction);
    $('alert-banner-text').innerHTML =
      `<span style="color:${color}">${arrow} ${inst.ticker}</span> — ${directionLabel(sig.direction)} · ${sig.magnitudeBand} · ${sig.confidence.toUpperCase()} confidence · ${sig.newsCount} news items`;
    banner.className = 'alert-banner ' + sig.direction;
    banner.classList.remove('hidden');
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.classList.add('hidden'), 6000);
  }

  // Close notif panel if open
  $('notif-panel').classList.add('hidden');
}

// ─── Tabs ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  STATE.activeTab = tab;
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('watchlist-list').classList.toggle('hidden', tab !== 'watchlist');
  $('indicators-list').classList.toggle('hidden', tab !== 'indicators');
  $('recommendations-list').classList.toggle('hidden', tab !== 'recommendations');
  $('holdings-list').classList.toggle('hidden', tab !== 'holdings');
  $('newsfeed-list').classList.toggle('hidden', tab !== 'news');

  // Hide filter bar + search for special tabs
  const hideSearch = tab === 'recommendations' || tab === 'holdings' || tab === 'news';
  document.querySelector('.filter-bar').style.display = hideSearch ? 'none' : '';
  document.querySelector('.sidebar-search').style.display = hideSearch ? 'none' : '';

  // Start/stop auto-refresh for recommendations tab
  if (_recoRefreshTimer) { clearInterval(_recoRefreshTimer); _recoRefreshTimer = null; }
  if (tab === 'recommendations') {
    renderRecommendations();
    _recoRefreshTimer = setInterval(renderRecommendations, 10000);
  }
  if (tab === 'holdings') {
    renderHoldings();
  }
  if (tab === 'news') {
    renderNewsFeed();
  }
}

// ─── Search ───────────────────────────────────────────────────────────
function filterList(query) {
  const q = query.toLowerCase().trim();

  // Show/hide individual cards
  document.querySelectorAll('.inst-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? '' : 'none';
  });

  // Show/hide group labels + auto-expand groups with matches when searching
  document.querySelectorAll('.list-group-label').forEach(lbl => {
    const key       = lbl.dataset.groupKey;
    const itemsDiv  = key ? document.querySelector(`[data-group-items="${key}"]`) : null;
    if (!itemsDiv) return;

    const cards    = itemsDiv.querySelectorAll('.inst-card');
    const anyMatch = [...cards].some(c => c.style.display !== 'none');

    lbl.style.display = anyMatch ? '' : 'none';

    if (q) {
      // Searching — expand groups that have matches so cards are visible
      if (anyMatch) itemsDiv.style.display = '';
    } else {
      // Cleared search — restore collapsed state
      const open = !!(window._groupOpen && window._groupOpen[key]);
      itemsDiv.style.display = open ? '' : 'none';
    }
  });
}

// ─── Sort ─────────────────────────────────────────────────────────────
function sortList(mode) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === mode));
  // Re-render with sorted order
  const instruments = STATE.activeTab === 'watchlist' ? [...WATCHLIST] : [...INDICATORS];
  if (mode === 'bullish') {
    instruments.sort((a, b) => {
      const sa = STATE.signals[a.id]?.direction === 'bullish' ? -1 : 1;
      const sb = STATE.signals[b.id]?.direction === 'bullish' ? -1 : 1;
      return sa - sb;
    });
  } else if (mode === 'bearish') {
    instruments.sort((a, b) => {
      const sa = STATE.signals[a.id]?.direction === 'bearish' ? -1 : 1;
      const sb = STATE.signals[b.id]?.direction === 'bearish' ? -1 : 1;
      return sa - sb;
    });
  } else if (mode === 'alerts') {
    instruments.sort((a, b) => (STATE.news[b.id]?.length || 0) - (STATE.news[a.id]?.length || 0));
  }
  const listId = STATE.activeTab === 'watchlist' ? 'watchlist-list' : 'indicators-list';
  const container = $(listId);
  let html = '';
  instruments.forEach(inst => { html += renderCard(inst); });
  container.innerHTML = html;
}

// ─── Mobile View Toggle ───────────────────────────────────────────────
function showView(view) {
  const sidebar = $('sidebar');
  const detail = $('detail-panel');
  document.querySelectorAll('.mnav-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && view === 'list') || (i === 1 && view === 'detail') || (i === 2 && view === 'alerts'));
  });
  if (window.innerWidth < 768) {
    sidebar.style.display = view === 'list' ? 'flex' : 'none';
    detail.style.display = view === 'detail' ? 'flex' : 'none';
  }
  if (view === 'alerts') toggleNotifPanel();
}

// ─── Settings ─────────────────────────────────────────────────────────
function showSettings() {
  $('setup-modal').classList.remove('hidden');
  $('api-key-input').value = API.token;
}

// ─── Signal Computation + Notification Trigger ────────────────────────
function recomputeSignals() {
  const all = [...WATCHLIST, ...INDICATORS];
  all.forEach(inst => {
    const news = STATE.news[inst.id] || [];
    const sig = computeSignal(news, inst);
    const prev = STATE.signals[inst.id];
    STATE.signals[inst.id] = sig;

    // KEY FIX: write enriched breakdown (with _category, _sentiment, _micro etc.) back into
    // STATE.news so renderNewsItem gets fully annotated items, not raw API responses
    if (sig.breakdown && sig.breakdown.length > 0) {
      STATE.news[inst.id] = sig.breakdown;
    }

    // Trigger notification if direction changed or newly appeared
    const changed = !prev || (prev.direction !== sig.direction && sig.newsCount > 0);
    if (changed && sig.direction !== 'mixed' && sig.newsCount >= 2) {
      pushNotification(inst, sig, true);
    }
  });
}

// ─── Global Market Clock ───────────────────────────────────────────────
function fmtCountdown(minsLeft) {
  const h = Math.floor(minsLeft / 60);
  const m = minsLeft % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderMarketClocks() {
  const el = $('market-clocks');
  if (!el) return;
  const sessions = [
    { key: 'NYSE',     short: 'US',  full: 'NYSE/NASDAQ' },
    { key: 'LSE',      short: 'LON', full: 'London'      },
    { key: 'EURONEXT', short: 'EU',  full: 'Euronext'    },
  ];
  el.innerHTML = sessions.map(s => {
    const info = getExchangeNow(s.key);
    const ex   = EXCHANGE_HOURS[s.key];
    if (!info) return '';
    const [oh, om] = ex.open.split(':').map(Number);
    const [ch, cm] = ex.close.split(':').map(Number);
    const [nh, nm] = info.hm.split(':').map(Number);
    const nowMin   = nh * 60 + nm;
    const openMin  = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    const preMin   = openMin - 60;

    let state, statusLine;

    if (info.isWeekend) {
      state = 'closed';
      // Mins from now until Monday open (weekend calc)
      const dayMap = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
      const day = info.hm; // hm is available, need weekday — compute days to Monday
      const dayName = new Intl.DateTimeFormat('en-US',{ timeZone: ex.tz, weekday:'short' }).format(new Date());
      const daysToMon = dayName === 'Sat' ? 2 : 1; // Sat→Mon=2, Sun→Mon=1
      const minsToMon = daysToMon * 1440 - nowMin + openMin;
      statusLine = `opens Mon · ${fmtCountdown(minsToMon)}`;
    } else if (nowMin >= openMin && nowMin < closeMin) {
      state = 'open';
      const left = closeMin - nowMin;
      statusLine = `closes in ${fmtCountdown(left)}`;
    } else if (nowMin >= preMin && nowMin < openMin) {
      state = 'premarket';
      const left = openMin - nowMin;
      statusLine = `pre-mkt · opens ${fmtCountdown(left)}`;
    } else if (nowMin >= closeMin) {
      state = 'closed';
      // After close: mins until tomorrow open
      const minsToTomorrow = 1440 - nowMin + openMin;
      statusLine = `opens in ${fmtCountdown(minsToTomorrow)}`;
    } else {
      state = 'closed';
      statusLine = `opens at ${ex.open}`;
    }

    return `
      <div class="clock-pill clock-${state}" title="${s.full}: ${statusLine}">
        <span class="mkt-dot ${marketStateDot(state)}"></span>
        <div class="clock-body">
          <span class="clock-label">${s.short} <span class="clock-time">${info.hm}</span></span>
          <span class="clock-status">${statusLine}</span>
        </div>
      </div>`;
  }).join('');
}

// ─── Per-card refresh countdown bars ─────────────────────────────────
// Called every second. Updates bar + age text + live dot without card re-render.
//
//  WS source      → pulsing green bar  (continuous live)
//  Finnhub REST   → solid green bar while fresh (<= poll interval), then countdown
//  Stooq source   → muted grey bar     (~15m exchange delay, countdown = next poll)
//  Yahoo source   → blue countdown bar
function updateRefreshBars() {
  const now      = Date.now();
  const interval = API.REFRESH_PRICES_MS;
  const liveWin  = interval + 2000; // window in which REST data counts as "● Live"

  const all = [...WATCHLIST, ...INDICATORS];
  for (let i = 0; i < all.length; i++) {
    const inst  = all[i];
    const bar   = document.getElementById(`rbar-${inst.id}`);
    const ageEl = document.getElementById(`cage-${inst.id}`);
    const dotEl = document.getElementById(`ldot-${inst.id}`);
    const q     = STATE.quotes[inst.id];

    if (!q || !q._fetchedAt) {
      if (bar)   { bar.style.width = '0%'; bar.className = 'card-refresh-bar'; }
      if (ageEl) { ageEl.textContent = ''; ageEl.className = 'price-age'; }
      if (dotEl) dotEl.classList.add('ldot-hidden');
      continue;
    }

    const age    = now - q._fetchedAt;
    const src    = q._source || 'unknown';
    const ageStr = fmtQuoteAge(q);
    const ageCls = ageStr === '● Live' ? 'price-age live' : 'price-age';

    // ── Age text (no card re-render) ──────────────────────────────────
    if (ageEl) {
      if (ageEl.textContent !== (ageStr || '')) ageEl.textContent = ageStr || '';
      if (ageEl.className   !== ageCls)         ageEl.className   = ageCls;
    }

    // ── Determine live states ─────────────────────────────────────────
    const isWsLive   = (src === 'ws' || src === 'yf-ws') && q._live && age < 45000;
    const isRestLive = (src === 'finnhub' || src === 'yahoo' || src === 'twelvedata') && age < liveWin;
    const isStooq    = src === 'stooq';

    // ── Live dot visibility ───────────────────────────────────────────
    if (dotEl) {
      const shouldShow = isWsLive || isRestLive;
      const hidden = dotEl.classList.contains('ldot-hidden');
      if (shouldShow && hidden)  dotEl.classList.remove('ldot-hidden');
      if (!shouldShow && !hidden) dotEl.classList.add('ldot-hidden');
    }

    if (!bar) continue;

    // ── Bar state ────────────────────────────────────────────────────
    if (isWsLive) {
      // WebSocket — permanently pulsing green
      if (bar.className !== 'card-refresh-bar ws-live') bar.className = 'card-refresh-bar ws-live';
      if (bar.style.width !== '100%') bar.style.width = '100%';
      bar.title = 'Live · WebSocket';

    } else if (isRestLive) {
      // Finnhub REST — freshly polled, solid green
      if (bar.className !== 'card-refresh-bar rest-live') bar.className = 'card-refresh-bar rest-live';
      if (bar.style.width !== '100%') bar.style.width = '100%';
      bar.title = 'Live · REST polled';

    } else if (isStooq) {
      // Stooq — delayed data, muted grey countdown to next poll
      if (bar.className !== 'card-refresh-bar stooq-poll') bar.className = 'card-refresh-bar stooq-poll';
      const pct     = Math.max(0, 100 - (age / interval) * 100);
      const secLeft = Math.ceil(Math.max(0, interval - age) / 1000);
      bar.style.width = pct.toFixed(1) + '%';
      bar.title = `~15m exchange delay · next poll in ${secLeft}s`;

    } else {
      // REST counting down to next poll (REST but past live window)
      const pct     = Math.max(0, 100 - (age / interval) * 100);
      const secLeft = Math.ceil(Math.max(0, interval - age) / 1000);
      const newCls  = pct < 20 ? 'card-refresh-bar stale' : 'card-refresh-bar';
      if (bar.className !== newCls) bar.className = newCls;
      bar.style.width = pct.toFixed(1) + '%';
      bar.title = pct > 1 ? `Next poll in ${secLeft}s` : 'Refreshing…';
    }
  }
}

// ─── Last Updated + WS Status ─────────────────────────────────────────
function updateTimestamp() {
  const el = $('last-updated');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  renderMarketClocks();
  updateRefreshBars();
}

function updateWsStatus() {
  const el = $('ws-status');
  if (!el || STATE.demoMode) return;
  const finnOk = typeof _wsConnected !== 'undefined' && _wsConnected;
  const yfOk   = typeof _yfConnected !== 'undefined' && _yfConnected;
  if (finnOk && yfOk) {
    el.className   = 'ws-status ws-live';
    el.textContent = '⚡ WS Live';
    el.title       = 'Finnhub WS (primary · US stocks + CFDs) + Yahoo Finance WS (secondary · indices, ETFs, futures) — both connected';
  } else if (finnOk) {
    el.className   = 'ws-status ws-live';
    el.textContent = 'WS Live';
    el.title       = 'Finnhub WebSocket connected (primary) — Yahoo WS reconnecting';
  } else if (yfOk) {
    el.className   = 'ws-status ws-polling';
    el.textContent = 'WS Partial';
    el.title       = 'Yahoo Finance WS connected (secondary) — Finnhub WS disconnected, falling back';
  } else {
    el.className   = 'ws-status ws-polling';
    el.textContent = 'Polling';
    el.title       = 'No WebSocket — falling back to REST polling every 8s';
  }
}

async function manualRefresh() {
  const btn = $('refresh-btn');
  if (btn) btn.classList.add('spinning');
  try { await refreshPrices(); } catch(e) { console.warn('Manual refresh error:', e); }
  if (btn) btn.classList.remove('spinning');
}

// ─── Debounced live-price sidebar update (WebSocket fires this) ───────
let _sidebarDebounce = null;
let _detailDebounce  = null;

function onLiveTrade(id) {
  // Update only the specific card to avoid full re-render on every tick
  const inst = [...WATCHLIST, ...INDICATORS].find(i => i.id === id);
  if (!inst) return;

  // Patch the specific card HTML in-place
  const cardEl = $(`card-${id}`);
  if (cardEl) {
    const newHtml = renderCard(inst);
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    const newCard = tmp.firstElementChild;
    // Flash animation
    newCard.classList.add('price-flash');
    cardEl.replaceWith(newCard);
    setTimeout(() => $(`card-${id}`)?.classList.remove('price-flash'), 600);
  }

  // Update detail panel price row if this instrument is selected
  if (STATE.activeId === id) {
    if (_detailDebounce) return;
    _detailDebounce = setTimeout(() => {
      _detailDebounce = null;
      const i = [...WATCHLIST, ...INDICATORS].find(x => x.id === STATE.activeId);
      if (i) {
        // Just refresh the price row, not the whole panel
        const q = STATE.quotes[id];
        const priceEl = document.querySelector('.detail-price');
        const changeEl = document.querySelector('.detail-change');
        if (priceEl && q) priceEl.textContent = fmtPrice(q.price, q.currency);
        if (changeEl && q?.changePct != null) {
          const pct = q.changePct;
          changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
          changeEl.className = `detail-change ${pct >= 0 ? 'positive' : 'negative'}`;
        }
      }
    }, 100);
  }

  // Update timestamp and WS status on every trade
  updateTimestamp();
  updateWsStatus();
}

// ─── Full Refresh Cycle (REST polling — skips WebSocket-live instruments) ────
// Only instruments without fresh WS data are re-polled. This keeps Finnhub
// REST calls well within free-tier rate limits and lets non-WS instruments
// get polled more frequently.
async function refreshPrices() {
  const all = [...WATCHLIST, ...INDICATORS];

  // Skip instruments that already have fresh WebSocket data (<= 25s).
  // Always re-poll scaleFromStooq instruments to keep the index scale accurate.
  const toRefresh = all.filter(inst => {
    const q = STATE.quotes[inst.id];
    if (!q) return true;
    if (inst.scaleFromStooq) return true;   // needs periodic scale recalibration
    if (q._source === 'ws' && q._live && (Date.now() - q._fetchedAt) < 25000) return false;
    return true;
  });

  const refreshed = [];
  await Promise.allSettled(toRefresh.map(async (inst) => {
    const q = await getPrice(inst).catch(() => null);
    if (!q) return;
    // Don't overwrite fresh WebSocket data with a delayed REST/Stooq response.
    // For scaleFromStooq instruments (TECH100, USA500) the getPrice call still runs
    // — its purpose here is recalibrating STATE.priceScales via side effect.
    // The returned stooq quote is secondary and should not clobber live WS data.
    const existing  = STATE.quotes[inst.id];
    const wsIsFresh = existing?._source === 'ws' && existing?._live &&
                      (Date.now() - existing._fetchedAt) < 30000;
    if (!wsIsFresh) {
      STATE.quotes[inst.id] = q;
      refreshed.push(inst);
    }
  }));

  // Patch only the cards whose data actually changed
  refreshed.forEach(inst => patchCard(inst.id));

  if (STATE.activeId && toRefresh.some(i => i.id === STATE.activeId)) {
    const inst = all.find(i => i.id === STATE.activeId);
    if (inst) renderDetail(inst);
  }
  // Refresh overview if no instrument selected
  if (!STATE.activeId) renderOverview();
  // Refresh holdings if tab is active
  if (STATE.activeTab === 'holdings') renderHoldings();
  updateTimestamp();
}

async function refreshNews() {
  await loadAllNews();
  recomputeSignals();
  renderSidebar();
  if (STATE.activeId) {
    const inst = [...WATCHLIST, ...INDICATORS].find(i => i.id === STATE.activeId);
    if (inst) renderDetail(inst);
  }
  // Refresh news feed if the tab is active
  if (STATE.activeTab === 'news') renderNewsFeed();
  // Refresh overview if no instrument selected
  if (!STATE.activeId) renderOverview();
}

// ─── Setup Modal Handlers ─────────────────────────────────────────────
function initSetupModal() {
  // Pre-fill saved keys if returning user
  const savedTD = API.twelveDataKey;
  if (savedTD && $('twelvedata-key-input')) $('twelvedata-key-input').value = savedTD;

  $('save-key-btn').onclick = () => {
    const key  = $('api-key-input').value.trim();
    const tdKey = $('twelvedata-key-input')?.value.trim() || '';
    if (!key) return alert('Please enter your Finnhub API key.');
    API.token = key;
    if (tdKey) API.twelveDataKey = tdKey;
    STATE.demoMode = false;
    localStorage.removeItem('demo_mode');
    $('setup-modal').classList.add('hidden');
    startApp();
  };
  $('demo-mode-btn').onclick = () => {
    STATE.demoMode = true;
    localStorage.setItem('demo_mode', 'true');
    $('setup-modal').classList.add('hidden');
    startApp();
  };
  $('alert-banner-close').onclick = () => $('alert-banner').classList.add('hidden');
}

// ─── Progress Bar ─────────────────────────────────────────────────────
function initProgressBar(total) {
  const wrap  = $('load-bar-wrap');
  const bar   = $('load-bar');
  const label = $('load-bar-label');
  let done = 0;
  wrap.classList.remove('hidden');
  bar.style.width = '1%';
  label.textContent = `Loading 0 / ${total}…`;

  return function tick() {
    done++;
    const pct = Math.min(100, Math.round((done / total) * 100));
    bar.style.width = pct + '%';
    label.textContent = done < total ? `Loading ${done} / ${total}…` : 'Done';
    if (done >= total) {
      setTimeout(() => { wrap.classList.add('hidden'); bar.style.width = '0%'; }, 700);
    }
  };
}

// ─── Progressive card update helper ──────────────────────────────────
function patchCard(id) {
  const inst = [...WATCHLIST, ...INDICATORS].find(i => i.id === id);
  if (!inst) return;
  const cardEl = $(`card-${id}`);
  if (!cardEl) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderCard(inst);
  const newCard = tmp.firstElementChild;
  cardEl.replaceWith(newCard);
}

// ─── Sidebar Toggle (Feature 1) ───────────────────────────────────────
function toggleSidebar() {
  const sidebar = $('sidebar');
  const btn = $('sidebar-toggle');
  const isCollapsed = sidebar.classList.toggle('collapsed');
  if (btn) btn.textContent = isCollapsed ? '›' : '‹';
  localStorage.setItem('sidebar_collapsed', isCollapsed ? '1' : '0');
}

// ─── Back to Overview ─────────────────────────────────────────────────
function goToOverview() {
  STATE.activeId = null;
  document.querySelectorAll('.inst-card').forEach(c => c.classList.remove('active'));
  renderOverview();
}

// ─── Heatmap period helpers ────────────────────────────────────────────
function getHeatmapPct(inst, period) {
  if (period === '1D') return STATE.quotes[inst.id]?.changePct ?? null;
  const cached = STATE.chartData?.[inst.id]?.[period];
  if (!cached?.closes?.length) return null;
  const closes = cached.closes.filter(v => v != null);
  if (closes.length < 2) return null;
  return ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
}

function switchHeatmapPeriod(p) {
  STATE.heatmapPeriod = p;
  renderOverview();   // immediate render — tiles with cached data show at once
  if (p === '1D') return;
  // Queue fetches for any tiles still missing data (preload may not be done yet).
  // Already-cached tiles are skipped; in-flight preload fetches will call
  // scheduleOverviewRefresh when they land, so this just covers the gap.
  [...WATCHLIST, ...INDICATORS].forEach(inst => {
    if (!STATE.chartData?.[inst.id]?.[p]) {
      RequestQueue.add(() =>
        fetchChartData(inst, p)
          .then(data => {
            if (data?.closes?.length) {
              cacheChart(inst.id, p, data);
              scheduleOverviewRefresh(p);
            }
          })
          .catch(() => {})
      );
    }
  });
}

// ─── Trend Assessment ─────────────────────────────────────────────────
// Uses cached chart data (3M preferred, fallback 1M) to derive:
//   • Price position vs SMA20 and SMA50 (structural bias)
//   • SMA20/50 alignment (golden/death cross region)
//   • 5-session momentum (short-term drift)
//   • Consecutive up/down days (streak)
// Returns a normalised trendScore [-1..1] plus human-readable context.
function computeTrend(inst) {
  const chart = loadChartFromStorage(inst.id, '3M') || loadChartFromStorage(inst.id, '1M');
  if (!chart?.closes) return null;

  const closes = chart.closes.filter(v => v != null);
  if (closes.length < 20) return null;

  const current = STATE.quotes[inst.id]?.price ?? closes[closes.length - 1];

  // ── Moving averages ────────────────────────────────────────────────
  const sma20arr = calcSMA(closes, 20);
  const sma50arr = closes.length >= 50 ? calcSMA(closes, 50) : null;
  const sma20    = sma20arr[sma20arr.length - 1];
  const sma50    = sma50arr ? sma50arr[sma50arr.length - 1] : null;

  let trendScore = 0;
  const signals  = [];

  // Price vs SMA20 — short-term structural bias
  if (sma20 != null) {
    const d = ((current - sma20) / sma20) * 100;
    if      (d >  3) { trendScore += 0.35; signals.push({ t: `Price ${d.toFixed(1)}% above SMA20`, pos: true  }); }
    else if (d >  0) { trendScore += 0.15; signals.push({ t: `Price above SMA20`, pos: true  }); }
    else if (d < -3) { trendScore -= 0.35; signals.push({ t: `Price ${Math.abs(d).toFixed(1)}% below SMA20`, pos: false }); }
    else             { trendScore -= 0.15; signals.push({ t: `Price below SMA20`, pos: false }); }
  }

  // Price vs SMA50 — medium-term structural bias
  if (sma50 != null) {
    const d = ((current - sma50) / sma50) * 100;
    if      (d >  4) { trendScore += 0.30; signals.push({ t: `Price ${d.toFixed(1)}% above SMA50`, pos: true  }); }
    else if (d >  0) { trendScore += 0.12; signals.push({ t: `Price above SMA50`, pos: true  }); }
    else if (d < -4) { trendScore -= 0.30; signals.push({ t: `Price ${Math.abs(d).toFixed(1)}% below SMA50`, pos: false }); }
    else             { trendScore -= 0.12; signals.push({ t: `Price below SMA50`, pos: false }); }
  }

  // SMA alignment — golden / death cross region
  if (sma20 != null && sma50 != null) {
    if (sma20 > sma50) { trendScore += 0.20; signals.push({ t: `SMA20 > SMA50 — bullish alignment`, pos: true  }); }
    else               { trendScore -= 0.20; signals.push({ t: `SMA20 < SMA50 — bearish alignment`, pos: false }); }
  }

  // 5-session drift
  if (closes.length >= 5) {
    const drift = ((closes.at(-1) - closes.at(-5)) / closes.at(-5)) * 100;
    if      (drift >  4) { trendScore += 0.15; signals.push({ t: `+${drift.toFixed(1)}% last 5 sessions`, pos: true  }); }
    else if (drift >  1) { trendScore += 0.07; }
    else if (drift < -4) { trendScore -= 0.15; signals.push({ t: `${drift.toFixed(1)}% last 5 sessions`, pos: false }); }
    else if (drift < -1) { trendScore -= 0.07; }
  }

  // Consecutive up/down day streak (last 4 closes)
  if (closes.length >= 5) {
    const last4 = closes.slice(-5);
    let streak = 0;
    for (let i = last4.length - 1; i >= 1; i--) {
      const up = last4[i] > last4[i - 1];
      if (i === last4.length - 1) { streak = up ? 1 : -1; continue; }
      if ((streak > 0 && up) || (streak < 0 && !up)) streak += streak > 0 ? 1 : -1;
      else break;
    }
    if      (streak >=  3) { trendScore += 0.10; signals.push({ t: `${Math.abs(streak)}-day up streak`, pos: true  }); }
    else if (streak <= -3) { trendScore -= 0.10; signals.push({ t: `${Math.abs(streak)}-day down streak`, pos: false }); }
  }

  // Clamp and label
  trendScore = Math.max(-1, Math.min(1, trendScore));
  let trendLabel, trendClass;
  if      (trendScore >  0.45) { trendLabel = 'Uptrend';        trendClass = 'trend-up';   }
  else if (trendScore >  0.15) { trendLabel = 'Mild uptrend';   trendClass = 'trend-mild-up'; }
  else if (trendScore < -0.45) { trendLabel = 'Downtrend';      trendClass = 'trend-dn';   }
  else if (trendScore < -0.15) { trendLabel = 'Mild downtrend'; trendClass = 'trend-mild-dn'; }
  else                         { trendLabel = 'Sideways';       trendClass = 'trend-side'; }

  return { trendScore, trendLabel, trendClass, signals, sma20, sma50, current };
}

// ─── Day Prediction Engine ────────────────────────────────────────────
// Combines 5 independent signals into a per-instrument prediction.
// Weights: news signal 35%, macro 25%, trend 20%, momentum 12%, RSI 8%.
// Output: direction + predicted % band + multi-factor confidence rating.
function computeDayPredictions() {
  // Reuse macro pulse scores — avoid recomputing sensitivities
  const macroData = computeMacroPulse();
  const macroScoreMap = {};
  macroData.scored.forEach(item => { macroScoreMap[item.inst.id] = item.score; });

  // Tier → [lo%, hi%] expected daily move band (from config TIERS)
  const TIER_RANGES = { 1:[3,15], 2:[2,8], 3:[1,4], 4:[2,6], 5:[1,4], 6:[0.3,2], 7:[0.5,3] };

  const predictions = WATCHLIST.filter(i => i.sector !== 'Commodity').map(inst => {
    const sig        = STATE.signals[inst.id];
    const q          = STATE.quotes[inst.id];
    const macroScore = macroScoreMap[inst.id] ?? 0;
    const [lo, hi]   = TIER_RANGES[inst.tier] || [1, 5];

    // ── Factor 1: News signal (-1..1) — strongest near-term predictor ──
    let signalScore = 0;
    if (sig?.direction === 'bullish') {
      signalScore = sig.confidence === 'high' ? 1.0 : sig.confidence === 'medium' ? 0.65 : 0.30;
    } else if (sig?.direction === 'bearish') {
      signalScore = sig.confidence === 'high' ? -1.0 : sig.confidence === 'medium' ? -0.65 : -0.30;
    }

    // ── Factor 2: Macro environment (-1..1) — sets the backdrop ────────
    // Raw macro score is ~-5..5; normalise to -1..1
    const macroNorm = Math.max(-1, Math.min(1, macroScore / 3.5));

    // ── Factor 3: Pre-market / intraday momentum (-1..1) ────────────────
    // If a stock is already moving strongly, momentum is confirming.
    // Normalise: reaching half the tier hi-range = score 1.0
    let momentumScore = 0;
    if (q?.changePct != null) {
      momentumScore = Math.max(-1, Math.min(1, q.changePct / (hi * 0.5)));
    }

    // ── Factor 4: RSI technical setup (-1..1) ───────────────────────────
    // Oversold → mean-reversion bounce; overbought → exhaustion/pullback
    let rsiScore = 0, rsiValue = null;
    const chart1M = loadChartFromStorage(inst.id, '1M') || loadChartFromStorage(inst.id, '3M');
    if (chart1M?.closes) {
      const rsi = calcRSI(chart1M.closes);
      if (rsi != null) {
        rsiValue = rsi;
        if      (rsi < 25) rsiScore =  0.70;
        else if (rsi < 35) rsiScore =  0.45;
        else if (rsi < 45) rsiScore =  0.15;
        else if (rsi > 80) rsiScore = -0.70;
        else if (rsi > 70) rsiScore = -0.45;
        else if (rsi > 60) rsiScore = -0.15;
      }
    }

    // ── Factor 5: Trend assessment (SMA structure + momentum streak) ────
    const trend = computeTrend(inst);
    const trendScore = trend?.trendScore ?? 0;

    // ── Weighted combination — 5 factors, tuned weights ─────────────────
    // News signal is the strongest near-term predictor; trend confirms structure
    const combined = signalScore * 0.35 + macroNorm * 0.25 + trendScore * 0.20 + momentumScore * 0.12 + rsiScore * 0.08;

    // ── Predicted % band (scaled by tier volatility) ────────────────────
    const absC   = Math.abs(combined);
    const predLo = Math.round(lo * absC * 10) / 10;
    const predHi = Math.round(hi * absC * 10) / 10;

    // ── Multi-factor confidence ─────────────────────────────────────────
    // Count how many independent factors agree on the same direction
    const votes = [
      signalScore  > 0.25 ? 1 : signalScore  < -0.25 ? -1 : 0,
      macroNorm    > 0.20 ? 1 : macroNorm    < -0.20 ? -1 : 0,
      trendScore   > 0.20 ? 1 : trendScore   < -0.20 ? -1 : 0,
      momentumScore> 0.20 ? 1 : momentumScore< -0.20 ? -1 : 0,
      rsiScore     > 0.10 ? 1 : rsiScore     < -0.10 ? -1 : 0,
    ];
    const agreeBull = votes.filter(v => v ===  1).length;
    const agreeBear = votes.filter(v => v === -1).length;
    const agree     = Math.max(agreeBull, agreeBear);
    const confidence = agree >= 3 ? 'high' : agree === 2 ? 'medium' : 'low';

    const direction = combined >  0.08 ? 'bullish' : combined < -0.08 ? 'bearish' : 'neutral';

    // ── Plain-English reasons ───────────────────────────────────────────
    const reasons = [];
    if (sig?.direction === 'bullish' && sig.newsCount > 0)
      reasons.push({ icon: '▲', text: `${sig.newsCount} bullish news items — ${sig.confidence || 'low'} confidence`, pos: true });
    else if (sig?.direction === 'bearish' && sig.newsCount > 0)
      reasons.push({ icon: '▼', text: `${sig.newsCount} bearish news items — ${sig.confidence || 'low'} confidence`, pos: false });
    if (Math.abs(macroScore) > 0.4)
      reasons.push({ icon: '◉', text: `Macro ${macroScore > 0 ? 'tailwind' : 'headwind'} score ${macroScore >= 0 ? '+' : ''}${macroScore.toFixed(1)}`, pos: macroScore > 0 });
    // Trend signals — surface the most decisive one
    if (trend) {
      const topTrendSig = trend.signals[0];
      if (topTrendSig) reasons.push({ icon: '↗', text: topTrendSig.t, pos: topTrendSig.pos });
      // Surface SMA alignment separately if present
      const alignSig = trend.signals.find(s => s.t.includes('alignment'));
      if (alignSig && alignSig !== topTrendSig) reasons.push({ icon: '⬡', text: alignSig.t, pos: alignSig.pos });
    }
    if (rsiValue != null && rsiValue < 40)
      reasons.push({ icon: '~', text: `RSI ${rsiValue.toFixed(0)} — oversold, mean-reversion setup`, pos: true });
    else if (rsiValue != null && rsiValue > 65)
      reasons.push({ icon: '~', text: `RSI ${rsiValue.toFixed(0)} — overbought, watch for exhaustion`, pos: false });
    if (q?.changePct != null && Math.abs(q.changePct) > 0.5)
      reasons.push({ icon: '→', text: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}% today (${q.changePct > 0 ? 'momentum confirming' : 'lagging peers'})`, pos: q.changePct > 0 });
    const upcomingEarnings = (STATE.earnings || []).find(e => {
      const d = (new Date(e.date + 'T00:00:00') - new Date()) / 86400000;
      return (e.symbol === inst.ticker || e.symbol === inst.finnhub) && d >= 0 && d <= 5;
    });
    if (upcomingEarnings) {
      const dAway = Math.ceil((new Date(upcomingEarnings.date) - new Date()) / 86400000);
      reasons.push({ icon: '⚡', text: `Earnings in ${dAway}d — catalyst risk, amplified move likely`, pos: null });
    }

    return { inst, combined, direction, predLo, predHi, confidence, agree,
             reasons, signalScore, macroScore, trendScore, momentumScore, rsiScore, rsiValue,
             trend, lo, hi };
  });

  predictions.sort((a, b) => b.combined - a.combined);
  return { predictions, macroRegime: macroData.regime, macroRegimeClass: macroData.regimeClass };
}

function renderDayPredictions(predData) {
  const { predictions, macroRegime, macroRegimeClass } = predData;

  const topBull = predictions.filter(p => p.direction === 'bullish' && p.confidence !== 'low').slice(0, 8);
  const topBear = predictions.filter(p => p.direction === 'bearish' && p.confidence !== 'low').slice(0, 3);

  if (!topBull.length && !topBear.length) {
    return `<div class="dp-empty">Not enough signal data yet — prices and news are still loading.</div>`;
  }

  const confClass = { high: 'high', medium: 'med', low: 'low' };
  const confLabel = { high: 'HIGH CONVICTION', medium: 'MEDIUM', low: 'LOW' };

  const mkBar = (predHi, hi, direction) => {
    const fill = Math.min(100, (predHi / hi) * 100);
    const col  = direction === 'bullish' ? 'var(--green)' : 'var(--red)';
    return `<div class="dp-bar-track">
      <div class="dp-bar-fill" style="width:${fill.toFixed(1)}%;background:${col}"></div>
    </div>`;
  };

  const generateConvictionText = p => {
    const { direction, signalScore, macroScore, trendScore, rsiValue, trend } = p;
    const sig   = STATE.signals[p.inst.id];
    const q     = STATE.quotes[p.inst.id];
    const parts = [];

    // ── News signal ──
    if (sig?.newsCount > 0 && Math.abs(signalScore) > 0.15) {
      const catLabels = {
        earnings: 'earnings results', product: 'product/launch news', macro: 'macro conditions',
        partnerships: 'partnership activity', regulatory: 'regulatory news',
        analyst: 'analyst upgrades/downgrades', guidance: 'guidance updates', general: 'recent news flow'
      };
      const catLabel  = catLabels[sig.topCategory] || sig.topCategory || 'recent news flow';
      const sentiment = signalScore > 0 ? 'positive' : 'negative';
      parts.push(`News sentiment is ${sentiment} — ${sig.newsCount} item${sig.newsCount !== 1 ? 's' : ''} (${sig.confidence} confidence) with ${catLabel} as the primary driver.`);
    }

    // ── Trend structure ──
    if (Math.abs(trendScore) > 0.15 && trend) {
      const trendDir = trendScore > 0 ? 'uptrend' : 'downtrend';
      const topSig   = trend.signals?.[0];
      parts.push(topSig
        ? `Price structure shows a ${trendDir}: ${topSig.t.charAt(0).toUpperCase() + topSig.t.slice(1)}.`
        : `Technical structure is in a ${trendDir} (${trend.trendLabel}).`
      );
    }

    // ── Macro ──
    if (Math.abs(macroScore) > 0.3) {
      parts.push(`Macro backdrop is ${macroScore > 0 ? 'supportive' : 'a headwind'} (score ${macroScore >= 0 ? '+' : ''}${macroScore.toFixed(1)}).`);
    }

    // ── RSI ──
    if (rsiValue != null) {
      if      (rsiValue < 35) parts.push(`RSI ${rsiValue.toFixed(0)} — oversold, mean-reversion setup with room to recover.`);
      else if (rsiValue > 70) parts.push(`RSI ${rsiValue.toFixed(0)} — overbought, elevated exhaustion risk near current levels.`);
      else if (direction === 'bullish' && rsiValue >= 45 && rsiValue <= 62)
        parts.push(`RSI ${rsiValue.toFixed(0)} — healthy mid-range, no exhaustion signal.`);
    }

    // ── Intraday momentum ──
    if (q?.changePct != null && Math.abs(q.changePct) > 0.5) {
      parts.push(q.changePct > 0
        ? `Intraday momentum confirms: +${q.changePct.toFixed(2)}% on the session.`
        : `Price is lagging today at ${q.changePct.toFixed(2)}% — consistent with the ${direction} pressure.`
      );
    }

    return parts.join(' ');
  };

  const mkCard = (p, rank) => {
    const { inst, combined, direction, predLo, predHi, confidence, reasons, lo, hi } = p;
    const q       = STATE.quotes[inst.id];
    const priceStr = q?.price != null ? fmtPrice(q.price, inst.currency) : '';
    const dirSign  = direction === 'bullish' ? '▲' : direction === 'bearish' ? '▼' : '◆';
    const dirColor = direction === 'bullish' ? 'var(--green)' : direction === 'bearish' ? 'var(--red)' : 'var(--text-sub)';
    const rangeStr = predHi > 0 ? `${dirSign} ${predLo.toFixed(1)}% – ${predHi.toFixed(1)}%` : `${dirSign} < ${lo}%`;

    const reasonsHtml = reasons.slice(0, 3).map(r => {
      const col = r.pos === true ? 'var(--green)' : r.pos === false ? 'var(--red)' : 'var(--amber)';
      return `<div class="dp-reason"><span class="dp-reason-icon" style="color:${col}">${r.icon}</span><span>${r.text}</span></div>`;
    }).join('');

    const convictionText = generateConvictionText(p);
    const convictionHtml = convictionText
      ? `<div class="dp-conviction">${convictionText}</div>`
      : '';

    const trendBadge = p.trend
      ? `<span class="dp-trend-badge ${p.trend.trendClass}">${p.trend.trendLabel}</span>`
      : `<span class="dp-trend-badge trend-nodata">No history</span>`;

    return `<div class="dp-card conf-${confClass[confidence]}" onclick="selectInstrumentById('${inst.id}')">
      <div class="dp-card-left">
        <div class="dp-rank">${rank}</div>
        <div class="dp-avatar" style="background:${inst.color}18;color:${inst.color};border-color:${inst.color}35">
          ${inst.ticker.slice(0, 2)}
        </div>
        <div class="dp-info">
          <div class="dp-top">
            <span class="dp-ticker">${inst.ticker}</span>
            <span class="dp-name">${inst.name}</span>
            ${priceStr ? `<span class="dp-price">${priceStr}</span>` : ''}
          </div>
          <div class="dp-meta-row">
            <span class="dp-sector-pill">${inst.sector}</span>
            ${trendBadge}
          </div>
        </div>
      </div>
      <div class="dp-card-right">
        <div class="dp-range" style="color:${dirColor}">${rangeStr}</div>
        ${mkBar(predHi, hi, direction)}
        <div class="dp-conf-badge conf-${confClass[confidence]}">${confLabel[confidence]}</div>
        <div class="dp-reasons">${reasonsHtml}</div>
        ${convictionHtml}
      </div>
    </div>`;
  };

  const bullHtml = topBull.length
    ? `<div class="dp-section-label bull">▲ Bullish today — ${topBull.length} picks</div>
       <div class="dp-list">${topBull.map((p, i) => mkCard(p, i + 1)).join('')}</div>`
    : '';

  const bearHtml = topBear.length
    ? `<div class="dp-section-label bear" style="margin-top:10px">▼ Caution — ${topBear.length} instruments showing headwinds</div>
       <div class="dp-list">${topBear.map((p, i) => mkCard(p, i + 1)).join('')}</div>`
    : '';

  return `${bullHtml}${bearHtml}`;
}

// ─── Background chart prefetch for Pre-Market Picks trend badges ─────────
// Instruments with no cached 1M/3M data show "No history". This function
// queues fetches for them so the next render can show real trend badges.
let _trendPrefetchScheduled = false;
function prefetchMissingTrendData() {
  if (_trendPrefetchScheduled) return;
  if (STATE.demoMode) return;

  const missing = WATCHLIST.filter(inst => {
    return !loadChartFromStorage(inst.id, '3M') && !loadChartFromStorage(inst.id, '1M');
  });
  if (!missing.length) return;

  _trendPrefetchScheduled = true;
  let completed = 0;
  const total = missing.length;

  missing.forEach(inst => {
    RequestQueue.add(() =>
      fetchChartData(inst, '1M')
        .then(data => {
          if (data?.closes?.length) {
            cacheChart(inst.id, '1M', data);
          }
        })
        .catch(() => {})
        .finally(() => {
          completed++;
          if (completed === total) {
            _trendPrefetchScheduled = false;
            // Refresh picks panel if still on overview
            if (!STATE.activeId) {
              clearTimeout(_overviewRefreshTimer);
              _overviewRefreshTimer = setTimeout(() => {
                if (!STATE.activeId) renderOverview();
              }, 200);
            }
          }
        })
    );
  });
}

// ─── Overview / Portfolio Dashboard (Feature 2) ───────────────────────
function renderOverview() {
  const panel = $('overview-panel');
  if (!panel) return;

  // Show/hide overview vs detail
  $('instrument-detail').classList.add('hidden');
  $('empty-state').classList.add('hidden');
  panel.classList.remove('hidden');

  // Kick off background chart fetches for instruments missing trend data
  prefetchMissingTrendData();

  // ── Compute predictions once — used by both heatmap and picks section ─
  const predData  = computeDayPredictions();
  const predMap   = {};   // id → prediction object
  predData.predictions.forEach(p => { predMap[p.inst.id] = p; });

  // ── Sector heatmap ─────────────────────────────────────────────────
  const hPeriod = STATE.heatmapPeriod || '1D';
  const isPredicted = hPeriod === 'Predicted';
  // Colour thresholds scale with period so extremes stay meaningful
  const thresholds = { '1D': [1,3], '1W': [2,6], '1M': [5,12], '3M': [8,20], '6M': [12,30], 'Predicted': [1,5] }[hPeriod] || [1,3];

  const heatmapTiles = WATCHLIST.map(inst => {
    let pct, pctStr, opacity = 1;

    if (isPredicted) {
      const pred = predMap[inst.id];
      if (pred && pred.direction !== 'neutral') {
        const sign = pred.direction === 'bullish' ? 1 : -1;
        pct    = sign * pred.predHi;
        pctStr = `~${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
        opacity = pred.confidence === 'high' ? 1.0 : pred.confidence === 'medium' ? 0.72 : 0.45;
      } else {
        pct = null; pctStr = '—';
      }
    } else {
      pct    = getHeatmapPct(inst, hPeriod);
      pctStr = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—';
    }

    const [lo, hi] = thresholds;
    let bg, textColor;
    if (pct == null)     { bg = '#1a1a2e';   textColor = 'var(--text-muted)'; }
    else if (pct > hi)   { bg = '#00d084';   textColor = '#000'; }
    else if (pct > lo)   { bg = '#00d08488'; textColor = '#fff'; }
    else if (pct >= -lo) { bg = '#44446a';   textColor = 'var(--text-sub)'; }
    else if (pct >= -hi) { bg = '#ff3b5c88'; textColor = '#fff'; }
    else                 { bg = '#ff3b5c';   textColor = '#fff'; }

    return `<div class="heatmap-tile ${isPredicted ? 'tile-predicted' : ''}" style="background:${bg};color:${textColor};opacity:${opacity}" onclick="selectInstrumentById('${inst.id}')">
      <div class="heatmap-ticker">${inst.ticker}</div>
      <div class="heatmap-pct">${pctStr}</div>
    </div>`;
  }).join('');

  // Count how many tiles have real data for the loading indicator
  const loadedCount = isPredicted
    ? predData.predictions.filter(p => p.direction !== 'neutral').length
    : hPeriod === '1D'
      ? WATCHLIST.filter(i => STATE.quotes[i.id]?.changePct != null).length
      : WATCHLIST.filter(i => getHeatmapPct(i, hPeriod) != null).length;
  const totalCount  = WATCHLIST.length;
  const loadingNote = !isPredicted && loadedCount < totalCount && hPeriod !== '1D'
    ? `<span class="heatmap-loading-note">Loading ${loadedCount}/${totalCount}…</span>`
    : '';

  const heatmapPeriodTabs = `
    <div class="heatmap-period-tabs">
      ${['1D','1W','1M','3M','6M'].map(p =>
        `<button class="hptab ${hPeriod === p ? 'active' : ''}" onclick="switchHeatmapPeriod('${p}')">${p}</button>`
      ).join('')}
      <button class="hptab hptab-pred ${isPredicted ? 'active' : ''}" onclick="switchHeatmapPeriod('Predicted')" title="Predicted moves based on news signals, macro & RSI">◉ Predicted</button>
      ${loadingNote}
    </div>`;

  // ── Signal summary ─────────────────────────────────────────────────
  let bullCount = 0, bearCount = 0, mixCount = 0;
  WATCHLIST.forEach(inst => {
    const sig = STATE.signals[inst.id];
    if (!sig) return;
    if (sig.direction === 'bullish') bullCount++;
    else if (sig.direction === 'bearish') bearCount++;
    else mixCount++;
  });
  const sigSummaryHtml = `
    <div class="signal-summary-row">
      <div class="sig-sum-pill" style="color:var(--green);border-color:#00d08433;background:#00d08410" onclick="sortList('bullish');switchTab('watchlist')">
        ▲ ${bullCount} Bullish
      </div>
      <div class="sig-sum-pill" style="color:var(--red);border-color:#ff3b5c33;background:#ff3b5c10" onclick="sortList('bearish');switchTab('watchlist')">
        ▼ ${bearCount} Bearish
      </div>
      <div class="sig-sum-pill" style="color:var(--amber);border-color:#f5a62333;background:#f5a62310">
        ◆ ${mixCount} Mixed
      </div>
    </div>`;

  // ── Top 3 movers + top 3 dippers ──────────────────────────────────
  const rankedAll = WATCHLIST
    .filter(inst => STATE.quotes[inst.id]?.changePct != null)
    .sort((a, b) => STATE.quotes[b.id].changePct - STATE.quotes[a.id].changePct);
  const top3up   = rankedAll.slice(0, 3);
  const top3down = rankedAll.slice(-3).reverse();

  function moverRowHtml(inst, label) {
    const q   = STATE.quotes[inst.id];
    const pct = q.changePct;
    const col = pct >= 0 ? 'var(--green)' : 'var(--red)';
    const sig = STATE.signals[inst.id];
    const sigHtml = sig ? `<span class="signal-badge ${sig.direction}" style="font-size:0.6rem;padding:1px 5px">${directionArrow(sig.direction)}</span>` : '';
    return `<div class="mover-row" onclick="selectInstrumentById('${inst.id}')">
      <div class="mover-avatar" style="background:${inst.color}22;border-color:${inst.color}44">
        <span style="color:${inst.color}">${avatarInitials(inst.name)}</span>
      </div>
      <div class="mover-body">
        <div class="mover-name">${inst.ticker} ${sigHtml}</div>
        <div class="mover-sector">${inst.sector}</div>
      </div>
      <div class="mover-pct" style="color:${col}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
    </div>`;
  }

  const moversHtml = rankedAll.length === 0
    ? '<div style="color:var(--text-muted);font-size:0.85rem">No price data yet.</div>'
    : `<div class="movers-grid">
        <div class="movers-col">
          <div class="movers-col-label up">▲ Top Gainers</div>
          ${top3up.map(i => moverRowHtml(i, 'up')).join('')}
        </div>
        <div class="movers-col">
          <div class="movers-col-label down">▼ Top Dippers</div>
          ${top3down.map(i => moverRowHtml(i, 'down')).join('')}
        </div>
      </div>`;

  // ── Holdings delta ─────────────────────────────────────────────────
  const holdingsData = loadHoldings();
  let holdingsDeltaHtml = '';
  if (holdingsData.length > 0) {
    const allInst = [...WATCHLIST, ...INDICATORS];
    let totalValue = 0, totalCost = 0, todayDelta = 0;
    holdingsData.forEach(h => {
      const pl = calcHoldingPL(h);
      if (!pl) return;
      totalValue += pl.currentValue;
      totalCost  += h.shares * h.avgPrice;
      todayDelta += pl.todayPL;
    });
    const totalPLPct   = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
    const totalPLAmt   = totalValue - totalCost;
    const plCol        = totalPLAmt >= 0 ? 'var(--green)' : 'var(--red)';
    const todayCol     = todayDelta >= 0 ? 'var(--green)' : 'var(--red)';

    const periodCols = ['since', '1D', '1W', '1M', '3M'];
    const periodLabels = { since: 'Since Add', '1D': '1D', '1W': '1W', '1M': '1M', '3M': '3M' };

    const rowsHtml = holdingsData.map(h => {
      const inst2 = allInst.find(i => i.id === h.id);
      if (!inst2) return '';
      const q2 = STATE.quotes[h.id];
      if (!q2) return '';
      const pl2 = calcHoldingPL(h);
      const curVal = pl2 ? `$${pl2.currentValue.toFixed(0)}` : '—';

      const cells = periodCols.map(p => {
        const pct = getHoldingPeriodPct(h, p);
        if (pct == null) return `<span class="hdelta-cell hdelta-na">—</span>`;
        const c = pct >= 0 ? 'var(--green)' : 'var(--red)';
        return `<span class="hdelta-cell" style="color:${c}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
      }).join('');

      return `<div class="hdelta-row" onclick="selectInstrumentById('${inst2.id}')">
        <div class="hdelta-ticker" style="color:${inst2.color}">${inst2.ticker}</div>
        <div class="hdelta-val">${curVal}</div>
        <div class="hdelta-cells">${cells}</div>
      </div>`;
    }).join('');

    const headerCells = periodCols.map(p =>
      `<span class="hdelta-cell hdelta-hdr">${periodLabels[p]}</span>`
    ).join('');

    holdingsDeltaHtml = `
      <div>
        <div class="ov-subsection-label">Holdings Performance</div>
        <div class="hdelta-summary">
          <div class="hdelta-summary-item">
            <span class="hdelta-summary-label">Total P&amp;L</span>
            <span class="hdelta-summary-val" style="color:${plCol}">${totalPLAmt >= 0 ? '+' : ''}$${totalPLAmt.toFixed(2)} (${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(1)}%)</span>
          </div>
          <div class="hdelta-summary-item">
            <span class="hdelta-summary-label">Today</span>
            <span class="hdelta-summary-val" style="color:${todayCol}">${todayDelta >= 0 ? '+' : ''}$${todayDelta.toFixed(2)}</span>
          </div>
          <div class="hdelta-summary-item">
            <span class="hdelta-summary-label">Value</span>
            <span class="hdelta-summary-val">$${totalValue.toFixed(2)}</span>
          </div>
        </div>
        <div class="hdelta-table">
          <div class="hdelta-row hdelta-head">
            <div class="hdelta-ticker hdelta-hdr">Ticker</div>
            <div class="hdelta-val hdelta-hdr">Value</div>
            <div class="hdelta-cells">${headerCells}</div>
          </div>
          ${rowsHtml}
        </div>
      </div>`;
  }

  // ── Feature 9: Sector Rotation — build inner content only ──────────
  const { rising, fading } = detectSectorRotation();
  let rotationInnerHtml = '';
  if (rising.length > 0 || fading.length > 0) {
    const risingPills = rising.map(s =>
      `<span class="rotation-pill rising">↑↑ ${s.name} <span class="rotation-count">+${s.fresh.toFixed(0)} signals</span></span>`
    ).join('');
    const fadingPills = fading.map(s =>
      `<span class="rotation-pill fading">↓ ${s.name} <span class="rotation-count">${s.older.toFixed(0)} old signals</span></span>`
    ).join('');
    const rotLabel = rising.length > 0 && fading.length > 0
      ? 'Capital rotation signal detected'
      : rising.length > 0 ? 'Sector acceleration detected' : 'Sector momentum fading';
    rotationInnerHtml = `
      <div class="sector-rotation-row">
        <span class="rotation-label">${rotLabel}</span>
        <div class="rotation-pills">${risingPills}${fadingPills}</div>
      </div>`;
  }

  // ── Feature 12: Risk Concentration — build inner content only ───────
  const conc = calcConcentration();
  let concInnerHtml = '';
  if (conc && conc.overweight.length > 0) {
    concInnerHtml = conc.overweight.map(s => {
      const instruments = loadHoldings()
        .map(h => [...WATCHLIST, ...INDICATORS].find(i => i.id === h.id))
        .filter(i => i && (i.sector || i.type) === s.sector)
        .map(i => i.ticker);
      const trimHint = instruments.length > 1 ? `Consider trimming ${instruments.slice(0, 2).join(' or ')}` : '';
      return `<div class="concentration-warning">
        <span class="conc-icon">⚠</span>
        <div class="conc-body">
          <span class="conc-label">${s.sector} overweight: <strong>${s.pct.toFixed(0)}%</strong> of holdings</span>
          ${trimHint ? `<span class="conc-hint">${trimHint} to bring under 35%</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ── Persist section open/closed state across re-renders ────────────
  if (!window._ovOpen) {
    window._ovOpen = { picks: true, intelligence: false, portfolio: true, events: false };
  }

  // ── Helper: collapsible overview section ─────────────────────────
  function makeOvSection(key, icon, title, subtitle, body) {
    const open = !!window._ovOpen[key];
    return `
      <div class="ov-section" data-ov-key="${key}">
        <div class="ov-section-header" onclick="toggleOvSection('${key}')">
          <div class="ov-section-header-left">
            <span class="ov-section-icon">${icon}</span>
            <span class="ov-section-title">${title}</span>
            ${subtitle ? `<span class="ov-section-subtitle">${subtitle}</span>` : ''}
          </div>
          <span class="ov-section-chevron">${open ? '▾' : '▸'}</span>
        </div>
        <div class="ov-section-body" style="${open ? '' : 'display:none'}">
          ${body}
        </div>
      </div>`;
  }

  // ── Section 1: Pre-Market Picks — starts OPEN ─────────────────────
  const picksInner = renderDayPredictions(predData);
  const picksBody = `
    <div class="dp-picks-inner">
      <div class="dp-picks-note">Weighted signal model · <span class="dp-header-badge ${predData.macroRegimeClass}">${predData.macroRegime}</span></div>
      ${picksInner}
    </div>`;

  // ── Section 2: Market Intelligence — starts CLOSED ────────────────
  const intelligenceBody = `
    <div class="ov-subsection">
      <div class="ov-subsection-title">
        <span>Sector Heatmap</span>
        ${heatmapPeriodTabs}
      </div>
      <div class="heatmap-grid">${heatmapTiles}</div>
    </div>
    <div class="ov-subsection">
      <div class="ov-subsection-label">Signal Summary</div>
      ${sigSummaryHtml}
    </div>
    ${rotationInnerHtml ? `
    <div class="ov-subsection">
      <div class="ov-subsection-label">Sector Pulse</div>
      ${rotationInnerHtml}
    </div>` : ''}
    <div class="ov-subsection">
      <div class="ov-subsection-label">Today's Movers &amp; Dippers</div>
      ${moversHtml}
    </div>`;

  // ── Section 3: My Portfolio — starts OPEN ────────────────────────
  const holdingsBlock    = holdingsDeltaHtml ? `<div class="ov-subsection">${holdingsDeltaHtml}</div>` : '';
  const concBlock        = concInnerHtml ? `
    <div class="ov-subsection">
      <div class="ov-subsection-label">Risk Concentration</div>
      ${concInnerHtml}
    </div>` : '';
  const portfolioBody    = holdingsBlock || concBlock
    ? `${holdingsBlock}${concBlock}`
    : `<div class="ov-empty">No holdings recorded yet — add positions in the Holdings tab.</div>`;

  // ── Section 4: Upcoming Events — starts CLOSED ────────────────────
  const eventsBody = `
    <div class="ov-subsection">
      <div class="ov-subsection-label">Earnings Next 30 Days</div>
      ${renderEarningsCalendar(true)}
    </div>
    <div class="ov-subsection">
      <div class="ov-subsection-label">Macro Events Next 30 Days</div>
      ${renderMacroCalendar(true)}
    </div>`;

  panel.innerHTML = `
    <div class="ov-sections">
      ${makeOvSection('picks',        '◉', 'Pre-Market Picks',    'Signal-based outlook · not financial advice', picksBody)}
      ${makeOvSection('intelligence', '◈', 'Market Intelligence', 'Heatmap · Signals · Rotation · Movers',       intelligenceBody)}
      ${makeOvSection('portfolio',    '▣', 'My Portfolio',        'Holdings P&amp;L · Risk Concentration',       portfolioBody)}
      ${makeOvSection('events',       '⏱', 'Upcoming Events',     'Earnings &amp; Macro · Next 30 Days',         eventsBody)}
    </div>
  `;
}

// ─── Overview section toggle ──────────────────────────────────────────
function toggleOvSection(key) {
  if (!window._ovOpen) window._ovOpen = {};
  window._ovOpen[key] = !window._ovOpen[key];
  const open    = window._ovOpen[key];
  const section = document.querySelector(`.ov-section[data-ov-key="${key}"]`);
  if (!section) return;
  const body    = section.querySelector('.ov-section-body');
  const chevron = section.querySelector('.ov-section-chevron');
  if (body)    body.style.display    = open ? '' : 'none';
  if (chevron) chevron.textContent   = open ? '▾' : '▸';
}

// ─── Holdings (Feature 4) ─────────────────────────────────────────────
function loadHoldings() {
  try { return JSON.parse(localStorage.getItem('my_holdings') || '[]'); } catch(e) { return []; }
}

function saveHoldings(arr) {
  localStorage.setItem('my_holdings', JSON.stringify(arr));
}

function addHolding(id, shares, avgPrice) {
  const holdings = loadHoldings();
  const idx = holdings.findIndex(h => h.id === id);
  // Preserve original addedAt if editing an existing position
  const addedAt = idx >= 0 ? (holdings[idx].addedAt || Date.now()) : Date.now();
  const entry = { id, shares: parseFloat(shares), avgPrice: parseFloat(avgPrice), currency: 'USD', addedAt };
  if (idx >= 0) holdings[idx] = entry;
  else holdings.push(entry);
  saveHoldings(holdings);
}

// Returns % change for a holding over a period using live quotes + cached chart data
function getHoldingPeriodPct(h, period) {
  const q = STATE.quotes[h.id];
  if (!q?.price) return null;
  if (period === 'since') {
    return h.avgPrice > 0 ? ((q.price - h.avgPrice) / h.avgPrice) * 100 : null;
  }
  if (period === '1D') return q.changePct ?? null;
  const cached = STATE.chartData?.[h.id]?.[period];
  if (!cached?.closes?.length) return null;
  const closes = cached.closes.filter(v => v != null);
  if (closes.length < 2) return null;
  return ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
}

function removeHolding(id) {
  const holdings = loadHoldings().filter(h => h.id !== id);
  saveHoldings(holdings);
  renderHoldings();
}

function calcHoldingPL(h) {
  const q = STATE.quotes[h.id];
  if (!q || q.price == null) return null;
  const currentPrice   = q.price;
  const currentValue   = h.shares * currentPrice;
  const costBasis      = h.shares * h.avgPrice;
  const unrealisedPL   = currentValue - costBasis;
  const unrealisedPLPct = costBasis > 0 ? (unrealisedPL / costBasis) * 100 : 0;
  const todayPL        = (q.changePct ?? 0) * h.shares * currentPrice / 100;
  return { currentValue, unrealisedPL, unrealisedPLPct, todayPL, currentPrice };
}

function renderHoldings() {
  const container = $('holdings-list');
  if (!container) return;
  const holdings = loadHoldings();
  const all = [...WATCHLIST, ...INDICATORS];

  // Ticker options for dropdown — grouped by sector so Pharma (and others) are easy to find
  const optGroupOrder = ['Pharma','Semiconductors','Storage','Big Tech','Asia Tech','Space','Space ETF','Commodity','Index','ETF'];
  const optGroups = {};
  WATCHLIST.forEach(i => {
    const grp = i.sector || 'Other';
    (optGroups[grp] = optGroups[grp] || []).push(i);
  });
  INDICATORS.forEach(i => {
    const grp = i.type || 'Other';
    (optGroups[grp] = optGroups[grp] || []).push(i);
  });
  const sortedOptKeys = [...optGroupOrder.filter(k => optGroups[k]), ...Object.keys(optGroups).filter(k => !optGroupOrder.includes(k))];
  const tickerOptions = sortedOptKeys.map(grp => {
    const label = SECTOR_DISPLAY[grp] || grp;
    const opts  = optGroups[grp].map(i => `<option value="${i.id}">${i.ticker} — ${i.name}</option>`).join('');
    return `<optgroup label="${label}">${opts}</optgroup>`;
  }).join('');

  const formHtml = `
    <div class="holdings-form">
      <div style="font-size:0.7rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Add / Edit Position</div>
      <div class="holdings-form-row">
        <select class="holdings-input ticker-in" id="h-ticker-select" style="width:130px">
          <option value="">Select ticker…</option>
          ${tickerOptions}
        </select>
        <input class="holdings-input shares-in" id="h-shares" type="number" placeholder="Shares" min="0" step="any">
        <input class="holdings-input price-in" id="h-avg-price" type="number" placeholder="Avg $" min="0" step="any">
        <button class="holdings-save-btn" onclick="submitHoldingForm()">Save</button>
      </div>
    </div>
  `;

  if (holdings.length === 0) {
    container.innerHTML = formHtml + '<div style="padding:20px 14px;color:var(--text-muted);font-size:0.85rem">No positions yet. Add one above.</div>';
    return;
  }

  const donutHtml = holdings.length > 0 ? `
    <div class="sector-donut-wrap">
      <div style="font-size:0.7rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Portfolio Allocation</div>
      <canvas id="sector-donut" style="max-height:160px"></canvas>
    </div>
  ` : '';

  let totalValue = 0, totalPL = 0, todayTotalPL = 0;

  const rowsHtml = holdings.map(h => {
    const inst = all.find(i => i.id === h.id);
    if (!inst) return '';
    const pl = calcHoldingPL(h);
    const sig = STATE.signals[h.id];
    const q = STATE.quotes[h.id];

    if (pl) {
      totalValue  += pl.currentValue;
      totalPL     += pl.unrealisedPL;
      todayTotalPL += pl.todayPL;
    }

    const plStr = pl ? `${pl.unrealisedPL >= 0 ? '+' : ''}$${pl.unrealisedPL.toFixed(2)} (${pl.unrealisedPLPct >= 0 ? '+' : ''}${pl.unrealisedPLPct.toFixed(1)}%)` : '—';
    const plColor = !pl ? 'var(--text-muted)' : pl.unrealisedPL >= 0 ? 'var(--green)' : 'var(--red)';
    const todayStr = pl ? `${pl.todayPL >= 0 ? '+' : ''}$${pl.todayPL.toFixed(2)} today` : '';
    const curPriceStr = pl ? `$${pl.currentPrice.toFixed(2)}` : '—';
    const avgPriceStr = `$${h.avgPrice.toFixed(2)}`;

    // Dip flag: price down but signal bullish
    const isDip = sig?.direction === 'bullish' && q?.changePct != null && q.changePct < -1;
    const dipFlag = isDip ? '<span class="holding-dip-flag">⚡ Dip in holding</span>' : '';

    const sigBadge = sig ? `<span class="signal-badge ${sig.direction}">${directionArrow(sig.direction)} ${sig.direction}</span>` : '';

    // Feature 8: break-even time
    const bkWeeks = calcBreakeven(h, inst);
    const breakevenHtml = bkWeeks != null
      ? `<span class="breakeven-chip" title="Estimated weeks to recover entry cost at current signal momentum">⏱ Break-even ~${bkWeeks}w</span>`
      : '';

    // 1M / 3M / 6M prediction grid
    let predictionsHtml = '';
    if (sig && pl) {
      const periods   = [
        { key: '1M', label: '1 Month'  },
        { key: '3M', label: '3 Months' },
        { key: '6M', label: '6 Months' },
      ];
      const colsHtml = periods.map(({ key, label }) => {
        const r    = estimateReturnForPeriod(inst, sig, key);
        const sign = r.sign;
        const col  = sign === '−' ? 'var(--red)' : 'var(--green)';
        const dolLo = Math.round(pl.currentValue * r.lo / 100);
        const dolHi = Math.round(pl.currentValue * r.hi / 100);
        return `<div class="pred-col">
          <div class="pred-period">${label}</div>
          <div class="pred-pct" style="color:${col}">${sign}${r.lo}–${r.hi}%</div>
          <div class="pred-dollars" style="color:${col}">${sign}$${dolLo.toLocaleString()}–$${dolHi.toLocaleString()}</div>
        </div>`;
      }).join('');
      const confNote = sig.direction === 'bearish'
        ? '<span class="pred-note pred-warn">Signal is bearish — estimates show downside risk</span>'
        : sig.confidence === 'low'
        ? '<span class="pred-note">Low-confidence signal — treat as indicative only</span>'
        : '';
      predictionsHtml = `
        <div class="holding-predictions">
          <div class="pred-header">Potential earnings <span class="pred-disclaimer">· signal-based estimate · not financial advice</span></div>
          <div class="pred-grid">${colsHtml}</div>
          ${confNote}
        </div>`;
    }

    return `<div class="holding-row">
      <div class="holding-top">
        <div class="card-avatar" style="background:${inst.color}22;border-color:${inst.color}44;width:32px;height:32px;flex-shrink:0;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;border:1px solid">
          <span style="color:${inst.color}">${avatarInitials(inst.name)}</span>
        </div>
        <div class="holding-name">${inst.name} <span style="color:var(--text-sub);font-weight:500;font-size:0.75rem">${inst.ticker}</span></div>
        <div class="holding-pl" style="color:${plColor}">${plStr}</div>
        <button class="holding-remove" onclick="removeHolding('${h.id}')" title="Remove position">✕</button>
      </div>
      <div class="holding-meta">
        <span>${h.shares} shares</span>
        <span>Avg: ${avgPriceStr}</span>
        <span>Now: ${curPriceStr}</span>
        ${todayStr ? `<span style="color:${pl && pl.todayPL >= 0 ? 'var(--green)' : 'var(--red)'}">${todayStr}</span>` : ''}
        ${sigBadge}
        ${dipFlag}
        ${breakevenHtml}
      </div>
      ${predictionsHtml}
    </div>`;
  }).join('');

  const totalPLColor = totalPL >= 0 ? 'var(--green)' : 'var(--red)';

  // Feature 11: Portfolio total projector (1M / 3M / 6M)
  const projPeriods = [
    { key: '1M', label: '1 Month',   months: 1 },
    { key: '3M', label: '3 Months',  months: 3 },
    { key: '6M', label: '6 Months',  months: 6 },
  ];
  const projTotals = projPeriods.map(({ key }) => ({ lo: 0, hi: 0, key }));
  holdings.forEach(h => {
    const inst2 = all.find(i => i.id === h.id);
    const sig2  = STATE.signals[h.id];
    const pl2   = calcHoldingPL(h);
    if (!inst2 || !sig2 || !pl2) return;
    projPeriods.forEach(({ key }, i) => {
      const r = estimateReturnForPeriod(inst2, sig2, key);
      projTotals[i].lo += pl2.currentValue * (1 + r.lo / 100);
      projTotals[i].hi += pl2.currentValue * (1 + r.hi / 100);
    });
  });

  const compoundSection = STATE.showProjection ? `
    <div class="compound-section">
      <div class="compound-header">
        <span>Portfolio projection — total value</span>
        <span class="compound-disclaimer">Signal-based · not guaranteed</span>
      </div>
      <div class="pred-grid pred-grid-3">
        ${projTotals.map(t => `
          <div class="pred-col">
            <div class="pred-period">${projPeriods.find(p => p.key === t.key).label}</div>
            <div class="pred-pct" style="color:var(--green)">+$${Math.round(t.lo - totalValue).toLocaleString()}–$${Math.round(t.hi - totalValue).toLocaleString()}</div>
            <div class="pred-dollars" style="color:var(--text-sub)">→ $${Math.round(t.lo).toLocaleString()}–$${Math.round(t.hi).toLocaleString()}</div>
          </div>`).join('')}
      </div>
    </div>
  ` : '';

  const totalsHtml = `
    <div class="holdings-total">
      <div class="holdings-total-row">
        <span>Portfolio Value</span>
        <span>$${totalValue.toFixed(2)}</span>
      </div>
      <div class="holdings-total-row" style="margin-top:4px">
        <span>Unrealised P&amp;L</span>
        <span style="color:${totalPLColor}">${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}</span>
      </div>
      <div class="holdings-total-sub" style="margin-top:4px">Today: ${todayTotalPL >= 0 ? '+' : ''}$${todayTotalPL.toFixed(2)}</div>
      <button class="project-btn" onclick="STATE.showProjection = !STATE.showProjection; renderHoldings()">
        ${STATE.showProjection ? '▲ Hide Projection' : '📈 Project 6 months'}
      </button>
    </div>
  `;

  container.innerHTML = formHtml + donutHtml + rowsHtml + compoundSection + totalsHtml;
  if (holdings.length > 0) renderSectorDonut(holdings);
}

function submitHoldingForm() {
  const sel = $('h-ticker-select');
  const sharesEl = $('h-shares');
  const priceEl = $('h-avg-price');
  const id = sel ? sel.value : '';
  const shares = parseFloat(sharesEl?.value);
  const avgPrice = parseFloat(priceEl?.value);
  if (!id || isNaN(shares) || shares <= 0 || isNaN(avgPrice) || avgPrice <= 0) {
    return;
  }
  addHolding(id, shares, avgPrice);
  if (sel) sel.value = '';
  if (sharesEl) sharesEl.value = '';
  if (priceEl) priceEl.value = '';
  renderHoldings();
}

// ─── Unified News Feed (Feature 5) ────────────────────────────────────
let _newsFeedFilter = 'all';
let _newsFeedStock  = 'all';

function renderNewsFeed() {
  const container = $('newsfeed-list');
  if (!container) return;

  const all = [...WATCHLIST, ...INDICATORS];

  // Collect all news items and tag with instruments
  const seen = new Set();
  const items = [];
  all.forEach(inst => {
    const news = STATE.news[inst.id] || [];
    news.forEach(item => {
      const key = item.id || item.headline;
      if (seen.has(key)) {
        // Tag existing item with this instrument
        const existing = items.find(i => (i.id || i.headline) === key);
        if (existing && !existing._affected?.some(a => a.id === inst.id)) {
          (existing._affectedIds = existing._affectedIds || []).push(inst.id);
        }
      } else {
        seen.add(key);
        const clone = { ...item, _sourceInst: inst.id, _affectedIds: [inst.id] };
        items.push(clone);
      }
    });
  });

  // Sort by datetime descending
  items.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));

  // Apply filters (sentiment + stock — both must pass)
  const filtered = items.filter(item => {
    const sentOk = _newsFeedFilter === 'all'     ? true
                 : _newsFeedFilter === 'bullish'  ? item._sentiment === 'bullish'
                 : _newsFeedFilter === 'bearish'  ? item._sentiment === 'bearish'
                 : _newsFeedFilter === 'macro'    ? !item._micro
                 : _newsFeedFilter === 'micro'    ? item._micro
                 : true;
    const stockOk = _newsFeedStock === 'all'
      ? true
      : (item._affectedIds || [item._sourceInst]).includes(_newsFeedStock);
    return sentOk && stockOk;
  });

  // Build stock dropdown — only include tickers that actually have news
  const tickersWithNews = [...new Set(items.flatMap(item => item._affectedIds || [item._sourceInst]))]
    .filter(Boolean)
    .map(id => all.find(x => x.id === id))
    .filter(Boolean)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const stockOptions = [
    `<option value="all"${_newsFeedStock === 'all' ? ' selected' : ''}>All stocks</option>`,
    ...tickersWithNews.map(i =>
      `<option value="${i.id}"${_newsFeedStock === i.id ? ' selected' : ''}>${i.ticker} — ${i.name}</option>`
    ),
  ].join('');

  const filterBar = `
    <div class="feed-filter-bar">
      <div class="feed-filter-row">
        ${['all','bullish','bearish','macro','micro'].map(f => `
          <button class="filter-btn ${_newsFeedFilter === f ? 'active' : ''}"
            onclick="_newsFeedFilter='${f}';renderNewsFeed()">${f.charAt(0).toUpperCase() + f.slice(1)}</button>
        `).join('')}
      </div>
      <div class="feed-stock-row">
        <label class="feed-stock-label">Stock</label>
        <select class="feed-stock-select" onchange="_newsFeedStock=this.value;renderNewsFeed()">
          ${stockOptions}
        </select>
      </div>
    </div>`;

  if (filtered.length === 0) {
    container.innerHTML = filterBar + '<div style="padding:20px 14px;color:var(--text-muted);font-size:0.85rem">No news items match this filter.</div>';
    return;
  }

  const itemsHtml = filtered.slice(0, 200).map(item => {
    const sent = item._sentiment || 'mixed';
    const cat = item._category || 'general';
    const micro = item._micro;
    const age = fmtAge(item.datetime);
    const color = sentimentColor(sent);
    const sentIcon = sent === 'bullish' ? '▲' : sent === 'bearish' ? '▼' : '◆';

    // Ticker tags
    const affectedIds = item._affectedIds || [item._sourceInst];
    const tickerTags = affectedIds.map(id => {
      const i = all.find(x => x.id === id);
      if (!i) return '';
      return `<span class="feed-ticker-tag" style="border-color:${i.color}44;color:${i.color}">${i.ticker}</span>`;
    }).join('');

    // Magnitude estimate for source instrument
    const srcInst = all.find(x => x.id === item._sourceInst);
    const magBand = srcInst ? newsItemMagnitude(item, srcInst) : null;

    return `<div class="feed-item">
      <div class="feed-item-top">
        <span class="news-tag ${micro ? 'micro' : 'macro'}">${micro ? 'MICRO' : 'MACRO'}</span>
        <span class="news-tag cat">${categoryLabel(cat).toUpperCase()}</span>
        <span class="news-sent-badge" style="color:${color};border-color:${color}44;font-size:0.68rem">${sentIcon} ${sent}</span>
        ${magBand ? `<span class="news-mag-badge" style="color:${color};border-color:${color}44">${magBand}</span>` : ''}
        <span class="feed-age">${age}</span>
      </div>
      <div class="feed-tickers" style="margin-bottom:5px">${tickerTags}</div>
      <div class="feed-headline">${item.headline}</div>
      <div class="feed-source">${item.source || ''}</div>
    </div>`;
  }).join('');

  container.innerHTML = filterBar + itemsHtml;
}

// ─── Earnings Calendar ────────────────────────────────────────────────
async function loadEarningsCalendar() {
  if (STATE.demoMode) {
    STATE.earnings = DEMO_EARNINGS;
    return;
  }
  if (!API.token) return;
  const from = new Date().toISOString().split('T')[0];
  const to   = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  try {
    const all     = await fetchEarningsCalendar(from, to);
    const symbols = new Set(WATCHLIST.map(i => i.finnhub || i.ticker).filter(Boolean));
    STATE.earnings = all.filter(e => symbols.has(e.symbol)).map(e => ({
      symbol:  e.symbol,
      date:    e.date,
      epsEst:  e.epsEstimate,
      hour:    e.hour || '',
      quarter: e.quarter || '',
    }));
  } catch { STATE.earnings = []; }
}

function renderEarningsCalendar() {
  const today = new Date(); today.setHours(0,0,0,0);
  const items = (STATE.earnings || [])
    .map(e => ({ ...e, _d: new Date(e.date + 'T00:00:00'), _ms: new Date(e.date + 'T00:00:00') - today }))
    .filter(e => e._ms >= 0 && e._ms <= 30 * 86400000)
    .sort((a, b) => a._ms - b._ms);

  if (!items.length) return '';

  const rows = items.map(e => {
    const daysAway = Math.round(e._ms / 86400000);
    const daysLabel = daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `${daysAway}d`;
    const urgency = daysAway <= 2 ? 'var(--red)' : daysAway <= 7 ? 'var(--amber)' : 'var(--text-sub)';
    const inst = WATCHLIST.find(i => i.finnhub === e.symbol || i.ticker === e.symbol);
    const color = inst?.color || 'var(--text-sub)';
    const hourLabel = e.hour === 'amc' ? 'after-close' : e.hour === 'bmo' ? 'pre-market' : '';
    const epsHtml = e.epsEst != null ? `<span class="earn-eps">est. $${Number(e.epsEst).toFixed(2)} EPS</span>` : '';
    return `<div class="earn-row" onclick="selectInstrumentById('${inst?.id || ''}')">
      <span class="earn-ticker" style="color:${color}">${e.symbol}</span>
      <span class="earn-date">${e.date}</span>
      <span class="earn-when" style="color:${urgency}">${daysLabel}</span>
      ${epsHtml}
      ${hourLabel ? `<span class="earn-hour">${hourLabel}</span>` : ''}
    </div>`;
  }).join('');

  return `<div class="earn-list">${rows}</div>`;
}

function renderMacroCalendar() {
  const today = new Date(); today.setHours(0,0,0,0);
  const items = MACRO_EVENTS
    .map(e => ({ ...e, _ms: new Date(e.date + 'T00:00:00') - today }))
    .filter(e => e._ms >= 0 && e._ms <= 30 * 86400000)
    .sort((a, b) => a._ms - b._ms);

  if (!items.length) return '';

  const typeIcon = { fed: '🏦', cpi: '📊', jobs: '👷', pce: '📈' };
  const typeColor = { fed: '#4a9eff', cpi: '#f5a623', jobs: '#00d084', pce: '#8b5cf6' };

  const rows = items.map(e => {
    const daysAway = Math.round(e._ms / 86400000);
    const daysLabel = daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `${daysAway}d`;
    const urgency = daysAway <= 2 ? 'var(--red)' : daysAway <= 7 ? 'var(--amber)' : 'var(--text-sub)';
    const icon  = typeIcon[e.type]  || '📌';
    const color = typeColor[e.type] || 'var(--text-sub)';
    return `<div class="macro-row">
      <span class="macro-icon">${icon}</span>
      <span class="macro-name" style="color:${color}">${e.name}</span>
      <span class="macro-date">${e.date}</span>
      <span class="macro-when" style="color:${urgency}">${daysLabel}</span>
      ${e.impact === 'high' ? '<span class="macro-impact-badge">HIGH IMPACT</span>' : ''}
    </div>`;
  }).join('');

  return `<div class="macro-list">${rows}</div>`;
}

// ─── Market Pulse ─────────────────────────────────────────────────────
function computeMacroPulse() {
  // ── 1. Read day-change % — field is 'changePct' across all sources ────
  const readChangePct = (ids) => {
    for (const id of ids) {
      const q = STATE.quotes[id];
      if (q?.changePct != null) return q.changePct;
      // Stooq sometimes lands as changePercent on older cached paths — cover both
      if (q?.changePercent != null) return q.changePercent;
      // Derive from prevClose if needed
      if (q?.price != null && q?._prevClose != null && q._prevClose > 0)
        return ((q.price - q._prevClose) / q._prevClose) * 100;
    }
    return null;
  };

  const marketChange = readChangePct(['USA500', 'TECH100', 'VUSA', 'VUAG']);
  const oilChange    = readChangePct(['CRUDE']);
  const goldChange   = readChangePct(['XAUUSD', 'SGLN', 'IGLN']);

  // ── 2. Classify macro regime ─────────────────────────────────────────
  const mUp   = marketChange != null && marketChange >  0.25;
  const mDn   = marketChange != null && marketChange < -0.25;
  const oilDn = oilChange    != null && oilChange    < -0.4;
  const oilUp = oilChange    != null && oilChange    >  0.4;
  const gDn   = goldChange   != null && goldChange   < -0.25;
  const gUp   = goldChange   != null && goldChange   >  0.25;

  let regime = 'Neutral', regimeClass = 'neutral';
  if      (mUp && gDn)  { regime = 'Risk-On';   regimeClass = 'risk-on';   }
  else if (mDn && gUp)  { regime = 'Risk-Off';  regimeClass = 'risk-off';  }
  else if (mUp)         { regime = 'Bullish';   regimeClass = 'bullish';   }
  else if (mDn)         { regime = 'Bearish';   regimeClass = 'bearish';   }
  else if (gUp)         { regime = 'Defensive'; regimeClass = 'defensive'; }

  const regimeNotes = [];
  if (oilDn && (mUp || gDn)) regimeNotes.push('Oil dip lowers energy costs — tech & data center margins expand');
  if (oilUp && mUp)          regimeNotes.push('Rising oil pressures margin-sensitive operators');
  if (gDn && mUp)            regimeNotes.push('Gold rotation into equities — risk-on flow confirmed');
  if (gUp && mDn)            regimeNotes.push('Flight to safety — defensives and gold outperforming');
  if (gDn && mUp)            regimeNotes.push('USD likely strengthening — international listings face FX drag');

  // ── 3. Score every WATCHLIST instrument ──────────────────────────────
  // Commodity items (IGLN, XAUUSD) ARE the macro inputs — skip them
  const scoreable = WATCHLIST.filter(i => i.sector !== 'Commodity');

  const scored = scoreable.map(inst => {
    const sens = MACRO_SENSITIVITIES[inst.id] || MACRO_SENSITIVITIES[inst.ticker];
    if (!sens) return null;

    let score = 0;
    const chips = [];   // shown on card
    const detail = [];  // plain-text breakdown for tooltip/expanded view

    // ── Factor A: macro driver contributions ────────────────────────
    if (marketChange != null) {
      const c = sens.market * marketChange;
      score += c;
      // Always show market chip — it's the primary driver
      chips.push({
        label: `S&P ${marketChange >= 0 ? '▲' : '▼'}${Math.abs(marketChange).toFixed(2)}%`,
        pos: c > 0,
      });
      detail.push(`Market beta ${sens.market.toFixed(1)}× × ${marketChange >= 0 ? '+' : ''}${marketChange.toFixed(2)}% = ${c >= 0 ? '+' : ''}${c.toFixed(2)}`);
    }
    if (oilChange != null && Math.abs(oilChange) >= 0.2) {
      const c = sens.oil * oilChange;
      score += c;
      if (Math.abs(c) >= 0.05) {
        chips.push({
          label: `Oil ${oilChange < 0 ? '▼' : '▲'}${Math.abs(oilChange).toFixed(2)}%`,
          pos: c > 0,
        });
        detail.push(`Oil sens ${sens.oil.toFixed(1)}× × ${oilChange >= 0 ? '+' : ''}${oilChange.toFixed(2)}% = ${c >= 0 ? '+' : ''}${c.toFixed(2)}`);
      }
    }
    if (goldChange != null && Math.abs(goldChange) >= 0.15) {
      const c = sens.gold * goldChange;
      score += c;
      if (Math.abs(c) >= 0.04) {
        chips.push({
          label: `Gold ${goldChange < 0 ? '▼' : '▲'}${Math.abs(goldChange).toFixed(2)}%`,
          pos: c > 0,
        });
        detail.push(`Gold sens ${sens.gold.toFixed(1)}× × ${goldChange >= 0 ? '+' : ''}${goldChange.toFixed(2)}% = ${c >= 0 ? '+' : ''}${c.toFixed(2)}`);
      }
    }

    // ── Factor B: USD headwind for internationally-priced instruments ─
    if (sens.intl && gDn && mUp) {
      score -= 0.3;
      chips.push({ label: 'USD drag', pos: false });
      detail.push('International listing: USD strength creates FX headwind (−0.30)');
    }

    // ── Factor C: own-stock momentum ─────────────────────────────────
    // If the stock is already moving strongly in the macro-predicted direction,
    // the move may be partly priced. If it's lagging, it may catch up.
    const q = STATE.quotes[inst.id];
    if (q?.changePct != null) {
      const own = q.changePct;
      const macroImplied = marketChange != null ? sens.market * marketChange : 0;
      const lag = macroImplied - own;  // positive = stock lagging macro signal (catch-up opportunity)
      if (lag > 1.5) {
        score += 0.4;
        chips.push({ label: 'Lagging peers ↑ potential', pos: true });
        detail.push(`Stock only ${own.toFixed(2)}% vs macro-implied ~${macroImplied.toFixed(2)}% — catch-up potential (+0.40)`);
      } else if (lag < -2.0) {
        score -= 0.3;
        chips.push({ label: 'Already repriced', pos: false });
        detail.push(`Stock moved ${own.toFixed(2)}% — may be ahead of macro move (−0.30)`);
      }
    }

    // ── Factor D: news signal weight (stronger influence) ────────────
    const sig = STATE.signals[inst.id];
    if (sig?.direction === 'bullish') {
      const boost = sig.confidence === 'high' ? 0.6 : sig.confidence === 'medium' ? 0.35 : 0.15;
      score += boost;
      chips.push({ label: `▲ Bullish signal`, pos: true });
      detail.push(`News signal: bullish (${sig.confidence} confidence, ${sig.newsCount} items) +${boost.toFixed(2)}`);
    } else if (sig?.direction === 'bearish') {
      const drag = sig.confidence === 'high' ? 0.6 : sig.confidence === 'medium' ? 0.35 : 0.15;
      score -= drag;
      chips.push({ label: `▼ Bearish signal`, pos: false });
      detail.push(`News signal: bearish (${sig.confidence} confidence, ${sig.newsCount} items) −${drag.toFixed(2)}`);
    }

    // ── Factor E: earnings proximity adds volatility uncertainty ──────
    const upcomingEarnings = (STATE.earnings || []).find(e => {
      const daysAway = (new Date(e.date + 'T00:00:00') - new Date()) / 86400000;
      return (e.symbol === inst.ticker || e.symbol === inst.finnhub) && daysAway >= 0 && daysAway <= 7;
    });
    if (upcomingEarnings) {
      // Earnings catalysts amplify both directions — add chip but don't skew score
      chips.push({ label: `⚡ Earnings ${Math.ceil((new Date(upcomingEarnings.date) - new Date()) / 86400000)}d`, pos: null });
      detail.push(`Earnings in ≤7 days — elevated event risk, both sides amplified`);
    }

    const note = MACRO_TRAIT_NOTES[inst.id] || MACRO_TRAIT_NOTES[inst.ticker] || '';
    return { inst, score, chips, detail, note, sig };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  return { marketChange, oilChange, goldChange, regime, regimeClass, regimeNotes, scored };
}

// ─ renderMarketPulseModal removed — Pulse component retired ─────────
function renderMarketPulseModal() {
  // stub — keep symbol in case any old localStorage references call it
}

// ─── App Start ────────────────────────────────────────────────────────
async function startApp() {
  const modeLabel = STATE.demoMode ? 'DEMO' : 'LIVE';
  $('market-status').innerHTML =
    `<span class="status-dot ${STATE.demoMode ? 'demo' : 'live'}"></span><span>${modeLabel} · Loading…</span>`;

  // Render empty sidebar immediately so cards exist for patching
  renderSidebar();

  const all   = [...WATCHLIST, ...INDICATORS];
  const total = all.length * 2; // prices + news
  const tick  = initProgressBar(total);

  // ── Phase 1: prices only — unblocks the UI as fast as possible ──────
  let wsConnected = false;

  await loadAllPrices((id) => {
    patchCard(id);
    tick();
    // Connect WebSocket as soon as prices are seeded (prevClose ready)
    if (!wsConnected && !STATE.demoMode) {
      wsConnected = true;
      connectWebSocket();
    }
  });

  // ── Phase 2: news loads in background — patches badges as each lands ─
  // Not awaited: startup completes now; signals populate progressively.
  loadAllNews((id) => {
    const inst = all.find(i => i.id === id);
    if (inst) {
      const sig  = computeSignal(STATE.news[inst.id] || [], inst);
      const prev = STATE.signals[inst.id];
      STATE.signals[inst.id] = sig;
      if (sig.breakdown?.length > 0) STATE.news[inst.id] = sig.breakdown;
      const changed = !prev || (prev.direction !== sig.direction && sig.newsCount > 0);
      if (changed && sig.direction !== 'mixed' && sig.newsCount >= 2) {
        pushNotification(inst, sig, true);
      }
    }
    patchCard(id);
    tick();
  }).catch(() => {});

  // Final full re-render to sync group labels and active state
  renderSidebar();

  // Re-render detail panel if an instrument is open
  if (STATE.activeId) {
    const inst = all.find(i => i.id === STATE.activeId);
    if (inst) renderDetail(inst);
  }

  $('market-status').innerHTML =
    `<span class="status-dot ${STATE.demoMode ? 'demo' : 'live'}"></span><span>${STATE.demoMode ? 'DEMO' : 'LIVE ●'}</span>`;
  updateWsStatus();

  // Start auto-refresh timers
  clearInterval(STATE.priceTimer);
  clearInterval(STATE.newsTimer);
  clearInterval(STATE.clockTimer);
  STATE.priceTimer = setInterval(refreshPrices, API.REFRESH_PRICES_MS);
  STATE.newsTimer  = setInterval(refreshNews,   API.REFRESH_NEWS_MS);
  STATE.clockTimer = setInterval(updateTimestamp, 1000);

  // Connect Yahoo Finance WebSocket — real-time for indices, ETFs, futures
  // (everything not covered by Finnhub WS: ^NDX, ^GSPC, VUSA.L, IGLN.L, etc.)
  if (!STATE.demoMode) connectYahooWebSocket();

  loadEarningsCalendar();

  // Charts load on-demand when an instrument is clicked.
  // localStorage persistence (cacheChart) means charts fetched once are instant
  // on all subsequent page loads — no background preload needed.
}

// ─── Init ─────────────────────────────────────────────────────────────
function init() {
  initSetupModal();
  switchTab('watchlist');

  // Restore sidebar collapsed state (Feature 1)
  const sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === '1';
  if (sidebarCollapsed) {
    $('sidebar').classList.add('collapsed');
    const btn = $('sidebar-toggle');
    if (btn) btn.textContent = '›';
  }

  // Show overview panel on startup (no instrument selected)
  renderOverview();

  // Handle responsive layout on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      $('sidebar').style.display = '';
      $('detail-panel').style.display = '';
    }
  });

  // Close notif panel on outside click
  document.addEventListener('click', e => {
    const panel = $('notif-panel');
    const bell = $('notif-bell');
    if (!panel.contains(e.target) && !bell.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });

  // Key is baked in — always start in live mode, skip modal
  STATE.demoMode = false;
  $('setup-modal').classList.add('hidden');
  startApp();
}

document.addEventListener('DOMContentLoaded', init);
