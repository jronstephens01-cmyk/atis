// workers/api-gateway.js — ATIS Cloudflare Worker

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
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

      // Test endpoint — GET /api/test-options/MU
      if (path.startsWith('/api/test-options/') && request.method === 'GET') {
        const ticker = path.split('/').pop();
        const data   = await fetchOptionsChain(ticker);
        return corsResponse(data, 200, env);
      }

      if (path === '/api/agent' && request.method === 'POST') {
        if (!env.CLAUDE_API_KEY) {
          return corsResponse({ error: 'Claude API key not configured.' }, 500, env);
        }
        const body   = await request.json();
        const result = await callClaude(body.systemPrompt, body.context, env.CLAUDE_API_KEY);
        return corsResponse(result, 200, env);
      }

      if (path === '/api/market-scan' && request.method === 'POST') {
        const body = await request.json();
        const data = await fetchAffordableMarketOptions(body.maxCost || 500, env);
        return corsResponse(data, 200, env);
      }

      if (path === '/api/options-chain' && request.method === 'POST') {
        const body = await request.json();
        const data = await fetchOptionsChain(body.ticker, env);
        return corsResponse(data, 200, env);
      }

      // Test endpoint — GET /api/test-options/AAPL
      if (path.startsWith('/api/test-options/') && request.method === 'GET') {
        const ticker = path.split('/').pop();
        const data   = await fetchOptionsChain(ticker, env);
        return corsResponse(data, 200, env);
      }

      if (path === '/api/robinhood/portfolio' && request.method === 'POST') {
        return corsResponse({ error: 'Use manual entry for now.' }, 200, env);
      }

      return corsResponse({ error: 'Not found' }, 404, env);

    } catch (err) {
      console.error('Worker error:', err);
      return corsResponse({ error: err.message }, 500, env);
    }
  }
};

// ============================================================
// CORS RESPONSE
// ============================================================
function corsResponse(body, status, env) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  return new Response(
    body != null ? JSON.stringify(body) : null,
    { status, headers }
  );
}

// ============================================================
// HELPERS
// ============================================================
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// MARKET DATA — Yahoo Finance
// ============================================================
async function fetchMarketData(tickers, fields) {
  if (!tickers.length) return {};
  const results = {};
  const chunks  = chunkArray(tickers, 10);
  for (const chunk of chunks) {
    const promises = chunk.map(ticker => fetchSingleQuote(ticker, fields));
    const settled  = await Promise.allSettled(promises);
    chunk.forEach((ticker, i) => {
      results[ticker] = settled[i].status === 'fulfilled' ? settled[i].value : null;
    });
    if (chunks.length > 1) await sleep(200);
  }
  return results;
}

async function fetchSingleQuote(ticker, fields = ['quote']) {
  const encodedTicker = encodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`);
  const json   = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${ticker}`);

  const meta       = result.meta || {};
  const quote      = result.indicators?.quote?.[0] || {};
  const adjClose   = result.indicators?.adjclose?.[0]?.adjclose || [];
  const timestamps = result.timestamp || [];

  const currentPrice = meta.regularMarketPrice || 0;
  const prevClose    = meta.previousClose || meta.chartPreviousClose || currentPrice;
  const change       = currentPrice - prevClose;
  const changePct    = prevClose ? (change / prevClose) * 100 : 0;

  const data = {
    ticker,
    symbol:                     meta.symbol,
    shortName:                  meta.shortName || ticker,
    regularMarketPrice:         currentPrice,
    regularMarketChange:        change,
    regularMarketChangePercent: changePct,
    regularMarketVolume:        meta.regularMarketVolume || 0,
    regularMarketOpen:          meta.regularMarketOpen   || 0,
    regularMarketDayHigh:       meta.regularMarketDayHigh || 0,
    regularMarketDayLow:        meta.regularMarketDayLow  || 0,
    fiftyTwoWeekHigh:           meta.fiftyTwoWeekHigh || 0,
    fiftyTwoWeekLow:            meta.fiftyTwoWeekLow  || 0,
    marketCap:                  meta.marketCap || 0,
    timestamp:                  Date.now(),
    price:                      currentPrice,
    change,
    changePct,
  };

  if (fields.includes('history') && timestamps.length) {
    data.history = timestamps.map((ts, i) => ({
      date:     new Date(ts * 1000).toISOString().split('T')[0],
      open:     quote.open?.[i],
      high:     quote.high?.[i],
      low:      quote.low?.[i],
      close:    quote.close?.[i],
      volume:   quote.volume?.[i],
      adjClose: adjClose[i],
    })).filter(d => d.close != null);
  }
  return data;
}

