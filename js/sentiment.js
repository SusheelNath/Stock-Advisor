'use strict';

// ─── Categorise a single news item ───────────────────────────────────
function categoriseNews(item) {
  if (item._cat) return item._cat;
  const text = ((item.headline || '') + ' ' + (item.summary || '')).toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KW)) {
    if (kws.some(kw => text.includes(kw))) return cat;
  }
  return 'general';
}

// ─── Score a single headline ──────────────────────────────────────────
function scoreHeadline(item) {
  if (item._sent && item._sent !== 'mixed') {
    const map = { bullish: 1, bearish: -1, neutral: 0 };
    const pool = item._sent === 'bullish' ? BULLISH_KW : BEARISH_KW;
    const kws = pool.filter(k =>
      (item.headline + ' ' + (item.summary || '')).toLowerCase().includes(k)
    ).slice(0, 4);
    return { sentiment: item._sent, score: map[item._sent] || 0, matchedKws: kws };
  }

  const text = ((item.headline || '') + ' ' + (item.summary || '')).toLowerCase();
  const matchedBull = BULLISH_KW.filter(kw => text.includes(kw));
  const matchedBear = BEARISH_KW.filter(kw => text.includes(kw));
  const score = matchedBull.length - matchedBear.length;
  const sentiment = score > 1 ? 'bullish' : score < -1 ? 'bearish' : 'mixed';
  const matchedKws = score >= 0 ? matchedBull.slice(0, 4) : matchedBear.slice(0, 4);
  return { sentiment, score, matchedKws };
}

// ─── Get affected instruments from watchlist/indicators ───────────────
function getAffectedInstruments(item) {
  const text = ((item.headline || '') + ' ' + (item.summary || '')).toLowerCase();
  const hitIds = new Set();
  for (const entry of RELEVANCE_MAP) {
    if (entry.kws.some(kw => text.includes(kw))) {
      entry.ids.forEach(id => hitIds.add(id));
    }
  }
  // Look up name/color for each hit
  const all = [...WATCHLIST, ...INDICATORS];
  return [...hitIds]
    .map(id => all.find(i => i.id === id))
    .filter(Boolean);
}

