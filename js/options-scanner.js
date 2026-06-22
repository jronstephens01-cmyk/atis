// options-scanner.js — Options Scanner for ATIS Phase 2

const OptionsScanner = {

  WORKER_URL: '',

  init() {
    OptionsScanner.WORKER_URL = Storage.getPrefs().workerUrl || '';
  },

  // Fetch options chain for a ticker from Worker
  async fetchChain(ticker) {
    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) throw new Error('Worker URL not set');

    const res = await fetch(`${prefs.workerUrl}/api/options-chain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker })
    });

    if (!res.ok) throw new Error(`Options fetch failed: ${res.status}`);
    return await res.json();
  },

  // Evaluate a single options contract
  evaluateContract(contract, underlyingPrice, type) {
    const {
      strike, expiry, bid, ask,
      openInterest, impliedVolatility,
      lastPrice
    } = contract;

    const premium = ask || lastPrice || 0;
    const bidAskSpread = ask && bid ? (ask - bid) / ask : 1;
    const oi = openInterest || 0;
    const iv = impliedVolatility || 0.30;

    // Liquidity check
    const liquidityOk = oi >= 500 && bidAskSpread < 0.05;

    // Greeks via Black-Scholes
    const daysToExp = Options.daysToExpiry(expiry);
    const T = daysToExp / 365;
    const greeks = T > 0 && premium > 0
      ? Options.blackScholes(underlyingPrice, strike, T, 0.05, iv, type)
      : null;

    // Score this contract (0-10)
    let score = 5;
    if (liquidityOk) score += 2;
    if (daysToExp >= 14 && daysToExp <= 45) score += 1; // Sweet spot for theta
    if (greeks?.delta && Math.abs(greeks.delta) >= 0.30 && Math.abs(greeks.delta) <= 0.50) score += 1; // Good delta range
    if (iv < 0.40) score += 1; // Not overpriced IV
    if (bidAskSpread < 0.02) score += 1; // Tight spread bonus

    return {
      ticker: contract.ticker,
      type,
      strike,
      expiry,
      bid: bid || 0,
      ask: premium,
      premium,
      bidAskSpread: Utils.round(bidAskSpread * 100, 2),
      openInterest: oi,
      iv: Utils.round(iv * 100, 1),
      daysToExpiry: daysToExp,
      greeks,
      liquidityOk,
      liquidityFlags: [
        ...(!( oi >= 500) ? [`Low OI: ${oi}`] : []),
        ...(bidAskSpread >= 0.05 ? [`Wide spread: ${Utils.round(bidAskSpread*100,1)}%`] : [])
      ],
      breakeven: type === 'call'
        ? Utils.round(strike + premium, 2)
        : Utils.round(strike - premium, 2),
      maxLoss: Utils.round(premium * 100, 2),
      score: Utils.clamp(Math.round(score), 0, 10),
      moneynessLabel: (() => {
        const diff = Math.abs(underlyingPrice - strike) / underlyingPrice;
        if (diff < 0.01) return 'ATM';
        if (type === 'call') return underlyingPrice > strike ? 'ITM' : 'OTM';
        return underlyingPrice < strike ? 'ITM' : 'OTM';
      })()
    };
  },

  // Find best call and put setups for a ticker
  async scanTicker(ticker, underlyingPrice) {
    try {
      const chainData = await OptionsScanner.fetchChain(ticker);
      if (!chainData || !chainData.calls || !chainData.puts) return null;

      const calls = chainData.calls
        .map(c => OptionsScanner.evaluateContract(c, underlyingPrice, 'call'))
        .filter(c => c.liquidityOk && c.daysToExpiry >= 7 && c.daysToExpiry <= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const puts = chainData.puts
        .map(p => OptionsScanner.evaluateContract(p, underlyingPrice, 'put'))
        .filter(p => p.liquidityOk && p.daysToExpiry >= 7 && p.daysToExpiry <= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      return {
        ticker,
        underlyingPrice,
        calls,
        puts,
        timestamp: Date.now()
      };
    } catch (err) {
      console.warn(`Options scan failed for ${ticker}:`, err.message);
      return null;
    }
  },

  // Scan entire watchlist
  async scanWatchlist() {
    const watchlist = Storage.getWatchlist();
    const results = [];

    for (const ticker of watchlist) {
      const cached = Storage.getCachedMarketData(ticker);
      const price = cached?.regularMarketPrice || cached?.price;
      if (!price) continue;

      const result = await OptionsScanner.scanTicker(ticker, price);
      if (result && (result.calls.length || result.puts.length)) {
        results.push(result);
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 300));
    }

    return results;
  }
};
