// workers/api-gateway.js
// Deploy to Cloudflare Workers
// Set these secrets in Cloudflare dashboard:
//   ALLOWED_ORIGIN = https://yourusername.github.io
//   CLAUDE_API_KEY = sk-ant-...  (added in Phase 3)

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';

    // CORS check — allow localhost for dev
    if (allowed !== '*' && origin !== allowed && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route requests
      if (path === '/api/market-data' && request.method === 'POST') {
        const body = await request.json();
        const data = await fetchMarketData(body.tickers || [], body.fields || ['quote']);
        return corsResponse({ data }, 200, env);
      }

      if (path === '/api/macro' && request.method === 'POST') {
        const data = await fetchMacroData();
        return corsResponse(data, 200, env);
      }

      if (path === '/api/health' && request.method === 'GET') {
        return corsResponse({ status: 'ok', timestamp: Date.now() }, 200, env);
      }

      // Phase 3: Claude API proxy (add after Phase 1 complete)
      // if (path === '/api/agent' && request.method === 'POST') { ... }

      return corsResponse({ error: 'Not found' }, 404, env);

    } catch (err) {
      console.error('Worker error:', err);
      return corsResponse({ error: err.message }, 500, env);
    }
  }
};

// ============================================================
// MARKET DATA — Yahoo Finance (unofficial API)
// ============================================================

async function fetchMarketData(tickers, fields) {
  if (!tickers.length) return {};

  const results = {};
  const chunks = chunkArray(tickers, 10); // Process in batches

  for (const chunk of chunks) {
    const promises = chunk.map(ticker => fetchSingleQuote(ticker, fields));
    const settled  = await Promise.allSettled(promises);

    chunk.forEach((ticker, i) => {
      if (settled[i].status === 'fulfilled') {
        results[ticker] = settled[i].value;
      } else {
        console.warn(`Failed to fetch ${ticker}:`, settled[i].reason?.message);
        results[ticker] = null;
      }
    });

    // Rate limit: small delay between batches
    if (chunks.length > 1) await sleep(200);
  }

  return results;
}