// ─── Generate impact analysis paragraph ──────────────────────────────
function generateImpactAnalysis(item, category, sentiment, affectedInstruments) {
  const text = ((item.headline || '') + ' ' + (item.summary || '')).toLowerCase();
  const dir  = sentiment === 'bullish' ? 'positive' : sentiment === 'bearish' ? 'negative' : 'uncertain';
  const ids  = affectedInstruments.map(i => i.ticker);

  // Geopolitical — Iran / Hormuz / oil supply
  if (text.includes('hormuz') || (text.includes('iran') && (text.includes('oil') || text.includes('pipeline') || text.includes('supply')))) {
    const oilDir = text.includes('bypass') || text.includes('mechanism') || text.includes('ceasefire') || text.includes('diplomatic')
      ? 'reduces the oil supply risk premium, which is bearish for crude prices but reduces safe-haven demand for gold'
      : 'raises oil supply disruption risk, pushing crude prices higher and increasing safe-haven demand for gold';
    return `The Strait of Hormuz carries roughly 20% of global oil trade. This development ${oilDir}. Your CRUDE position is the most directly exposed. Gold ETFs (IGLN, SGLN) and XAUUSD typically move as safe havens when Middle East tensions rise — expect them to move opposite to risk sentiment here.`;
  }

  // Geopolitical — Iran war general
  if (text.includes('iran') && (text.includes('war') || text.includes('military') || text.includes('attack') || text.includes('harder'))) {
    return `Ongoing Iran conflict is a persistent macro risk. Elevated geopolitical uncertainty historically drives gold demand (bullish for XAUUSD, IGLN, SGLN) and oil prices (bullish for CRUDE). It also raises global supply chain risk — semiconductor supply chains running through Asia (TSM, SMSN) face indirect exposure if tensions spill regionally.`;
  }

  // Inflation / rate expectations
  if (text.includes('inflation') || text.includes('cpi')) {
    const inflDir = (text.includes('dips') || text.includes('falls') || text.includes('lower') || text.includes('eases') || text.includes('below'))
      ? 'Falling inflation raises the probability of rate cuts. Lower rates compress discount rates and expand valuations for growth stocks — particularly your NVDA, AMD, META, ARM, and MSFT positions, which carry the highest earnings multiples in this watchlist.'
      : 'Persistent inflation delays rate cuts. Higher-for-longer rates compress growth stock multiples. Your semiconductor and Big Tech positions (NVDA, AMD, META, MSFT) are the most rate-sensitive.';
    return inflDir;
  }

  // Bond market / yields
  if (text.includes('bond') || text.includes('yield') || text.includes('treasury') || text.includes('blinks')) {
    return `Bond market moves are a leading indicator of rate expectations. When yields rise, high-multiple growth stocks reprice lower — your NVDA, AMD, META, and ARM positions carry the highest P/E ratios in this list and are most exposed. Falling yields (dovish pressure) tend to benefit the entire TECH100 and USA500. Monitor the 10-year Treasury yield direction for context on this signal.`;
  }

  // Fed / monetary policy
  if (text.includes('fed') || text.includes('federal reserve') || text.includes('rate cut') || text.includes('rate hike')) {
    return `Monetary policy directly determines the discount rate used to value all growth stocks. A hawkish Fed compresses multiples for high-growth names (NVDA, AMD, META, MSFT, ARM). A dovish pivot expands them. Your space sector stocks (RKLB, LUNR, VOYG) — which have no current earnings — are especially sensitive to rate shifts as their valuations depend entirely on long-term cash flow projections.`;
  }

  // Semiconductor / AI
  if (text.includes('semiconductor') || text.includes('ai infrastructure') || text.includes('chip') || text.includes('gpu')) {
    return `Sector-wide semiconductor and AI sentiment moves the entire group together. NVDA leads AI infrastructure; AMD and ARM are gaining share; INTC is restructuring; TSM manufactures for all of them; MU and SMSN supply memory. A rising tide here lifts your entire semiconductor basket, but single-stock divergence can be large on earnings.`;
  }

  // Oil / crude
  if (text.includes('oil') || text.includes('crude') || text.includes('opec') || text.includes('barrel')) {
    return `Oil price moves have second-order effects on tech: high energy costs raise data center operating expenses (negative for cloud/AI players like NVDA, MSFT, META). Persistent high oil also fuels inflation, delaying Fed rate cuts — compressing growth multiples further. Your CRUDE position is the direct play; RKLB faces higher launch fuel costs at elevated oil prices.`;
  }

  // Russia / Ukraine
  if (text.includes('russia') || text.includes('ukraine')) {
    return `Russia-Ukraine conflict affects European energy security, commodity prices (oil, gas, wheat), and broader risk appetite. Gold (XAUUSD, IGLN, SGLN) tends to benefit as a safe haven. Your European index exposure (GER40) is the most directly impacted. Russian oil revenue affects global energy supply and price dynamics for your CRUDE position.`;
  }

  // Taiwan / China / export controls
  if (text.includes('taiwan') || (text.includes('china') && (text.includes('chip') || text.includes('export') || text.includes('semiconductor')))) {
    return `Taiwan is the epicentre of advanced semiconductor manufacturing — TSMC (TSM) produces chips for NVDA, AMD, ARM, and Apple. Any escalation of China-Taiwan tensions is an existential supply chain risk for your entire semiconductor basket. US export controls on AI chips (H100, MI300X) directly cap NVDA and AMD revenue in China, which currently represents 15–20% of their AI segment sales.`;
  }

  // Stock market rally / selloff
  if (text.includes('rally') || text.includes('stocks rise') || text.includes('stock market')) {
    return `Broad market moves affect your index positions (USA500, TECH100, VUSA, VUAG, VWRP) directly and individual stocks indirectly through sector rotation and risk appetite. Tech-led rallies tend to benefit your semiconductor and Big Tech positions most.`;
  }

  // Space sector
  if (text.includes('nasa') || text.includes('space force') || text.includes('commercial space') || text.includes('satellite')) {
    return `Government space contracts and NASA/Space Force budgets are the primary revenue drivers for RKLB, LUNR, PL, and VOYG. The VanEck Space Innovation ETF (JEDI) gives broad sector exposure. Contract wins are high-magnitude events for small-cap space stocks given their limited revenue diversification.`;
  }

  // Fallback
  const mentioned = ids.length > 0
    ? `Most directly relevant to: ${ids.slice(0, 5).join(', ')}.`
    : 'Monitor for downstream effects on your watchlist.';
  return `General market news with ${dir} sentiment. ${mentioned} Cross-reference with specific stock news for instrument-level signals.`;
}

