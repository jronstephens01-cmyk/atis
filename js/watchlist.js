// watchlist.js — Watchlist Manager tab

const Watchlist = {

  init() {
    document.getElementById('addTickerBtn').addEventListener('click', Watchlist.addTicker);
    document.getElementById('tickerInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') Watchlist.addTicker();
    });
    document.getElementById('refreshWatchlistBtn').addEventListener('click', Watchlist.refresh);
    Watchlist.render();
  },

  addTicker() {
    const input = document.getElementById('tickerInput');
    const ticker = input.value.trim().toUpperCase();
    if (!ticker) return;
    if (ticker.length > 6) { Utils.toast('Ticker too long', 'error'); return; }

    const added = Storage.addToWatchlist(ticker);
    if (!added) {
      Utils.toast(`${ticker} is already in your watchlist`, 'warn');
    } else {
      input.value = '';
      Watchlist.render();
      Utils.toast(`${ticker} added to watchlist`, 'success');
    }
  },

  removeTicker(ticker) {
    Storage.removeFromWatchlist(ticker);
    Watchlist.render();
    Utils.toast(`${ticker} removed`, 'info');
  },

  render() {
    const list = Storage.getWatchlist();
    const tbody = document.getElementById('watchlistBody');
    Utils.setText('watchlistCount', list.length);

    if (!list.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No tickers. Add one above.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(ticker => {
      const data = Storage.getCachedMarketData(ticker);
      if (!data) {
        return `
          <tr>
            <td><strong>${ticker}</strong></td>
            <td colspan="5" style="color:var(--text-muted)">Not loaded — click Refresh Prices</td>
            <td><button class="btn btn--secondary" onclick="Watchlist.removeTicker('${ticker}')">✕</button></td>
          </tr>`;
      }

      const price  = data.regularMarketPrice || data.price || 0;
      const chg    = data.regularMarketChangePercent || data.changePct || 0;
      const vol    = data.regularMarketVolume || data.volume || 0;
      const low52  = data.fiftyTwoWeekLow  || 0;
      const high52 = data.fiftyTwoWeekHigh || 0;
      const fmt    = Utils.formatChange(chg);

      const rangeText = low52 && high52
        ? `$${low52.toFixed(0)} — $${high52.toFixed(0)}`
        : '—';

      const posLabel = Indicators.weekPositionLabel(price, low52, high52);

      return `
        <tr>
          <td><strong style="color:var(--text-primary)">${ticker}</strong></td>
          <td style="font-family:var(--font-mono)">$${price.toFixed(2)}</td>
          <td class="${fmt.cls}" style="font-family:var(--font-mono)">${fmt.text}</td>
          <td style="font-family:var(--font-mono)">${Utils.formatVolume(vol)}</td>
          <td style="font-size:11px">${rangeText} <span style="color:var(--text-muted)">${posLabel}</span></td>
          <td style="color:var(--text-muted);font-size:11px">—</td>
          <td><button class="btn btn--secondary" onclick="Watchlist.removeTicker('${ticker}')">✕</button></td>
        </tr>`;
    }).join('');
  },

  async refresh() {
    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) {
      Utils.toast('Set Worker URL first (Agents tab → Data Management)', 'warn');
      return;
    }

    const list = Storage.getWatchlist();
    const btn = document.getElementById('refreshWatchlistBtn');
    btn.disabled = true;
    btn.textContent = '↻ Loading...';

    try {
      const res = await fetch(`${prefs.workerUrl}/api/market-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: list, fields: ['quote'] })
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();

      for (const [ticker, data] of Object.entries(json.data || {})) {
        Storage.cacheMarketData(ticker, { ...data, ticker });
      }
      Watchlist.render();
      Utils.toast('Watchlist prices updated', 'success');
    } catch (err) {
      Utils.toast(`Fetch failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Refresh Prices';
    }
  }
};


// ============================================================
// macro.js — Macro Environment tab
// ============================================================