async function fetchHistory(ticker, range = '2y', interval = '1d') {
  const encodedTicker = encodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Yahoo history error ${res.status} for ${ticker}`);
  const json   = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No history for ${ticker}`);
  const timestamps = result.timestamp || [];
  const quote      = result.indicators?.quote?.[0] || {};
  const adjClose   = result.indicators?.adjclose?.[0]?.adjclose || [];
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
// MACRO DATA — FRED API
// ============================================================
async function fetchMacroData() {
  const [dgs10, dgs2, dgs1mo, cpi, unrate, indexData] = await Promise.allSettled([
    fetchFRED('DGS10'),
    fetchFRED('DGS2'),
    fetchFRED('FEDFUNDS'),
    fetchFRED('CPIAUCSL'),
    fetchFRED('UNRATE'),
    fetchMarketData(['^VIX', 'SPY', 'QQQ', 'IWM'], ['quote']),
  ]);

  const indicators = {};
  if (dgs10.status  === 'fulfilled') indicators.yield10      = dgs10.value;
  if (dgs2.status   === 'fulfilled') indicators.yield2       = dgs2.value;
  if (dgs1mo.status === 'fulfilled') indicators.fedFunds     = dgs1mo.value;
  if (cpi.status    === 'fulfilled') indicators.cpi          = cpi.value;
  if (unrate.status === 'fulfilled') indicators.unemployment = unrate.value;

  const mktData = indexData.status === 'fulfilled' ? indexData.value : {};
  if (mktData['^VIX']) indicators.vix = mktData['^VIX'].regularMarketPrice;

  const scores     = calculateMacroScores(indicators, mktData);
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const regime     = classifyRegime(totalScore);
  const notes      = generateMacroNotes(regime, totalScore, indicators);

  return { regime, totalScore, scores, indicators, notes, timestamp: Date.now() };
}

async function fetchFRED(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const res = await fetch(url, { headers: { 'Accept': 'text/csv' } });
  if (!res.ok) throw new Error(`FRED error ${res.status} for ${seriesId}`);
  const text  = await res.text();
  const lines = text.trim().split('\n').filter(l => !l.startsWith('DATE'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].split(',');
    const val   = parseFloat(parts[1]);
    if (!isNaN(val)) return val;
  }
  throw new Error(`No valid data for ${seriesId}`);
}

function calculateMacroScores(indicators, mktData) {
  const scores  = {};
  const spyChg  = mktData?.['SPY']?.regularMarketChangePercent || 0;
  const qqqChg  = mktData?.['QQQ']?.regularMarketChangePercent || 0;
  const iwmChg  = mktData?.['IWM']?.regularMarketChangePercent || 0;
  const avgChg  = (spyChg + qqqChg + iwmChg) / 3;

  scores.breadth = avgChg >= 1.0 ? 9 : avgChg >= 0.3 ? 7 : avgChg >= 0 ? 6 : avgChg >= -0.5 ? 4 : 2;
  scores.trend   = spyChg >= 1.5 ? 9 : spyChg >= 0.5 ? 7 : spyChg >= 0 ? 6 : spyChg >= -1 ? 4 : 2;

  const vix = indicators.vix || 20;
  scores.volatility = vix < 13 ? 10 : vix < 15 ? 9 : vix < 18 ? 8 : vix < 20 ? 7 : vix < 25 ? 5 : vix < 30 ? 3 : 1;

  const yieldSpread = indicators.yield10 && indicators.yield2 ? indicators.yield10 - indicators.yield2 : 0;
  scores.liquidity  = yieldSpread >= 0.5 ? 9 : yieldSpread >= 0 ? 7 : yieldSpread >= -0.25 ? 5 : yieldSpread >= -0.5 ? 4 : 2;

  const cpi    = indicators.cpi    || 3;
  const unrate = indicators.unemployment || 4;
  let ecoScore = 5;
  if (cpi < 2.5)    ecoScore += 2;
  else if (cpi < 3) ecoScore += 1;
  else if (cpi > 4) ecoScore -= 1;
  else if (cpi > 5) ecoScore -= 2;
  if (unrate < 4)   ecoScore += 2;
  else if (unrate < 5) ecoScore += 1;
  else if (unrate > 6) ecoScore -= 2;
  scores.economic = Math.max(0, Math.min(10, ecoScore));

  return scores;
}