// ─── Assess whether a news item is micro (company-specific) ──────────
function isMicro(item, instrument) {
  if (typeof item._micro === 'boolean') return item._micro;
  const text = ((item.headline || '') + ' ' + (item.summary || '')).toLowerCase();
  return text.includes(instrument.ticker.toLowerCase()) || text.includes(instrument.name.toLowerCase());
}

// ─── Main signal computation ──────────────────────────────────────────
function computeSignal(newsItems, instrument) {
  if (!newsItems || newsItems.length === 0) {
    return { direction: 'mixed', magnitudeBand: '—', confidence: 'low', newsCount: 0, breakdown: [] };
  }

  const now = Date.now() / 1000;
  const breakdown = newsItems.map(item => {
    const category  = categoriseNews(item);
    const scored    = scoreHeadline(item);
    const micro     = isMicro(item, instrument);
    const ageHours  = (now - item.datetime) / 3600;
    const affected  = getAffectedInstruments(item);
    const impact    = generateImpactAnalysis(item, category, scored.sentiment, affected);

    return {
      ...item,
      _category:   category,
      _sentiment:  scored.sentiment,
      _score:      scored.score,
      _matchedKws: scored.matchedKws,
      _micro:      micro,
      _ageHours:   ageHours,
      _affected:   affected,
      _impact:     impact,
    };
  });

  // Weighted score: micro items and recent items carry more weight
  let weightedScore = 0;
  const catCounts = {};
  breakdown.forEach(item => {
    const recencyWeight = item._ageHours < 6 ? 1.5 : item._ageHours < 24 ? 1.0 : 0.6;
    const microWeight   = item._micro ? 1.3 : 0.8;
    weightedScore += item._score * recencyWeight * microWeight;
    catCounts[item._category] = (catCounts[item._category] || 0) + 1;
  });

  const direction = weightedScore > 1.5 ? 'bullish' : weightedScore < -1.5 ? 'bearish' : 'mixed';
  const topCat    = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';

  const recentCount  = breakdown.filter(i => i._ageHours < 24).length;
  const corroborated = breakdown.filter(i => i._score !== 0).length;
  const confidence   = (recentCount >= 4 && corroborated >= 3) ? 'high'
                     : (recentCount >= 2 || corroborated >= 2) ? 'medium'
                     : 'low';

  return {
    direction,
    magnitudeBand: magnitudeBand(direction, topCat, instrument.tier, confidence),
    confidence,
    newsCount:     breakdown.length,
    topCategory:   topCat,
    weightedScore,
    breakdown:     breakdown.sort((a, b) => b.datetime - a.datetime),
  };
}

// ─── Magnitude band ───────────────────────────────────────────────────
function magnitudeBand(direction, topCat, tier, confidence) {
  if (direction === 'mixed') return '0–1%';
  const base      = TIERS[tier] ? TIERS[tier].range : [1, 5];
  const mult      = CATEGORY_MULTIPLIERS[topCat] || 0.5;
  const confDamp  = confidence === 'high' ? 1.0 : confidence === 'medium' ? 0.75 : 0.5;
  const lo        = Math.round(base[0] * mult * confDamp * 10) / 10;
  const hi        = Math.round(base[1] * mult * confDamp * 10) / 10;
  const sign      = direction === 'bullish' ? '+' : '−';
  return `${sign}${lo}–${hi}%`;
}
