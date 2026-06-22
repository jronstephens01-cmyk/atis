// dashboard.js — Market Overview tab

const Dashboard = {

  WORKER_URL: '', // Set from Storage.getPrefs().workerUrl

  async init() {
    Dashboard.WORKER_URL = Storage.getPrefs().workerUrl || '';
    document.getElementById('refreshMarket').addEventListener('click', () => Dashboard.refresh());

    // Load cached data first (instant display)
    Dashboard.renderFromCache();
  },

  renderFromCache() {
    const watchlist = Storage.getWatchlist();
    const portfolio = Storage.getPortfolio();
    const riskState = Storage.getRiskState();
    const macroState = Storage.getCachedMacroState();

    // Portfolio snapshot
    Dashboard.renderAccountSnapshot(portfolio, riskState);

    // Macro regime from cache
    if (macroState) {
      Dashboard.renderRegimeBanner(macroState);
    }

    // Index prices from cache
    ['SPY', 'QQQ', 'IWM', '^VIX'].forEach(ticker => {
      const data = Storage.getCachedMarketData(ticker);
      if (data) Dashboard.renderIndexCard(ticker, data);
    });

    // Sector data from cache
    const sectorData = Utils.SECTOR_ETFS.map(etf => Storage.getCachedMarketData(etf)).filter(Boolean);
    if (sectorData.length > 0) Dashboard.renderSectors(sectorData);
  },

  async refresh() {
    const btn = document.getElementById('refreshMarket');
    btn.disabled = true;
    btn.textContent = '↻ Loading...';
    Utils.setText('marketFreshness', 'Fetching...');

    try {
      if (!Dashboard.WORKER_URL) {
        // Show setup instructions
        Dashboard.showWorkerSetupPrompt();
        return;
      }

      // Fetch indices + sectors
      const tickers = ['SPY', 'QQQ', 'IWM', '^VIX', ...Utils.SECTOR_ETFS];
      const data = await Dashboard.fetchQuotes(tickers);

      // Render indices
      ['SPY', 'QQQ', 'IWM', '^VIX'].forEach(ticker => {
        if (data[ticker]) {
          Storage.cacheMarketData(ticker, data[ticker]);
          Dashboard.renderIndexCard(ticker, data[ticker]);
        }
      });

      // Render sectors
      const sectorData = Utils.SECTOR_ETFS.map(etf => data[etf]).filter(Boolean);
      if (sectorData.length > 0) {
        sectorData.forEach(d => Storage.cacheMarketData(d.ticker, d));
        Dashboard.renderSectors(sectorData);
        Storage.updateHealth('yahoo', 'live', 'Market data fetched successfully');
      }

      Utils.setText('marketFreshness', 'Updated ' + Utils.formatTime(Date.now()));
      Utils.el('statusMarket').querySelector('.dot').className = 'dot dot--ok';

    } catch (err) {
      console.error('Market data fetch error:', err);
      Utils.toast('Failed to fetch market data. Check Worker URL in settings.', 'error');
      Utils.setText('marketFreshness', 'Fetch failed');
      Storage.updateHealth('yahoo', 'error', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Refresh';
    }
  },

  async fetchQuotes(tickers) {
    const res = await fetch(`${Dashboard.WORKER_URL}/api/market-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, fields: ['quote'] })
    });
    if (!res.ok) throw new Error(`Worker error: ${res.status}`);
    const json = await res.json();
    return json.data || {};
  },

  renderIndexCard(ticker, data) {
    const cardId = `card-${ticker.replace('^', '').toLowerCase()}`;
    const card = document.getElementById(cardId);
    if (!card) return;

    const price = data.regularMarketPrice || data.price || 0;
    const change = data.regularMarketChangePercent || data.changePct || 0;
    const changeAmt = data.regularMarketChange || data.change || 0;

    const priceEl  = card.querySelector('.index-price');
    const changeEl = card.querySelector('.index-change');

    if (priceEl) priceEl.textContent = price.toFixed(2);
    if (changeEl) {
      const fmt = Utils.formatChange(change);
      changeEl.textContent = `${fmt.text} (${changeAmt >= 0 ? '+' : ''}${changeAmt.toFixed(2)})`;
      changeEl.className = `index-change ${fmt.cls}`;
    }
  },

  renderSectors(sectorDataArray) {
    const grid = document.getElementById('sectorGrid');
    if (!grid) return;

    // Sort by change percent descending
    const sorted = [...sectorDataArray].sort((a, b) => {
      const pctA = a.regularMarketChangePercent || a.changePct || 0;
      const pctB = b.regularMarketChangePercent || b.changePct || 0;
      return pctB - pctA;
    });

    const maxAbs = Math.max(...sorted.map(d => Math.abs(d.regularMarketChangePercent || d.changePct || 0)));

    grid.innerHTML = sorted.map(d => {
      const ticker = d.ticker || d.symbol;
      const pct = d.regularMarketChangePercent || d.changePct || 0;
      const name = Utils.SECTORS[ticker] || ticker;
      const barWidth = maxAbs > 0 ? Math.abs(pct) / maxAbs * 100 : 0;
      const cls = pct >= 0 ? 'positive' : 'negative';

      return `
        <div class="sector-row">
          <span class="sector-ticker">${ticker}</span>
          <span class="sector-name">${name}</span>
          <div class="sector-bar-wrap">
            <div class="sector-bar-fill ${cls}" style="width:${barWidth.toFixed(1)}%"></div>
          </div>
          <span class="sector-pct ${cls}">${Utils.formatPercent(pct)}</span>
        </div>
      `;
    }).join('');
  },

  renderRegimeBanner(macroState) {
    const banner = document.getElementById('regimeBanner');
    if (!banner) return;

    const regime = macroState.regime || 'Unknown';
    const score = macroState.totalScore || 0;
    const cls = Utils.regimeClass(regime);

    banner.className = `regime-banner ${cls}`;
    Utils.setText('regimeValue', regime.toUpperCase());
    Utils.setText('regimeScoreText', `${score}/50`);
    Utils.setStyle('regimeBarFill', 'width', `${(score / 50) * 100}%`);
  },

  renderAccountSnapshot(portfolio, riskState) {
    Utils.setText('snapValue', Utils.formatCurrency(portfolio.currentValue));
    Utils.setText('snapCash', Utils.formatCurrency(portfolio.cashAvailable));

    const drawdown = RiskEngine.calcDrawdown(portfolio.currentValue, portfolio.peakValue);
    const ddEl = document.getElementById('snapDrawdown');
    if (ddEl) {
      ddEl.textContent = Utils.formatPercent(drawdown.percent);
      ddEl.className = `stat-value ${drawdown.percent < -5 ? 'negative' : drawdown.percent < 0 ? '' : 'positive'}`;
    }

    // Update header
    Utils.setText('headerAccountValue', Utils.formatCurrency(portfolio.currentValue));
    const pnl = riskState.dailyPL || 0;
    const pnlEl = document.getElementById('headerDailyPnl');
    if (pnlEl) {
      const fmt = Utils.formatPnL(pnl);
      pnlEl.textContent = fmt.text;
      pnlEl.className = `account-pnl ${fmt.cls}`;
    }
  },

  showWorkerSetupPrompt() {
    const workerUrl = prompt(
      'Enter your Cloudflare Worker URL to enable live market data:\n(e.g. https://atis-worker.yourname.workers.dev)',
      Storage.getPrefs().workerUrl || ''
    );
    if (workerUrl) {
      const prefs = Storage.getPrefs();
      prefs.workerUrl = workerUrl.trim().replace(/\/$/, '');
      Storage.savePrefs(prefs);
      Dashboard.WORKER_URL = prefs.workerUrl;
      Utils.toast('Worker URL saved. Refreshing...', 'success');
      Dashboard.refresh();
    }
  }
};