function classifyRegime(totalScore) {
  if (totalScore >= 40) return 'Risk-On';
  if (totalScore >= 25) return 'Neutral';
  return 'Risk-Off';
}

function generateMacroNotes(regime, totalScore, indicators) {
  const vix     = indicators.vix      ? indicators.vix.toFixed(1)          : 'N/A';
  const yield10 = indicators.yield10  ? `${indicators.yield10.toFixed(2)}%` : 'N/A';
  const yield2  = indicators.yield2   ? `${indicators.yield2.toFixed(2)}%`  : 'N/A';
  const cpi     = indicators.cpi      ? `${indicators.cpi.toFixed(1)}%`     : 'N/A';
  const unrate  = indicators.unemployment ? `${indicators.unemployment.toFixed(1)}%` : 'N/A';
  const spread  = indicators.yield10 && indicators.yield2
    ? (indicators.yield10 - indicators.yield2).toFixed(2) : 'N/A';
  const regimeNote = {
    'Risk-On':  'Normal position sizing permitted.',
    'Neutral':  'Favor higher-quality setups.',
    'Risk-Off': 'Reduce exposure. Raise score thresholds to 48+.'
  }[regime];
  return `Macro Score: ${totalScore}/50. Regime: ${regime}. ${regimeNote} VIX: ${vix}. 10-Yr: ${yield10}. 2-Yr: ${yield2}. Spread: ${spread}. CPI: ${cpi}. Unemployment: ${unrate}.`;
}