async function fetchSingleQuote(ticker, fields = ['quote']) {
  // Yahoo Finance v8 quote endpoint (unofficial but widely used)
  const encodedTicker = encodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=1d&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Accept': 'application/json',
    }
  });

  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${ticker}`);

  const meta    = result.meta || {};
  const quote   = result.indicators?.quote?.[0] || {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const timestamps = result.timestamp || [];

  const currentPrice = meta.regularMarketPrice || 0;
  const prevClose    = meta.previousClose || meta.chartPreviousClose || currentPrice;
  const change       = currentPrice - prevClose;
  const changePct    = prevClose ? (change / prevClose) * 100 : 0;

  const data = {
    ticker,
    symbol:                   meta.symbol,
    shortName:                meta.shortName || ticker,
    regularMarketPrice:       currentPrice,
    regularMarketChange:      change,
    regularMarketChangePercent: changePct,
    regularMarketVolume:      meta.regularMarketVolume || 0,
    regularMarketOpen:        meta.regularMarketOpen || 0,
    regularMarketDayHigh:     meta.regularMarketDayHigh || 0,
    regularMarketDayLow:      meta.regularMarketDayLow || 0,
    fiftyTwoWeekHigh:         meta.fiftyTwoWeekHigh || 0,
    fiftyTwoWeekLow:          meta.fiftyTwoWeekLow  || 0,
    marketCap:                meta.marketCap || 0,
    timestamp:                Date.now(),
    price:                    currentPrice,
    change,
    changePct,
  };

  // Include OHLCV history if requested
  if (fields.includes('history') && timestamps.length) {
    data.history = timestamps.map((ts, i) => ({
      date:   new Date(ts * 1000).toISOString().split('T')[0],
      open:   quote.open?.[i],
      high:   quote.high?.[i],
      low:    quote.low?.[i],
      close:  quote.close?.[i],
      volume: quote.volume?.[i],
      adjClose: adjClose[i],
    })).filter(d => d.close != null);
  }

  return data;
}

// Fetch historical OHLCV for a single ticker (for indicators/backtesting)
async function fetchHistory(ticker, range = '2y', interval = '1d') {
  const encodedTicker = encodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=${interval}&range=${range}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' }
  });

  if (!res.ok) throw new Error(`Yahoo history error ${res.status} for ${ticker}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No history for ${ticker}`);

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];

  return timestamps.map((ts, i) => ({
    date:     new Date(ts * 1000).toISOString().split('T')[0],
    open:     quote.open?.[i],
    high:     quote.high?.[i],
    low:      quote.low?.[i],
    close:    quote.close?.[i],
    volume:   quote.volume?.[i],
    adjClose: adjClose[i],
  })).filter(d => d.close != null);
}

// ============================================================
// MACRO DATA — FRED API (free, no key required for public series)
// ============================================================

async function fetchMacroData() {
  // Fetch multiple FRED series and Yahoo Finance data in parallel
  const [
    dgs10,    // 10-year Treasury
    dgs2,     // 2-year Treasury
    dgs1mo,   // Fed Funds effective proxy
    cpi,      // CPI
    unrate,   // Unemployment
    indexData // VIX + market indices
  ] = await Promise.allSettled([
    fetchFRED('DGS10'),
    fetchFRED('DGS2'),
    fetchFRED('FEDFUNDS'),
    fetchFRED('CPIAUCSL'),
    fetchFRED('UNRATE'),
    fetchMarketData(['^VIX', 'SPY', 'QQQ', 'IWM'], ['quote']),
  ]);

  const indicators = {};

  if (dgs10.status === 'fulfilled')  indicators.yield10       = dgs10.value;
  if (dgs2.status  === 'fulfilled')  indicators.yield2        = dgs2.value;
  if (dgs1mo.status === 'fulfilled') indicators.fedFunds      = dgs1mo.value;
  if (cpi.status   === 'fulfilled')  indicators.cpi           = cpi.value;
  if (unrate.status === 'fulfilled') indicators.unemployment  = unrate.value;

  const mktData = indexData.status === 'fulfilled' ? indexData.value : {};
  if (mktData['^VIX']) indicators.vix = mktData['^VIX'].regularMarketPrice;

  // Calculate macro scores
  const scores = calculateMacroScores(indicators, mktData);
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const regime = classifyRegime(totalScore, scores);

  // Generate notes
  const notes = generateMacroNotes(regime, totalScore, indicators, scores);

  return {
    regime,
    totalScore,
    scores,
    indicators,
    notes,
    timestamp: Date.now()
  };
}

async function fetchFRED(seriesId) {
  // FRED public data API — no key required for observations endpoint
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;

  const res = await fetch(url, {
    headers: { 'Accept': 'text/csv' }
  });

  if (!res.ok) throw new Error(`FRED error ${res.status} for ${seriesId}`);

  const text = await res.text();
  const lines = text.trim().split('\n').filter(l => !l.startsWith('DATE'));

  // Get the most recent non-empty value
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].split(',');
    const val = parseFloat(parts[1]);
    if (!isNaN(val)) return val;
  }

  throw new Error(`No valid data for ${seriesId}`);
}

function calculateMacroScores(indicators, mktData) {
  const scores = {};

  // 1. MARKET BREADTH (0-10)
  // Proxy: Are major indices all trending up?
  const spyChg = mktData?.['SPY']?.regularMarketChangePercent || 0;
  const qqqChg = mktData?.['QQQ']?.regularMarketChangePercent || 0;
  const iwmChg = mktData?.['IWM']?.regularMarketChangePercent || 0;
  const avgChg = (spyChg + qqqChg + iwmChg) / 3;

  if (avgChg >= 1.0) scores.breadth = 9;
  else if (avgChg >= 0.3) scores.breadth = 7;
  else if (avgChg >= 0)   scores.breadth = 6;
  else if (avgChg >= -0.5) scores.breadth = 4;
  else scores.breadth = 2;

  // 2. TREND ENVIRONMENT (0-10)
  // Use SPY daily change as simple proxy
  if (spyChg >= 1.5) scores.trend = 9;
  else if (spyChg >= 0.5) scores.trend = 7;
  else if (spyChg >= 0) scores.trend = 6;
  else if (spyChg >= -1) scores.trend = 4;
  else scores.trend = 2;

  // 3. VOLATILITY (0-10) — lower VIX = higher score
  const vix = indicators.vix || 20;
  if (vix < 13) scores.volatility = 10;
  else if (vix < 15) scores.volatility = 9;
  else if (vix < 18) scores.volatility = 8;
  else if (vix < 20) scores.volatility = 7;
  else if (vix < 25) scores.volatility = 5;
  else if (vix < 30) scores.volatility = 3;
  else scores.volatility = 1;

  // 4. LIQUIDITY (0-10) — yield curve + rate environment
  const yieldSpread = indicators.yield10 && indicators.yield2
    ? indicators.yield10 - indicators.yield2
    : 0;

  if (yieldSpread >= 0.5) scores.liquidity = 9;
  else if (yieldSpread >= 0) scores.liquidity = 7;
  else if (yieldSpread >= -0.25) scores.liquidity = 5;
  else if (yieldSpread >= -0.5) scores.liquidity = 4;
  else scores.liquidity = 2;

  // 5. ECONOMIC (0-10) — CPI + unemployment combo
  const cpi   = indicators.cpi   || 3;
  const unrate = indicators.unemployment || 4;

  let ecoScore = 5;
  if (cpi < 2.5) ecoScore += 2;
  else if (cpi < 3.0) ecoScore += 1;
  else if (cpi > 4.0) ecoScore -= 1;
  else if (cpi > 5.0) ecoScore -= 2;

  if (unrate < 4.0) ecoScore += 2;
  else if (unrate < 5.0) ecoScore += 1;
  else if (unrate > 6.0) ecoScore -= 2;

  scores.economic = Math.max(0, Math.min(10, ecoScore));

  return scores;
}

function classifyRegime(totalScore, scores) {
  if (totalScore >= 40) return 'Risk-On';
  if (totalScore >= 25) return 'Neutral';
  return 'Risk-Off';
}

function generateMacroNotes(regime, totalScore, indicators, scores) {
  const vix   = indicators.vix   ? indicators.vix.toFixed(1) : 'N/A';
  const yield10 = indicators.yield10 ? `${indicators.yield10.toFixed(2)}%` : 'N/A';
  const yield2  = indicators.yield2  ? `${indicators.yield2.toFixed(2)}%`  : 'N/A';
  const cpi   = indicators.cpi   ? `${indicators.cpi.toFixed(1)}%` : 'N/A';
  const unrate = indicators.unemployment ? `${indicators.unemployment.toFixed(1)}%` : 'N/A';
  const spread = indicators.yield10 && indicators.yield2
    ? (indicators.yield10 - indicators.yield2).toFixed(2)
    : 'N/A';

  const regimeNote = {
    'Risk-On':  'Market conditions are broadly supportive. Normal position sizing permitted.',
    'Neutral':  'Mixed signals across macro indicators. Favor higher-quality setups.',
    'Risk-Off': 'Caution warranted. Reduce exposure. Raise score thresholds to 48+.'
  }[regime];

  return `Macro Score: ${totalScore}/50. Regime: ${regime}. ${regimeNote} ` +
    `VIX at ${vix}. 10-Yr Yield: ${yield10}. 2-Yr Yield: ${yield2}. ` +
    `Yield Spread: ${spread} (${indicators.yield10 && indicators.yield2 && (indicators.yield10 - indicators.yield2) < 0 ? 'inverted curve' : 'normal curve'}). ` +
    `CPI: ${cpi}. Unemployment: ${unrate}.`;
}

// ============================================================
// HELPERS
// ============================================================

function corsResponse(body, status, env) {
  const origin = env?.ALLOWED_ORIGIN || '*';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  return new Response(
    body != null ? JSON.stringify(body) : null,
    { status, headers }
  );
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