const Macro = {

  init() {
    document.getElementById('refreshMacro').addEventListener('click', Macro.refresh);
    Macro.renderFromCache();
  },

  renderFromCache() {
    const cached = Storage.getCachedMacroState();
    if (cached) {
      Macro.render(cached);
      Utils.setText('macroFreshness', 'Updated ' + Utils.formatTime(cached.timestamp));
    }
  },

  async refresh() {
    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) {
      Utils.toast('Set Worker URL first (Agents tab → Data Management)', 'warn');
      return;
    }

    const btn = document.getElementById('refreshMacro');
    btn.disabled = true;
    btn.textContent = '↻ Loading...';
    Utils.setText('macroFreshness', 'Fetching...');

    try {
      const res = await fetch(`${prefs.workerUrl}/api/macro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error(`Worker error: ${res.status}`);
      const json = await res.json();

      Storage.cacheMacroState(json);
      Macro.render(json);
      Utils.setText('macroFreshness', 'Updated ' + Utils.formatTime(Date.now()));
      Storage.updateHealth('fred', 'live', 'Macro data fetched');
      Utils.el('statusMacro').querySelector('.dot').className = 'dot dot--ok';
    } catch (err) {
      Utils.toast(`Macro fetch failed: ${err.message}`, 'error');
      Storage.updateHealth('fred', 'error', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Refresh';
    }
  },

  render(state) {
    if (!state) return;

    // Regime
    const regime = state.regime || 'Unknown';
    const cls = Utils.regimeClass(regime);
    const regimeBlock = document.getElementById('macroRegimeBlock');

    Utils.setText('macroRegimeDisplay', regime.toUpperCase());
    const colors = { 'risk-on': 'var(--green)', 'neutral': 'var(--amber)', 'risk-off': 'var(--red)' };
    const regimeDisplay = document.getElementById('macroRegimeDisplay');
    if (regimeDisplay) regimeDisplay.style.color = colors[cls] || 'var(--text-primary)';

    const descriptions = {
      'risk-on':  'Strong breadth, positive trend, low volatility. Normal position sizing permitted.',
      'neutral':  'Mixed signals. Favor higher-quality setups. Maintain standard caution.',
      'risk-off': 'Weak breadth, rising volatility, economic uncertainty. Reduce exposure.'
    };
    Utils.setText('macroRegimeSub', descriptions[cls] || '');

    // Score bars
    const scores = state.scores || {};
    const categories = [
      { key: 'breadth',    barId: 'scoreBreadth',    numId: 'scoreNumBreadth' },
      { key: 'trend',      barId: 'scoreTrend',       numId: 'scoreNumTrend' },
      { key: 'volatility', barId: 'scoreVolatility',  numId: 'scoreNumVolatility' },
      { key: 'liquidity',  barId: 'scoreLiquidity',   numId: 'scoreNumLiquidity' },
      { key: 'economic',   barId: 'scoreEconomic',    numId: 'scoreNumEconomic' },
    ];

    categories.forEach(({ key, barId, numId }) => {
      const val = scores[key] || 0;
      Utils.setStyle(barId, 'width', `${val * 10}%`);
      Utils.setText(numId, `${val}/10`);
    });

    const total = state.totalScore || 0;
    Utils.setStyle('scoreTotal', 'width', `${(total / 50) * 100}%`);
    Utils.setText('scoreNumTotal', `${total}/50`);

    // Also update regime banner on market tab
    Dashboard.renderRegimeBanner(state);
    Utils.el('statusMacro').querySelector('.dot').className = `dot ${cls === 'risk-on' ? 'dot--ok' : cls === 'risk-off' ? 'dot--danger' : 'dot--warn'}`;

    // Key indicators
    const indicators = state.indicators || {};
    Utils.setText('yield10', indicators.yield10 ? `${indicators.yield10.toFixed(2)}%` : '—');
    Utils.setText('yield2',  indicators.yield2  ? `${indicators.yield2.toFixed(2)}%`  : '—');

    if (indicators.yield10 && indicators.yield2) {
      const spread = Utils.round(indicators.yield10 - indicators.yield2, 2);
      const curveEl = document.getElementById('yieldCurve');
      curveEl.textContent = `${spread >= 0 ? '+' : ''}${spread.toFixed(2)} ${spread < 0 ? '(Inverted)' : '(Normal)'}`;
      curveEl.className = `stat-value ${spread < 0 ? 'negative' : 'positive'}`;
    }

    Utils.setText('macroVix',          indicators.vix          ? indicators.vix.toFixed(1) : '—');
    Utils.setText('macroCpi',          indicators.cpi          ? `${indicators.cpi.toFixed(1)}%` : '—');
    Utils.setText('macroUnemployment', indicators.unemployment ? `${indicators.unemployment.toFixed(1)}%` : '—');
    Utils.setText('macroFedFunds',     indicators.fedFunds     ? `${indicators.fedFunds.toFixed(2)}%` : '—');
    Utils.setText('macroDxy',          indicators.dxy          ? indicators.dxy.toFixed(1) : '—');

    // Notes
    Utils.setText('macroNotes', state.notes || 'No macro analysis available.');
  }
};


// ============================================================
// portfolio.js — Portfolio & Risk tab
// ============================================================

const Portfolio = {

  init() {
    document.getElementById('syncRobinhoodBtn').addEventListener('click', Portfolio.syncRobinhood);
    document.getElementById('manualEntryBtn').addEventListener('click', Portfolio.showManualEntry);
    Portfolio.render();
  },

  render() {
    const portfolio = Storage.getPortfolio();
    const riskState = Storage.getRiskState();

    Portfolio.renderRiskBanner(portfolio, riskState);
    Portfolio.renderPositions(portfolio);
    Portfolio.renderExposure(portfolio, riskState);

    // Emergency banner
    if (riskState.hardFloorBreached || portfolio.currentValue <= 250) {
      Utils.show('emergencyBanner');
      Utils.el('statusRisk').querySelector('.dot').className = 'dot dot--danger';
    } else {
      Utils.hide('emergencyBanner');
    }

    Dashboard.renderAccountSnapshot(portfolio, riskState);
  },

  renderRiskBanner(portfolio, riskState) {
    const pnlFields = [
      { valId: 'riskDaily',   dotId: 'riskDailyDot',   val: riskState.dailyPL,   pct: riskState.dailyPLPercent,   limit: -3 },
      { valId: 'riskWeekly',  dotId: 'riskWeeklyDot',  val: riskState.weeklyPL,  pct: riskState.weeklyPLPercent,  limit: -7 },
      { valId: 'riskMonthly', dotId: 'riskMonthlyDot', val: riskState.monthlyPL, pct: riskState.monthlyPLPercent, limit: -15 },
    ];

    pnlFields.forEach(({ valId, dotId, val, pct, limit }) => {
      const fmt = Utils.formatPnL(val || 0);
      const el = document.getElementById(valId);
      if (el) {
        el.textContent = `${fmt.text} (${Utils.formatPercent(pct || 0)})`;
        el.className = `risk-value ${fmt.cls}`;
      }
      const dot = document.getElementById(dotId);
      if (dot) dot.className = `risk-status dot ${(pct || 0) <= limit ? 'dot--danger' : 'dot--ok'}`;
    });

    const cushion = portfolio.currentValue - 250;
    Utils.setText('riskFloorCushion', `cushion: ${Utils.formatCurrency(Math.max(0, cushion))}`);
    const floorDot = document.getElementById('riskFloorDot');
    if (floorDot) {
      floorDot.className = `risk-status dot ${cushion <= 0 ? 'dot--danger' : cushion <= 50 ? 'dot--warn' : 'dot--ok'}`;
    }
  },

  renderPositions(portfolio) {
    const tbody = document.getElementById('positionsBody');
    const positions = portfolio.positions || [];

    if (!positions.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No positions. Sync Robinhood or add manually.</td></tr>';
      return;
    }

    tbody.innerHTML = positions.map(p => {
      const value = (p.shares || 0) * (p.currentPrice || p.avgCost || 0);
      const pl = value - (p.shares || 0) * (p.avgCost || 0);
      const plPct = p.avgCost ? ((p.currentPrice - p.avgCost) / p.avgCost) * 100 : 0;
      const portPct = portfolio.currentValue ? (value / portfolio.currentValue) * 100 : 0;
      const fmtPl = Utils.formatPnL(pl);

      return `
        <tr>
          <td><strong style="color:var(--text-primary)">${p.ticker}</strong></td>
          <td>${p.type || 'equity'}</td>
          <td style="font-family:var(--font-mono)">${p.shares || 0}</td>
          <td style="font-family:var(--font-mono)">$${(p.avgCost || 0).toFixed(2)}</td>
          <td style="font-family:var(--font-mono)">$${(p.currentPrice || p.avgCost || 0).toFixed(2)}</td>
          <td style="font-family:var(--font-mono)">${Utils.formatCurrency(value)}</td>
          <td class="${fmtPl.cls}" style="font-family:var(--font-mono)">${fmtPl.text} (${Utils.formatPercent(plPct)})</td>
          <td style="font-family:var(--font-mono)">${portPct.toFixed(1)}%</td>
          <td style="font-family:var(--font-mono);color:var(--red)">${p.stopLoss ? '$' + p.stopLoss.toFixed(2) : '—'}</td>
          <td style="font-family:var(--font-mono);color:var(--green)">${p.target ? '$' + p.target.toFixed(2) : '—'}</td>
        </tr>`;
    }).join('');
  },

  renderExposure(portfolio, riskState) {
    const positions = portfolio.positions || [];
    Utils.setText('expPositions', `${positions.length} / ${RiskEngine.LIMITS.MAX_POSITIONS}`);

    const maxPos = positions.reduce((max, p) => {
      const pct = portfolio.currentValue ? ((p.shares || 0) * (p.currentPrice || p.avgCost || 0) / portfolio.currentValue) * 100 : 0;
      return Math.max(max, pct);
    }, 0);
    Utils.setText('expMaxPos', `${maxPos.toFixed(1)}%`);
    Utils.setText('expMultiplier', `${(riskState.positionSizeMultiplier || 1.0).toFixed(1)}x`);

    // Sector exposure bars
    const sectors = portfolio.exposure?.sectors || {};
    const sectorList = document.getElementById('sectorExposureList');
    if (!sectorList) return;

    if (!Object.keys(sectors).length) {
      sectorList.innerHTML = '<div style="color:var(--text-muted);font-size:12px">No sector exposure data.</div>';
      return;
    }

    sectorList.innerHTML = Object.entries(sectors)
      .sort((a, b) => b[1] - a[1])
      .map(([sector, pct]) => {
        const barCls = pct >= 25 ? 'danger' : pct >= 20 ? 'warn' : '';
        return `
          <div class="sector-exp-row">
            <span class="sector-exp-name">${sector}</span>
            <div class="sector-exp-bar-wrap">
              <div class="sector-exp-bar-fill ${barCls}" style="width:${Math.min(pct, 100)}%"></div>
            </div>
            <span class="sector-exp-pct ${pct >= 25 ? 'negative' : ''}">${pct.toFixed(1)}%</span>
          </div>`;
      }).join('');
  },

  async syncRobinhood() {
    Utils.toast('Robinhood sync available in Phase 2', 'info');
  },

  showManualEntry() {
    const value = parseFloat(prompt('Enter current account total value:', Storage.getPortfolio().currentValue));
    if (isNaN(value) || value <= 0) return;

    const portfolio = Storage.getPortfolio();
    portfolio.currentValue = value;
    portfolio.cashAvailable = value - portfolio.positions.reduce((sum, p) =>
      sum + (p.shares || 0) * (p.avgCost || 0), 0);

    if (value > portfolio.peakValue) portfolio.peakValue = value;
    Storage.savePortfolio(portfolio);

    const riskState = RiskEngine.recalculatePnL(Storage.getTradeLog(), portfolio);
    Storage.saveRiskState({ ...Storage.getRiskState(), ...riskState });

    Portfolio.render();
    Utils.toast(`Account value updated to ${Utils.formatCurrency(value)}`, 'success');
  }
};