// ============================================================
// CLAUDE API — Agent Proxy
// ============================================================
async function callClaude(systemPrompt, context, apiKey) {
  const userMessage = `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nRespond ONLY in valid JSON as specified in your instructions.`;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data        = await response.json();
  const inputTokens = data.usage?.input_tokens  || 0;
  const outputTokens= data.usage?.output_tokens || 0;
  const rawText     = data.content?.filter(b => b.type === 'text')?.map(b => b.text)?.join('') || '';
  const cleaned     = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let output;
  try {
    output = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) output = JSON.parse(match[0]);
    else throw new Error(`Agent returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  return { output, inputTokens, outputTokens };
}

// ============================================================
// MARKET SCAN — Find affordable options across entire market
// ============================================================
async function fetchAffordableMarketOptions(maxCostPerContract, env) {
  const apiKey  = env?.TRADIER_API_KEY;
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' };

  // Curated universe of liquid, optionable stocks across all price ranges
  // Organized by typical option cost (premium * 100)
  const universe = [
    // Nano tier — stocks $5-$30 — options typically $20-150/contract
    'SOFI','PLTR','F','BAC','SNAP','RIVN','LCID','NIO','FFIE','AAL','CCL','SPCE',
    // Micro tier — stocks $30-$80 — options typically $50-300/contract
    'XLF','XLE','XLK','HOOD','GRAB','UBER','LYFT','VALE','GOLD','WBA','INTC',
    // Standard tier — stocks $80-$200 — options typically $100-600/contract
    'AMD','META','PYPL','NFLX','DIS','BABA','SHOP','SQ','ROKU','TWLO','COIN',
    // Growth tier — strong momentum names
    'AAPL','MSFT','GOOGL','AMZN','TSLA','JPM','V','MA','WMT','JNJ'
  ];

  // Fetch quotes for all universe stocks
  const symbols = universe.join(',');
  const quoteRes = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${symbols}`,
    { headers }
  );

  if (!quoteRes.ok) throw new Error(`Market scan quote error ${quoteRes.status}`);
  const quoteJson = await quoteRes.json();
  const quotes    = Array.isArray(quoteJson?.quotes?.quote)
    ? quoteJson.quotes.quote
    : [quoteJson?.quotes?.quote].filter(Boolean);

  // Filter to stocks with good volume and movement
  const candidates = quotes
    .filter(q => q && q.last > 0 && q.volume > 500000)
    .map(q => ({
      ticker:        q.symbol,
      price:         q.last,
      change:        q.change,
      changePct:     q.change_percentage,
      volume:        q.volume,
      absChangePct:  Math.abs(q.change_percentage || 0),
    }))
    .sort((a, b) => b.absChangePct - a.absChangePct) // Sort by biggest movers
    .slice(0, 20); // Top 20 movers

  // For the top movers, check if they have affordable options
  const affordable = [];
  for (const c of candidates.slice(0, 10)) {
    try {
      // Get nearest expiry options from Tradier
      const expRes = await fetch(
        `https://api.tradier.com/v1/markets/options/expirations?symbol=${c.ticker}`,
        { headers }
      );
      if (!expRes.ok) continue;
      const expJson  = await expRes.json();
      const expiries = (expJson?.expirations?.date || []).filter(d => new Date(d) > new Date());
      if (!expiries.length) continue;

      // Use ~30 DTE expiry
      const target30  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const bestExpiry = expiries.reduce((best, d) =>
        Math.abs(new Date(d) - target30) < Math.abs(new Date(best) - target30) ? d : best
      );

      const chainRes = await fetch(
        `https://api.tradier.com/v1/markets/options/chains?symbol=${c.ticker}&expiration=${bestExpiry}&greeks=false`,
        { headers }
      );
      if (!chainRes.ok) continue;
      const chainJson = await chainRes.json();
      const options   = chainJson?.options?.option || [];

      // Find cheapest OTM call with real volume
      const cheapCalls = options
        .filter(o => o.option_type === 'call'
          && o.strike > c.price
          && o.strike <= c.price * 1.20
          && (o.ask || 0) > 0
          && (o.volume || 0) > 0)
        .map(o => ({
          strike: o.strike,
          expiry: o.expiration_date,
          bid:    o.bid   || 0,
          ask:    o.ask   || 0,
          mark:   o.mid_price || +((o.bid + o.ask) / 2).toFixed(2),
          volume: o.volume || 0,
          cost:   Math.round((o.mid_price || ((o.bid + o.ask) / 2)) * 100)
        }))
        .sort((a, b) => a.cost - b.cost);

      if (!cheapCalls.length) continue;

      const cheapest = cheapCalls[0];

      // Include ALL stocks — let the client-side budget filter decide what's shown
      affordable.push({
        ...c,
        bestCall:      cheapest,
        expiry:        bestExpiry,
        cheapestCost:  cheapest.cost,
        allCalls:      cheapCalls.slice(0, 10),
        affordability: cheapest.cost <= 100  ? 'nano'
          : cheapest.cost <= 300  ? 'micro'
          : cheapest.cost <= 600  ? 'standard'
          : 'premium'
      });
    } catch (e) {
      console.log(`Skip ${c.ticker}: ${e.message}`);
    }
  }

  // Sort by affordability then by momentum
  affordable.sort((a, b) => a.cheapestCost - b.cheapestCost);

  return {
    tickers:    affordable.map(a => a.ticker),
    candidates: affordable,
    scanTime:   Date.now(),
    maxCost:    maxCostPerContract
  };
}

