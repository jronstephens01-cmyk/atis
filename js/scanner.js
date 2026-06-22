// scanner.js — Options Scanner + Paper Trading UI for ATIS Phase 2

const Scanner = {

  currentResults: [],
  selectedContract: null,

  init() {
    // Pipeline controls
    document.getElementById('runPipelineBtn')?.addEventListener('click', () => {
      const watchlist = Storage.getWatchlist().filter(t => !t.startsWith('^'));
      if (!watchlist.length) {
        Utils.toast('Add tickers to your watchlist first', 'warn');
        return;
      }
      Pipeline.run(watchlist);
    });

    // Scanner controls
    document.getElementById('runScanBtn')?.addEventListener('click', Scanner.runScan);
    document.getElementById('scanTickerBtn')?.addEventListener('click', Scanner.scanSingleTicker);

    // Paper trade modal
    document.getElementById('paperTradeModalClose')?.addEventListener('click', Scanner.closeTradeModal);
    document.getElementById('paperTradeModalCancel')?.addEventListener('click', Scanner.closeTradeModal);
    document.getElementById('paperTradeModalSave')?.addEventListener('click', Scanner.savePaperTrade);
    document.getElementById('closePaperTradeBtn')?.addEventListener('click', Scanner.showCloseTradeModal);
    document.getElementById('closeTradeModalClose')?.addEventListener('click', Scanner.closeCloseModal);
    document.getElementById('closeTradeConfirmBtn')?.addEventListener('click', Scanner.confirmCloseTrade);

    // Tab switcher inside scanner
    document.querySelectorAll('.scanner-tab[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scanner-tab[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Scanner.switchView(btn.dataset.view);
      });
    });

    // Default to pipeline view
    Scanner.switchView('pipeline');

    Scanner.renderPaperPositions();
    Scanner.renderPaperStats();
    Scanner.renderPaperHistory();
  },

  switchView(view) {
    document.querySelectorAll('.scanner-view').forEach(v => v.style.display = 'none');
    const el = document.getElementById(`scanner-view-${view}`);
    if (el) el.style.display = 'block';
  },

  async runScan() {
    const btn = document.getElementById('runScanBtn');
    const resultsEl = document.getElementById('scanResults');
    btn.disabled = true;
    btn.textContent = '↻ Scanning...';
    resultsEl.innerHTML = '<div class="loading-placeholder">Scanning watchlist for options setups...</div>';

    try {
      const watchlist = Storage.getWatchlist().filter(t => !t.startsWith('^'));
      if (!watchlist.length) {
        resultsEl.innerHTML = '<div class="empty-scan">Add tickers to your watchlist first.</div>';
        return;
      }

      const prefs = Storage.getPrefs();
      if (!prefs.workerUrl) {
        resultsEl.innerHTML = '<div class="empty-scan">Worker URL not configured. Set it in Agents tab.</div>';
        return;
      }

      // Fetch quotes first
      const res = await fetch(`${prefs.workerUrl}/api/market-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: watchlist, fields: ['quote'] })
      });
      const quoteData = await res.json();

      // Build scan results from available data
      const results = [];
      for (const ticker of watchlist) {
        const quote = quoteData.data?.[ticker];
        if (!quote) continue;

        const price = quote.regularMarketPrice || quote.price || 0;
        const change = quote.regularMarketChangePercent || quote.changePct || 0;
        const iv52High = quote.fiftyTwoWeekHigh || price * 1.3;
        const iv52Low  = quote.fiftyTwoWeekLow  || price * 0.7;

        // Estimate ATM options based on price
        // We generate synthetic near-ATM contracts since Yahoo free tier
        // doesn't reliably return options chain data
        const nearExpiry = getNextExpiry(21); // ~3 weeks out
        const farExpiry  = getNextExpiry(45); // ~6 weeks out

        const atmStrike = Math.round(price / 5) * 5; // Round to nearest $5
        const estimatedIV = 0.30; // Baseline estimate — real IV needs paid data

        const callContracts = [
          makeContract(ticker, price, atmStrike, nearExpiry, 'call', estimatedIV),
          makeContract(ticker, price, atmStrike * 1.02, nearExpiry, 'call', estimatedIV),
          makeContract(ticker, price, atmStrike, farExpiry, 'call', estimatedIV),
        ];

        const putContracts = [
          makeContract(ticker, price, atmStrike, nearExpiry, 'put', estimatedIV),
          makeContract(ticker, price, atmStrike * 0.98, nearExpiry, 'put', estimatedIV),
          makeContract(ticker, price, atmStrike, farExpiry, 'put', estimatedIV),
        ];

        results.push({
          ticker,
          price,
          change,
          calls: callContracts,
          puts: putContracts,
          iv: estimatedIV,
          note: 'IV estimated — connect options data provider for live Greeks'
        });

        Storage.cacheMarketData(ticker, { ...quote, ticker });
      }

      Scanner.currentResults = results;
      Scanner.renderScanResults(results);

    } catch (err) {
      resultsEl.innerHTML = `<div class="empty-scan">Scan failed: ${err.message}</div>`;
      Utils.toast('Scan failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Scan Watchlist';
    }
  },

  async scanSingleTicker() {
    const input = document.getElementById('singleTickerInput');
    const ticker = input?.value?.trim()?.toUpperCase();
    if (!ticker) { Utils.toast('Enter a ticker first', 'warn'); return; }
    input.value = ticker;

    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) { Utils.toast('Worker URL not set', 'warn'); return; }

    const btn = document.getElementById('scanTickerBtn');
    btn.disabled = true;
    btn.textContent = '↻';

    try {
      const res = await fetch(`${prefs.workerUrl}/api/market-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: [ticker], fields: ['quote'] })
      });
      const data = await res.json();
      const quote = data.data?.[ticker];
      if (!quote) throw new Error(`No data for ${ticker}`);

      const price = quote.regularMarketPrice || quote.price || 0;
      const change = quote.regularMarketChangePercent || 0;
      const estimatedIV = 0.30;
      const nearExpiry = getNextExpiry(21);
      const farExpiry  = getNextExpiry(45);
      const atmStrike  = Math.round(price / 5) * 5;

      const result = {
        ticker, price, change,
        calls: [
          makeContract(ticker, price, atmStrike, nearExpiry, 'call', estimatedIV),
          makeContract(ticker, price, atmStrike * 1.02, nearExpiry, 'call', estimatedIV),
          makeContract(ticker, price, atmStrike, farExpiry, 'call', estimatedIV),
        ],
        puts: [
          makeContract(ticker, price, atmStrike, nearExpiry, 'put', estimatedIV),
          makeContract(ticker, price, atmStrike * 0.98, nearExpiry, 'put', estimatedIV),
          makeContract(ticker, price, atmStrike, farExpiry, 'put', estimatedIV),
        ],
        iv: estimatedIV,
        note: 'IV estimated'
      };

      Scanner.currentResults = [result];
      Scanner.renderScanResults([result]);
      Storage.cacheMarketData(ticker, { ...quote, ticker });
    } catch (err) {
      Utils.toast(`Failed to scan ${ticker}: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '▶';
    }
  },

  renderScanResults(results) {
    const el = document.getElementById('scanResults');
    if (!results.length) {
      el.innerHTML = '<div class="empty-scan">No results. Add tickers to watchlist and run scan.</div>';
      return;
    }

    el.innerHTML = results.map(r => `
      <div class="scan-ticker-block">
        <div class="scan-ticker-header">
          <div class="scan-ticker-name">${r.ticker}</div>
          <div class="scan-ticker-price">$${r.price.toFixed(2)}</div>
          <div class="scan-ticker-change ${r.change >= 0 ? 'positive' : 'negative'}">${Utils.formatPercent(r.change)}</div>
          ${r.note ? `<div class="scan-ticker-note">⚠ ${r.note}</div>` : ''}
        </div>

        <div class="scan-contracts-grid">
          <div class="scan-contract-col">
            <div class="scan-col-label call-label">CALLS</div>
            ${r.calls.map(c => Scanner.renderContract(c, 'call')).join('')}
          </div>
          <div class="scan-contract-col">
            <div class="scan-col-label put-label">PUTS</div>
            ${r.puts.map(p => Scanner.renderContract(p, 'put')).join('')}
          </div>
        </div>
      </div>
    `).join('');
  },

  renderContract(c, type) {
    const deltaText = c.greeks?.delta ? c.greeks.delta.toFixed(2) : '—';
    const clsColor  = type === 'call' ? 'positive' : 'negative';

    return `
      <div class="contract-card" onclick="Scanner.openTradeModal(${JSON.stringify(c).replace(/"/g, '&quot;')})">
        <div class="contract-row">
          <span class="contract-strike">$${c.strike}</span>
          <span class="contract-expiry">${c.expiry}</span>
          <span class="contract-dte">${c.daysToExpiry}d</span>
        </div>
        <div class="contract-row">
          <span class="contract-premium ${clsColor}">$${c.premium.toFixed(2)}</span>
          <span class="contract-delta">Δ ${deltaText}</span>
          <span class="contract-iv">IV ${c.iv}%</span>
        </div>
        <div class="contract-row">
          <span class="contract-oi">OI: ${c.openInterest.toLocaleString()}</span>
          <span class="contract-moneyness ${c.moneynessLabel === 'ITM' ? clsColor : 'text-muted'}">${c.moneynessLabel}</span>
          <span class="contract-score" style="color:${Scoring.scoreColor(c.score * 6)}">★${c.score}/10</span>
        </div>
        <div class="contract-breakeven">BE: $${c.breakeven.toFixed(2)} | Max Loss: $${c.maxLoss.toFixed(0)}</div>
        <div class="contract-cta">+ Paper Trade</div>
      </div>
    `;
  },

  openTradeModal(contract) {
    Scanner.selectedContract = contract;
    const modal = document.getElementById('paperTradeModal');
    if (!modal) return;

    // Populate modal fields
    Utils.setText('ptTicker',   contract.ticker);
    Utils.setText('ptType',     contract.type.toUpperCase());
    Utils.setText('ptStrike',   `$${contract.strike}`);
    Utils.setText('ptExpiry',   contract.expiry);
    Utils.setText('ptDTE',      `${contract.daysToExpiry} days`);
    Utils.setText('ptPremium',  `$${contract.premium.toFixed(2)}`);
    Utils.setText('ptDelta',    contract.greeks?.delta?.toFixed(3) || '—');
    Utils.setText('ptIV',       `${contract.iv}%`);
    Utils.setText('ptBreakeven',`$${contract.breakeven.toFixed(2)}`);
    Utils.setText('ptMaxLoss',  `$${contract.maxLoss.toFixed(2)} per contract`);
    Utils.setText('ptOI',       contract.openInterest.toLocaleString());

    // Defaults
    document.getElementById('ptContracts').value = 1;
    document.getElementById('ptStopInput').value = Utils.round(contract.premium * 0.50, 2);
    document.getElementById('ptTargetInput').value = Utils.round(contract.premium * 2.0, 2);
    document.getElementById('ptThesisInput').value = '';

    // Update cost display
    Scanner.updateCostDisplay();

    modal.style.display = 'flex';
  },

  updateCostDisplay() {
    const contracts = parseInt(document.getElementById('ptContracts')?.value) || 1;
    const contract  = Scanner.selectedContract;
    if (!contract) return;

    const totalCost = Utils.round(contract.premium * 100 * contracts, 2);
    const portfolio = PaperTrading.getPaperPortfolio();

    Utils.setText('ptTotalCost', Utils.formatCurrency(totalCost));
    Utils.setText('ptCashAvail', Utils.formatCurrency(portfolio.cashAvailable));

    const costEl = document.getElementById('ptTotalCost');
    if (costEl) costEl.className = totalCost > portfolio.cashAvailable ? 'negative' : 'positive';
  },

  closeTradeModal() {
    const modal = document.getElementById('paperTradeModal');
    if (modal) modal.style.display = 'none';
    Scanner.selectedContract = null;
  },

  savePaperTrade() {
    const contract = Scanner.selectedContract;
    if (!contract) return;

    const contracts = parseInt(document.getElementById('ptContracts')?.value) || 1;
    const stop      = parseFloat(document.getElementById('ptStopInput')?.value) || null;
    const target    = parseFloat(document.getElementById('ptTargetInput')?.value) || null;
    const thesis    = document.getElementById('ptThesisInput')?.value?.trim() || '';

    const result = PaperTrading.openTrade({
      ticker:    contract.ticker,
      type:      contract.type,
      strike:    contract.strike,
      expiry:    contract.expiry,
      contracts,
      premium:   contract.premium,
      delta:     contract.greeks?.delta,
      iv:        contract.iv,
      thesis,
      stopLoss:  stop,
      target,
      score:     contract.score
    });

    if (!result.success) {
      Utils.toast(result.error, 'error');
      return;
    }

    Scanner.closeTradeModal();
    Scanner.renderPaperPositions();
    Scanner.renderPaperStats();
    Utils.toast(`Paper trade opened: ${contract.ticker} ${contract.type.toUpperCase()} $${contract.strike}`, 'success');

    // Switch to positions view
    document.querySelector('.scanner-tab[data-view="positions"]')?.click();
  },

  renderPaperPositions() {
    const portfolio = PaperTrading.getPaperPortfolio();
    const positions = portfolio.positions;
    const el = document.getElementById('paperPositionsBody');
    if (!el) return;

    if (!positions.length) {
      el.innerHTML = '<tr class="empty-row"><td colspan="10">No open paper positions. Run a scan and paper trade a setup.</td></tr>';
      return;
    }

    el.innerHTML = positions.map(p => {
      const unrealizedPL = p.unrealizedPL ?? 0;
      const unrealizedPct = p.unrealizedPLPct ?? 0;
      const fmtPL = Utils.formatPnL(unrealizedPL);
      const currentPremium = p.currentPremium || p.entryPremium;

      return `
        <tr>
          <td style="font-family:var(--font-mono);color:var(--text-muted)">${p.tradeId}</td>
          <td><strong style="color:var(--text-primary)">${p.ticker}</strong></td>
          <td style="color:${p.type==='call'?'var(--green)':'var(--red)'}">
            ${p.type.toUpperCase()}
          </td>
          <td style="font-family:var(--font-mono)">$${p.strike}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${p.expiry}</td>
          <td style="font-family:var(--font-mono)">${p.contracts}</td>
          <td style="font-family:var(--font-mono)">$${p.entryPremium.toFixed(2)}</td>
          <td style="font-family:var(--font-mono)">$${currentPremium.toFixed(2)}</td>
          <td class="${fmtPL.cls}" style="font-family:var(--font-mono)">
            ${fmtPL.text} (${Utils.formatPercent(unrealizedPct)})
          </td>
          <td>
            <button class="btn btn--secondary" style="font-size:10px;padding:4px 8px"
              onclick="Scanner.showCloseModal('${p.tradeId}')">
              Close
            </button>
          </td>
        </tr>`;
    }).join('');
  },

  showCloseModal(tradeId) {
    const portfolio = PaperTrading.getPaperPortfolio();
    const pos = portfolio.positions.find(p => p.tradeId === tradeId);
    if (!pos) return;

    const modal = document.getElementById('closeTradeModal');
    if (!modal) return;

    Utils.setText('ctTicker', `${pos.ticker} ${pos.type.toUpperCase()} $${pos.strike} ${pos.expiry}`);
    Utils.setText('ctEntry', `$${pos.entryPremium.toFixed(2)}`);
    Utils.setText('ctCost', Utils.formatCurrency(pos.totalCost));

    const exitInput = document.getElementById('ctExitPremium');
    if (exitInput) exitInput.value = (pos.currentPremium || pos.entryPremium).toFixed(2);

    document.getElementById('ctLessons').value = '';
    document.getElementById('ctExitReason').value = 'manual';

    // Store tradeId for confirm
    modal.dataset.tradeId = tradeId;
    modal.style.display = 'flex';
  },

  closeCloseModal() {
    const modal = document.getElementById('closeTradeModal');
    if (modal) modal.style.display = 'none';
  },

  confirmCloseTrade() {
    const modal = document.getElementById('closeTradeModal');
    if (!modal) return;

    const tradeId    = modal.dataset.tradeId;
    const exitPremium = parseFloat(document.getElementById('ctExitPremium')?.value);
    const reason     = document.getElementById('ctExitReason')?.value || 'manual';
    const lessons    = document.getElementById('ctLessons')?.value?.trim() || '';

    if (isNaN(exitPremium) || exitPremium < 0) {
      Utils.toast('Enter a valid exit premium', 'error');
      return;
    }

    const result = PaperTrading.closeTrade(tradeId, exitPremium, reason, lessons);

    if (!result.success) {
      Utils.toast(result.error, 'error');
      return;
    }

    const fmtPL = Utils.formatPnL(result.realizedPL);
    Utils.toast(
      `Trade closed: ${fmtPL.text} (${Utils.formatPercent(result.realizedPLPct)})`,
      result.realizedPL >= 0 ? 'success' : 'error'
    );

    Scanner.closeCloseModal();
    Scanner.renderPaperPositions();
    Scanner.renderPaperStats();
    Scanner.renderPaperHistory();
  },

  renderPaperStats() {
    const stats    = PaperTrading.getStats();
    const portfolio = PaperTrading.getPaperPortfolio();

    Utils.setText('paperValue',    Utils.formatCurrency(portfolio.currentValue));
    Utils.setText('paperCash',     Utils.formatCurrency(portfolio.cashAvailable));
    Utils.setText('paperTotalPL',  `${stats.totalPL >= 0 ? '+' : ''}${Utils.formatCurrency(stats.totalPL)} (${Utils.formatPercent(stats.totalPLPct)})`);
    Utils.setText('paperTrades',   stats.totalTrades);
    Utils.setText('paperWinRate',  stats.totalTrades ? `${stats.winRate}%` : '—');
    Utils.setText('paperPF',       stats.profitFactor || '—');
    Utils.setText('paperExpectancy', stats.totalTrades ? `${stats.expectancy}%` : '—');
    Utils.setText('paperOpenPos',  stats.openPositions);

    const plEl = document.getElementById('paperTotalPL');
    if (plEl) plEl.className = `stat-value ${stats.totalPL >= 0 ? 'positive' : 'negative'}`;
  },

  renderPaperHistory() {
    const trades = PaperTrading.getPaperTrades().filter(t => t.status === 'closed');
    const el = document.getElementById('paperHistoryBody');
    if (!el) return;

    if (!trades.length) {
      el.innerHTML = '<tr class="empty-row"><td colspan="9">No closed paper trades yet.</td></tr>';
      return;
    }

    el.innerHTML = trades.map(t => {
      const fmtPL = Utils.formatPnL(t.realizedPL);
      const badge = t.result === 'win'
        ? '<span class="win-badge">WIN</span>'
        : '<span class="loss-badge">LOSS</span>';

      return `
        <tr>
          <td style="font-family:var(--font-mono);color:var(--text-muted)">${t.tradeId}</td>
          <td>${Utils.formatDateShort(t.openDate)}</td>
          <td><strong style="color:var(--text-primary)">${t.ticker}</strong></td>
          <td style="color:${t.type==='call'?'var(--green)':'var(--red)'}">${t.type.toUpperCase()}</td>
          <td style="font-family:var(--font-mono)">$${t.strike} / ${t.expiry}</td>
          <td style="font-family:var(--font-mono)">$${t.entryPremium.toFixed(2)} → $${(t.exitPremium||0).toFixed(2)}</td>
          <td class="${fmtPL.cls}" style="font-family:var(--font-mono)">${fmtPL.text}</td>
          <td class="${fmtPL.cls}" style="font-family:var(--font-mono)">${Utils.formatPercent(t.realizedPLPct||0)}</td>
          <td>${badge}</td>
        </tr>`;
    }).join('');
  }
};

// ============================================================
// HELPERS
// ============================================================

function getNextExpiry(daysOut) {
  const now = new Date();
  // Find next Friday at or after daysOut
  const target = new Date(now.getTime() + daysOut * 24 * 60 * 60 * 1000);
  const day = target.getDay();
  const daysToFriday = day <= 5 ? 5 - day : 6;
  target.setDate(target.getDate() + daysToFriday);
  return target.toISOString().split('T')[0];
}

function makeContract(ticker, underlyingPrice, strike, expiry, type, iv) {
  strike = Math.round(strike * 100) / 100;
  const daysToExp = Options.daysToExpiry(expiry);
  const T = daysToExp / 365;
  const greeks = Options.blackScholes(underlyingPrice, strike, T, 0.05, iv, type);
  const premium = greeks ? Math.max(Utils.round(greeks.price, 2), 0.01) : 0.50;

  // Simulate OI and spread
  const moneyness = Math.abs(underlyingPrice - strike) / underlyingPrice;
  const oi = Math.round(1000 + Math.random() * 2000 - moneyness * 3000);
  const spread = Utils.round(premium * 0.03, 2);

  return {
    ticker,
    type,
    strike,
    expiry,
    premium,
    bid: Math.max(Utils.round(premium - spread, 2), 0.01),
    ask: Utils.round(premium + spread, 2),
    openInterest: Math.max(oi, 100),
    iv: Math.round(iv * 100),
    daysToExpiry: daysToExp,
    greeks,
    bidAskSpread: Utils.round((spread * 2 / premium) * 100, 1),
    liquidityOk: oi >= 500,
    liquidityFlags: oi < 500 ? [`Low OI: ${oi}`] : [],
    breakeven: type === 'call'
      ? Utils.round(strike + premium, 2)
      : Utils.round(strike - premium, 2),
    maxLoss: Utils.round(premium * 100, 2),
    moneynessLabel: (() => {
      if (moneyness < 0.01) return 'ATM';
      if (type === 'call') return underlyingPrice > strike ? 'ITM' : 'OTM';
      return underlyingPrice < strike ? 'ITM' : 'OTM';
    })(),
    score: Math.min(10, Math.round(6 + (oi > 1000 ? 1 : 0) + (daysToExp >= 14 && daysToExp <= 45 ? 1 : 0) + (moneyness < 0.05 ? 1 : 0)))
  };
}
