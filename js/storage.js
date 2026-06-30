// storage.js — localStorage interface for ATIS

const STORAGE_KEYS = {
  PORTFOLIO:          'atis_portfolio',
  RISK_STATE:         'atis_riskState',
  SYSTEM_HEALTH:      'atis_systemHealth',
  USER_PREFS:         'atis_userPrefs',
  TRADE_LOG:          'atis_tradeLog',
  SCAN_LOG:           'atis_scanLog',
  STRATEGY_PERF:      'atis_strategyPerformance',
  WATCHLIST:          'atis_watchlist',
  API_COST:           'atis_apiCost',

  MARKET_DATA:        (ticker, date) => `atis_market_${ticker}_${date}`,
  OPTIONS_CHAIN:      (ticker, date) => `atis_options_${ticker}_${date}`,
  MACRO_STATE:        (date) => `atis_macro_${date}`,
  AGENT_DECISIONS:    (scanId) => `atis_agents_${scanId}`,
  BACKTEST_RESULTS:   (name) => `atis_backtest_${encodeURIComponent(name)}`,
};

const Storage = {

  get(key) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded — running cleanup');
        Storage.cleanup();
        try {
          localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch {
          Utils.toast('Storage full. Export and clear old data.', 'error');
          return false;
        }
      }
      return false;
    }
  },

  delete(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  // Remove market/options/macro data older than 30 days
  cleanup() {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const toDelete = [];
    for (let key of Object.keys(localStorage)) {
      if (!key.startsWith('atis_')) continue;
      if (
        key.startsWith('atis_market_') ||
        key.startsWith('atis_options_') ||
        key.startsWith('atis_macro_')
      ) {
        const data = Storage.get(key);
        if (data && data.timestamp && data.timestamp < cutoff) {
          toDelete.push(key);
        }
      }
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    if (toDelete.length > 0) {
      console.log(`Storage cleanup: removed ${toDelete.length} stale entries`);
    }
  },

  // Export all ATIS data to a JSON file
  export() {
    const backup = {};
    for (let key of Object.keys(localStorage)) {
      if (key.startsWith('atis_')) {
        backup[key] = Storage.get(key);
      }
    }
    backup._exportDate = new Date().toISOString();
    backup._version = '1.0';

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atis_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Utils.toast('Backup exported successfully.', 'success');
  },

  // Import from a backup JSON file
  import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const backup = JSON.parse(e.target.result);
          if (!backup._version) throw new Error('Invalid backup file');

          let count = 0;
          for (let [key, value] of Object.entries(backup)) {
            if (key.startsWith('atis_')) {
              localStorage.setItem(key, JSON.stringify(value));
              count++;
            }
          }
          Utils.toast(`Imported ${count} records. Reloading...`, 'success');
          setTimeout(() => location.reload(), 1500);
          resolve(count);
        } catch (err) {
          Utils.toast('Import failed: invalid backup file.', 'error');
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsText(file);
    });
  },

  // Clear all ATIS data (requires confirmation)
  clearAll() {
    const toDelete = [];
    for (let key of Object.keys(localStorage)) {
      if (key.startsWith('atis_')) toDelete.push(key);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    return toDelete.length;
  },

  // --- PORTFOLIO ---

  getPortfolio() {
    const portfolio = Storage.get(STORAGE_KEYS.PORTFOLIO) || Storage.defaultPortfolio();
    // Self-heal: fix any portfolio saved with the old broken defaults
    // (peakValue < currentValue, or cashAvailable stuck below currentValue
    // with no positions open to explain the gap)
    let healed = false;
    if (portfolio.peakValue < portfolio.currentValue) {
      portfolio.peakValue = portfolio.currentValue;
      healed = true;
    }
    const investedValue = (portfolio.positions || []).reduce((sum, p) => sum + (p.value || p.totalCost || 0), 0);
    const expectedCash  = portfolio.currentValue - investedValue;
    if (portfolio.cashAvailable == null || (portfolio.positions.length === 0 && Math.abs(portfolio.cashAvailable - portfolio.currentValue) > 0.01)) {
      portfolio.cashAvailable = expectedCash;
      healed = true;
    }
    if (healed) Storage.savePortfolio(portfolio);
    return portfolio;
  },

  savePortfolio(portfolio) {
    portfolio.lastUpdated = Date.now();
    return Storage.set(STORAGE_KEYS.PORTFOLIO, portfolio);
  },

  defaultPortfolio() {
    return {
      currentValue: 2000.00,
      startingCapital: 2000.00,
      peakValue: 2000.00,
      cashAvailable: 2000.00,
      positions: [],
      exposure: {
        totalInvested: 0,
        cashPercent: 100,
        sectors: {},
        correlationGroups: []
      },
      lastUpdated: null,
      source: 'manual'
    };
  },

  // --- RISK STATE ---

  getRiskState() {
    return Storage.get(STORAGE_KEYS.RISK_STATE) || Storage.defaultRiskState();
  },

  saveRiskState(state) {
    state.lastUpdated = Date.now();
    return Storage.set(STORAGE_KEYS.RISK_STATE, state);
  },

  defaultRiskState() {
    return {
      dailyPL: 0,
      weeklyPL: 0,
      monthlyPL: 0,
      dailyPLPercent: 0,
      weeklyPLPercent: 0,
      monthlyPLPercent: 0,
      drawdownFromPeak: 0,
      drawdownDollar: 0,
      dailyLimitHit: false,
      weeklyLimitHit: false,
      monthlyLimitHit: false,
      hardFloorBreached: false,
      positionSizeMultiplier: 1.0,
      lastUpdated: null
    };
  },

  // --- TRADE LOG ---

  getTradeLog() {
    return Storage.get(STORAGE_KEYS.TRADE_LOG) || [];
  },

  addTrade(trade) {
    const log = Storage.getTradeLog();
    log.unshift(trade); // newest first
    return Storage.set(STORAGE_KEYS.TRADE_LOG, log);
  },

  updateTrade(tradeId, updates) {
    const log = Storage.getTradeLog();
    const idx = log.findIndex(t => t.tradeId === tradeId);
    if (idx === -1) return false;
    log[idx] = { ...log[idx], ...updates };
    return Storage.set(STORAGE_KEYS.TRADE_LOG, log);
  },

  // --- WATCHLIST ---

  getWatchlist() {
    return Storage.get(STORAGE_KEYS.WATCHLIST) || ['SPY','QQQ','AAPL','MSFT','NVDA'];
  },

  saveWatchlist(list) {
    return Storage.set(STORAGE_KEYS.WATCHLIST, list);
  },

  addToWatchlist(ticker) {
    const list = Storage.getWatchlist();
    const clean = ticker.trim().toUpperCase();
    if (!clean || list.includes(clean)) return false;
    list.push(clean);
    return Storage.set(STORAGE_KEYS.WATCHLIST, list);
  },

  removeFromWatchlist(ticker) {
    const list = Storage.getWatchlist();
    const updated = list.filter(t => t !== ticker);
    return Storage.set(STORAGE_KEYS.WATCHLIST, updated);
  },

  // --- MARKET DATA CACHE ---

  getCachedMarketData(ticker) {
    const today = new Date().toISOString().split('T')[0];
    return Storage.get(STORAGE_KEYS.MARKET_DATA(ticker, today));
  },

  cacheMarketData(ticker, data) {
    const today = new Date().toISOString().split('T')[0];
    return Storage.set(STORAGE_KEYS.MARKET_DATA(ticker, today), {
      ...data,
      ticker,
      timestamp: Date.now()
    });
  },

  // --- MACRO STATE ---

  getCachedMacroState() {
    const today = new Date().toISOString().split('T')[0];
    return Storage.get(STORAGE_KEYS.MACRO_STATE(today));
  },

  cacheMacroState(data) {
    const today = new Date().toISOString().split('T')[0];
    return Storage.set(STORAGE_KEYS.MACRO_STATE(today), {
      ...data,
      timestamp: Date.now()
    });
  },

  // --- STRATEGY PERFORMANCE ---

  getStrategyPerf() {
    return Storage.get(STORAGE_KEYS.STRATEGY_PERF) || {};
  },

  updateStrategyPerf(strategyName, metrics) {
    const perf = Storage.getStrategyPerf();
    perf[strategyName] = { ...perf[strategyName], ...metrics, lastUpdated: Date.now() };
    return Storage.set(STORAGE_KEYS.STRATEGY_PERF, perf);
  },

  // --- SYSTEM HEALTH ---

  getSystemHealth() {
    return Storage.get(STORAGE_KEYS.SYSTEM_HEALTH) || {};
  },

  updateHealth(service, status, detail = '') {
    const health = Storage.getSystemHealth();
    health[service] = { status, detail, timestamp: Date.now() };
    return Storage.set(STORAGE_KEYS.SYSTEM_HEALTH, health);
  },

  // --- API COST TRACKER ---

  getApiCost() {
    return Storage.get(STORAGE_KEYS.API_COST) || { month: '', totalCalls: 0, estimatedCost: 0 };
  },

  recordApiCall(inputTokens = 800, outputTokens = 300) {
    const costData = Storage.getApiCost();
    const currentMonth = new Date().toISOString().slice(0, 7);

    if (costData.month !== currentMonth) {
      costData.month = currentMonth;
      costData.totalCalls = 0;
      costData.estimatedCost = 0;
    }

    // Claude Sonnet 4.6 pricing estimate
    const inputCost  = (inputTokens  / 1000000) * 3.00;
    const outputCost = (outputTokens / 1000000) * 15.00;
    costData.totalCalls += 1;
    costData.estimatedCost += (inputCost + outputCost);
    Storage.set(STORAGE_KEYS.API_COST, costData);
    return costData.estimatedCost;
  },

  // --- USER PREFS ---

  getPrefs() {
    return Storage.get(STORAGE_KEYS.USER_PREFS) || {
      workerUrl: '',
      theme: 'dark',
      defaultPositionPct: 7.5,
    };
  },

  savePrefs(prefs) {
    return Storage.set(STORAGE_KEYS.USER_PREFS, prefs);
  }
};