// ============================================================
// OPTIONS CHAIN — Tradier API (real bid/ask/mark/Greeks)
// ============================================================
async function fetchOptionsChain(ticker, env) {
  const now    = Date.now();
  const apiKey = env?.TRADIER_API_KEY;

  if (!apiKey) throw new Error('TRADIER_API_KEY not configured in Worker secrets');

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  };

  // Step 1: Get current stock price
  const quoteRes = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${ticker}`,
    { headers }
  );
  if (!quoteRes.ok) throw new Error(`Tradier quote error ${quoteRes.status}`);
  const quoteJson      = await quoteRes.json();
  const underlyingPrice = quoteJson?.quotes?.quote?.last || 0;

  // Step 2: Get expiration dates
  const expRes = await fetch(
    `https://api.tradier.com/v1/markets/options/expirations?symbol=${ticker}&includeAllRoots=true`,
    { headers }
  );
  if (!expRes.ok) throw new Error(`Tradier expirations error ${expRes.status}`);
  const expJson     = await expRes.json();
  const allExpiries = (expJson?.expirations?.date || []).filter(d => new Date(d) > new Date());

  // Find expiry closest to 30 DTE
  const target30 = new Date(now + 30 * 24 * 60 * 60 * 1000);
  const bestExpiry = allExpiries.reduce((best, d) => {
    if (!best) return d;
    return Math.abs(new Date(d) - target30) < Math.abs(new Date(best) - target30) ? d : best;
  }, allExpiries[0] || null);

  if (!bestExpiry) throw new Error(`No valid expiry dates for ${ticker}`);

  // Step 3: Get options chain for that expiry
  const chainRes = await fetch(
    `https://api.tradier.com/v1/markets/options/chains?symbol=${ticker}&expiration=${bestExpiry}&greeks=true`,
    { headers }
  );
  if (!chainRes.ok) throw new Error(`Tradier chain error ${chainRes.status}`);
  const chainJson = await chainRes.json();
  const options   = chainJson?.options?.option || [];

  if (!options.length) throw new Error(`No options data for ${ticker} on ${bestExpiry}`);

  // Map Tradier contract to our format
  const mapContract = o => ({
    strike:            o.strike,
    expiry:            o.expiration_date,
    daysToExpiry:      Math.round((new Date(o.expiration_date) - new Date()) / (1000 * 60 * 60 * 24)),
    bid:               o.bid   || 0,
    ask:               o.ask   || 0,
    mark:              o.mid_price || (o.bid && o.ask ? +((o.bid + o.ask) / 2).toFixed(2) : o.last || 0),
    lastPrice:         o.last  || 0,
    openInterest:      o.open_interest || 0,
    impliedVolatility: o.greeks?.smv_vol || o.iv || 0,
    volume:            o.volume || 0,
    inTheMoney:        o.in_the_money === 'true' || o.in_the_money === true,
    delta:             o.greeks?.delta || null,
    theta:             o.greeks?.theta || null,
    vega:              o.greeks?.vega  || null,
    gamma:             o.greeks?.gamma || null,
  });

  const calls = options.filter(o => o.option_type === 'call').map(mapContract)
    .filter(c => c.daysToExpiry >= 7 && c.mark > 0);
  const puts  = options.filter(o => o.option_type === 'put').map(mapContract)
    .filter(p => p.daysToExpiry >= 7 && p.mark > 0);

  // Find ATM
  const findATM = arr => arr.length
    ? arr.reduce((best, c) =>
        Math.abs(c.strike - underlyingPrice) < Math.abs(best.strike - underlyingPrice) ? c : best)
    : null;

  // Slightly OTM call: 1-5% above price
  const otmCalls = calls
    .filter(c => c.strike > underlyingPrice && c.strike <= underlyingPrice * 1.06)
    .sort((a, b) => Math.abs(a.strike - underlyingPrice * 1.02) - Math.abs(b.strike - underlyingPrice * 1.02));

  // Slightly OTM put: 1-5% below price
  const otmPuts = puts
    .filter(p => p.strike < underlyingPrice && p.strike >= underlyingPrice * 0.95)
    .sort((a, b) => Math.abs(a.strike - underlyingPrice * 0.98) - Math.abs(b.strike - underlyingPrice * 0.98));

  const atmCall         = findATM(calls);
  const atmPut          = findATM(puts);
  const recommendedCall = otmCalls[0] || atmCall;
  const recommendedPut  = otmPuts[0]  || atmPut;

  console.log(`Tradier ${ticker}: $${underlyingPrice} | ${bestExpiry} | rec call: $${recommendedCall?.strike} mark=$${recommendedCall?.mark}`);

  return {
    ticker,
    underlyingPrice,
    selectedExpiry:  bestExpiry,
    expirationDates: allExpiries,
    calls:           calls.slice(0, 20),
    puts:            puts.slice(0, 20),
    atmCall,
    atmPut,
    recommendedCall,
    recommendedPut,
    dataSource:      'tradier',
    dataTimestamp:   now
  };
}
