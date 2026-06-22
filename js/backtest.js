// backtest.js — Backtesting Engine for ATIS Phase 4

const Backtest = {

  STORAGE_KEY: 'atis_backtestResults',

  // ============================================================
  // MAIN BACKTEST RUNNER
  // ============================================================
  async run(params) {
    const {
      strategyName,
      tickers,
      startDate,
      endDate,
      strategy,       // strategy definition object
      accountSize = 500,
      onProgress = () => {}
    } = params;

    const results = {
      strategyName,
      tickers,
      startDate,
      endDate,
      accountSize,
      trades: [],
      metrics: null,
      periodBreakdown: [],
      outOfSample: null,
      monteCarlo: null,
      timestamp: Date.now()
    };

    onProgress('Fetching historical data...', 5);

    // Fetch historical data for all tickers
    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) throw new Error('Worker URL not set');

    const historicalData = {};
    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      onProgress(`Loading ${ticker}...`, 5 + (i / tickers.length) * 30);
      try {
        const res = await fetch(`${prefs.workerUrl}/api/market-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: [ticker], fields: ['history'] })
        });
        const data = await res.json();
        if (data.data?.[ticker]?.history) {
          historicalData[ticker] = data.data[ticker].history;
        }
      } catch (err) {
        console.warn(`Failed to load history for ${ticker}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 300)); // Rate limit
    }

    onProgress('Running simulation...', 40);

    // Run simulation on each ticker
    let currentAccountSize = accountSize;
    const allTrades = [];

    for (const ticker of tickers) {
      const history = historicalData[ticker];
      if (!history || history.length < 50) continue;

      // Filter to date range
      const filtered = history.filter(d =>
        d.date >= startDate && d.date <= endDate
      );

      if (filtered.length < 20) continue;

      // Run strategy signals
      const tickerTrades = Backtest.runStrategy(
        ticker, filtered, strategy, currentAccountSize
      );

      allTrades.push(...tickerTrades);
    }

    // Sort trades by date
    allTrades.sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

    onProgress('Calculating metrics...', 70);

    results.trades = allTrades;
    results.metrics = Backtest.calculateMetrics(allTrades, accountSize);
    results.periodBreakdown = Backtest.periodBreakdown(allTrades, startDate, endDate);

    // Out of sample test (last 20% of trades)
    const splitIdx = Math.floor(allTrades.length * 0.8);
    const inSample = allTrades.slice(0, splitIdx);
    const outSample = allTrades.slice(splitIdx);
    results.outOfSample = {
      metrics: Backtest.calculateMetrics(outSample, accountSize),
      tradeCount: outSample.length,
      consistent: outSample.length >= 5
    };

    onProgress('Running Monte Carlo...', 85);

    // Monte Carlo simulation (1000 iterations)
    results.monteCarlo = Backtest.monteCarlo(allTrades, accountSize, 1000);

    onProgress('Complete', 100);

    // Save results
    const stored = Storage.get(Backtest.STORAGE_KEY) || {};
    stored[strategyName] = results;
    Storage.set(Backtest.STORAGE_KEY, stored);

    return results;
  },

  // ============================================================
  // STRATEGY RUNNER
  // ============================================================
  runStrategy(ticker, history, strategy, accountSize) {
    const trades = [];
    const closes = history.map(d => d.close).filter(Boolean);
    const volumes = history.map(d => d.volume).filter(Boolean);

    if (closes.length < 50) return [];

    let inPosition = false;
    let entryPrice = 0;
    let entryDate = '';
    let stopLoss = 0;
    let target = 0;
    let positionSize = 0;

    for (let i = 50; i < history.length; i++) {
      const bar = history[i];
      if (!bar.close) continue;

      const closeSlice = closes.slice(0, i + 1);
      const volumeSlice = volumes.slice(0, i + 1);

      // Calculate indicators
      const ma20  = Indicators.sma(closeSlice, 20);
      const ma50  = Indicators.sma(closeSlice, 50);
      const rsi   = Indicators.rsi(closeSlice, 14);
      const avgVol = Indicators.sma(volumeSlice, 20);
      const currentVol = bar.volume || 0;
      const volRatio = avgVol ? currentVol / avgVol : 1;

      if (!ma20 || !ma50 || !rsi) continue;

      const price = bar.close;

      if (!inPosition) {
        // Entry signal based on strategy type
        let entrySignal = false;

        if (strategy.type === 'ma_crossover') {
          entrySignal = price > ma20 && price > ma50 && rsi > 50 && rsi < 70 && volRatio > 1.2;
        } else if (strategy.type === 'rsi_oversold') {
          entrySignal = rsi < 35 && price > ma50 && volRatio > 0.8;
        } else if (strategy.type === 'momentum_breakout') {
          const high20 = Math.max(...closeSlice.slice(-20));
          entrySignal = price >= high20 * 0.99 && rsi > 55 && rsi < 75 && volRatio > 1.5;
        } else if (strategy.type === 'ma_pullback') {
          entrySignal = price > ma50 && price < ma20 * 1.02 && price > ma20 * 0.98 && rsi > 40 && rsi < 60;
        }

        if (entrySignal) {
          // Position sizing for small accounts
          const riskPercent = strategy.riskPercent || 0.02; // 2% risk per trade
          const stopPct = strategy.stopPercent || 0.05;     // 5% stop loss
          const stopPrice = price * (1 - stopPct);
          const riskPerShare = price - stopPrice;
          const riskDollar = accountSize * riskPercent;
          const shares = Math.floor(riskDollar / riskPerShare);

          if (shares < 1) continue; // Can't afford even 1 share

          const cost = shares * price;
          if (cost > accountSize * 0.20) continue; // Max 20% position

          inPosition  = true;
          entryPrice  = price;
          entryDate   = bar.date;
          stopLoss    = stopPrice;
          target      = price * (1 + stopPct * (strategy.rrRatio || 2));
          positionSize = shares;
        }
      } else {
        // Exit logic
        let exitPrice = null;
        let exitReason = null;

        if (price <= stopLoss) {
          exitPrice  = stopLoss;
          exitReason = 'stop_hit';
        } else if (price >= target) {
          exitPrice  = target;
          exitReason = 'target_hit';
        } else if (strategy.maxDays && i - history.findIndex(d => d.date === entryDate) >= strategy.maxDays) {
          exitPrice  = price;
          exitReason = 'time_exit';
        }

        if (exitPrice) {
          const pl = (exitPrice - entryPrice) * positionSize;
          const plPct = ((exitPrice - entryPrice) / entryPrice) * 100;

          trades.push({
            ticker,
            entryDate,
            exitDate:     bar.date,
            entryPrice:   Utils.round(entryPrice, 2),
            exitPrice:    Utils.round(exitPrice, 2),
            stopLoss:     Utils.round(stopLoss, 2),
            target:       Utils.round(target, 2),
            positionSize,
            dollarPL:     Utils.round(pl, 2),
            percentPL:    Utils.round(plPct, 2),
            result:       pl >= 0 ? 'win' : 'loss',
            exitReason,
            strategyType: strategy.type
          });

          accountSize = Math.max(250, accountSize + pl); // Apply P&L but never below floor
          inPosition  = false;
        }
      }
    }

    return trades;
  },

  // ============================================================
  // METRICS CALCULATOR
  // ============================================================
  calculateMetrics(trades, startingCapital) {
    if (!trades.length) return {
      totalTrades: 0, wins: 0, losses: 0,
      winRate: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, expectancy: 0,
      totalReturn: 0, totalReturnPct: 0,
      sharpeRatio: 0, sortinoRatio: 0,
      maxDrawdown: 0, avgTrade: 0,
      worstStreak: 0, bestStreak: 0
    };

    const wins   = trades.filter(t => t.result === 'win');
    const losses = trades.filter(t => t.result === 'loss');

    const avgWin  = wins.length   ? wins.reduce((s, t) => s + t.percentPL, 0) / wins.length   : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.percentPL, 0) / losses.length) : 0;

    const grossWin  = wins.reduce((s, t) => s + t.dollarPL, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.dollarPL, 0));
    const profitFactor = grossLoss > 0 ? Utils.round(grossWin / grossLoss, 2) : 0;

    const winRate = Utils.round(wins.length / trades.length, 4);
    const expectancy = Utils.round(winRate * avgWin - (1 - winRate) * avgLoss, 2);

    const totalReturn = Utils.round(trades.reduce((s, t) => s + t.dollarPL, 0), 2);
    const totalReturnPct = Utils.round((totalReturn / startingCapital) * 100, 2);
    const avgTrade = Utils.round(totalReturn / trades.length, 2);

    // Max drawdown
    let peak = startingCapital;
    let equity = startingCapital;
    let maxDD = 0;
    for (const trade of trades) {
      equity += trade.dollarPL;
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    // Sharpe ratio (simplified — using trade returns)
    const returns = trades.map(t => t.percentPL / 100);
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? Utils.round((avgReturn / stdDev) * Math.sqrt(252), 2) : 0;

    // Sortino ratio
    const negReturns = returns.filter(r => r < 0);
    const downVar = negReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / returns.length;
    const downStd = Math.sqrt(downVar);
    const sortino = downStd > 0 ? Utils.round((avgReturn / downStd) * Math.sqrt(252), 2) : 0;

    // Streak analysis
    let currentStreak = 0;
    let worstStreak = 0;
    let bestStreak = 0;
    let tempBest = 0;

    for (const trade of trades) {
      if (trade.result === 'loss') {
        currentStreak++;
        tempBest = 0;
        if (currentStreak > worstStreak) worstStreak = currentStreak;
      } else {
        currentStreak = 0;
        tempBest++;
        if (tempBest > bestStreak) bestStreak = tempBest;
      }
    }

    return {
      totalTrades:    trades.length,
      wins:           wins.length,
      losses:         losses.length,
      winRate:        Utils.round(winRate * 100, 1),
      avgWin:         Utils.round(avgWin, 2),
      avgLoss:        Utils.round(avgLoss, 2),
      profitFactor,
      expectancy,
      totalReturn,
      totalReturnPct,
      sharpeRatio:    sharpe,
      sortinoRatio:   sortino,
      maxDrawdown:    Utils.round(maxDD, 2),
      avgTrade,
      worstStreak,
      bestStreak
    };
  },

  // ============================================================
  // PERIOD BREAKDOWN
  // ============================================================
  periodBreakdown(trades, startDate, endDate) {
    const years = {};

    for (const trade of trades) {
      const year = trade.exitDate?.slice(0, 4);
      if (!year) continue;
      if (!years[year]) years[year] = [];
      years[year].push(trade);
    }

    return Object.entries(years).map(([year, yearTrades]) => {
      const wins = yearTrades.filter(t => t.result === 'win');
      const pl   = yearTrades.reduce((s, t) => s + t.dollarPL, 0);
      return {
        period:      year,
        trades:      yearTrades.length,
        wins:        wins.length,
        winRate:     yearTrades.length ? Utils.round((wins.length / yearTrades.length) * 100, 1) : 0,
        totalPL:     Utils.round(pl, 2),
        assessment:  pl > 0 ? 'positive' : 'negative'
      };
    });
  },

  // ============================================================
  // MONTE CARLO SIMULATION
  // ============================================================
  monteCarlo(trades, startingCapital, iterations = 1000) {
    if (trades.length < 5) return { insufficient: true };

    const plArray = trades.map(t => t.dollarPL);
    let positiveEndings = 0;
    let allFinalEquities = [];
    let worstCase = Infinity;
    let bestCase = -Infinity;

    for (let i = 0; i < iterations; i++) {
      // Shuffle trade order
      const shuffled = [...plArray].sort(() => Math.random() - 0.5);
      let equity = startingCapital;

      for (const pl of shuffled) {
        equity += pl;
        if (equity <= 250) { equity = 250; break; } // Hard floor
      }

      allFinalEquities.push(equity);
      if (equity > startingCapital) positiveEndings++;
      if (equity < worstCase) worstCase = equity;
      if (equity > bestCase) bestCase = equity;
    }

    allFinalEquities.sort((a, b) => a - b);
    const median = allFinalEquities[Math.floor(iterations / 2)];
    const p10    = allFinalEquities[Math.floor(iterations * 0.10)];
    const p90    = allFinalEquities[Math.floor(iterations * 0.90)];

    return {
      iterations,
      positivePercent:   Utils.round((positiveEndings / iterations) * 100, 1),
      medianFinalEquity: Utils.round(median, 2),
      worstCase:         Utils.round(worstCase, 2),
      bestCase:          Utils.round(bestCase, 2),
      p10:               Utils.round(p10, 2),
      p90:               Utils.round(p90, 2),
      verdict: positiveEndings / iterations >= 0.6 ? 'viable' : 'marginal'
    };
  },

  // ============================================================
  // POSITION SIZER FOR SMALL ACCOUNTS
  // ============================================================
  smallAccountPositionSize(accountValue, setupScore, riskPercent = 0.02) {
    // Hard floor check
    if (accountValue <= 250) return { size: 0, reason: 'Hard floor reached' };

    const workingCapital = accountValue - 250; // Only trade above the floor

    // Base risk amount
    let riskDollar = workingCapital * riskPercent;

    // Score adjustment
    if (setupScore >= 50) riskDollar *= 1.1;
    else if (setupScore < 42) riskDollar *= 0.5;

    // Caps
    const maxPosition = workingCapital * 0.20;
    riskDollar = Math.min(riskDollar, maxPosition);

    // Minimum meaningful size
    if (riskDollar < 10) return { size: 0, reason: 'Position too small to be meaningful' };

    return {
      size: Utils.round(riskDollar, 2),
      pctOfWorking: Utils.round((riskDollar / workingCapital) * 100, 1),
      pctOfAccount: Utils.round((riskDollar / accountValue) * 100, 1),
      workingCapital: Utils.round(workingCapital, 2),
      reason: 'Approved'
    };
  },

  // ============================================================
  // PREDEFINED STRATEGIES
  // ============================================================
  STRATEGIES: {
    ma_crossover: {
      name: 'MA Crossover',
      type: 'ma_crossover',
      description: 'Enter when price is above MA20 and MA50 with RSI 50-70 and above-average volume',
      riskPercent: 0.02,
      stopPercent: 0.05,
      rrRatio: 2.0,
      maxDays: 20
    },
    rsi_oversold: {
      name: 'RSI Oversold Bounce',
      type: 'rsi_oversold',
      description: 'Enter when RSI drops below 35 while price stays above MA50',
      riskPercent: 0.015,
      stopPercent: 0.04,
      rrRatio: 2.5,
      maxDays: 15
    },
    momentum_breakout: {
      name: 'Momentum Breakout',
      type: 'momentum_breakout',
      description: 'Enter on 20-day high breakout with RSI 55-75 and 1.5x average volume',
      riskPercent: 0.025,
      stopPercent: 0.06,
      rrRatio: 2.0,
      maxDays: 25
    },
    ma_pullback: {
      name: 'MA Pullback',
      type: 'ma_pullback',
      description: 'Enter when price pulls back to MA20 in an uptrend (above MA50)',
      riskPercent: 0.02,
      stopPercent: 0.04,
      rrRatio: 2.0,
      maxDays: 15
    }
  },

  getResults() {
    return Storage.get(Backtest.STORAGE_KEY) || {};
  }
};
