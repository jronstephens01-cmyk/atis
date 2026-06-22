// backtest-ui.js — Backtesting Tab UI for ATIS Phase 4

const BacktestUI = {

  init() {
    document.getElementById('runBacktestBtn')?.addEventListener('click', BacktestUI.runBacktest);
    document.getElementById('backtestStrategy')?.addEventListener('change', BacktestUI.updateStrategyDesc);
    BacktestUI.populateStrategies();
    BacktestUI.renderResults();
  },

  populateStrategies() {
    const select = document.getElementById('backtestStrategy');
    if (!select) return;

    select.innerHTML = Object.entries(Backtest.STRATEGIES).map(([key, s]) =>
      `<option value="${key}">${s.name}</option>`
    ).join('');

    BacktestUI.updateStrategyDesc();
  },

  updateStrategyDesc() {
    const key = document.getElementById('backtestStrategy')?.value;
    const desc = document.getElementById('strategyDesc');
    if (desc && key && Backtest.STRATEGIES[key]) {
      desc.textContent = Backtest.STRATEGIES[key].description;
    }
  },

  async runBacktest() {
    const strategyKey = document.getElementById('backtestStrategy')?.value;
    const startDate   = document.getElementById('backtestStart')?.value;
    const endDate     = document.getElementById('backtestEnd')?.value;
    const portfolio   = Storage.getPortfolio();

    if (!strategyKey || !startDate || !endDate) {
      Utils.toast('Fill in all fields first', 'warn');
      return;
    }

    if (startDate >= endDate) {
      Utils.toast('End date must be after start date', 'error');
      return;
    }

    const watchlist = Storage.getWatchlist().filter(t => !t.startsWith('^'));
    if (!watchlist.length) {
      Utils.toast('Add tickers to watchlist first', 'warn');
      return;
    }

    const btn = document.getElementById('runBacktestBtn');
    btn.disabled = true;
    btn.textContent = '↻ Running...';

    const progressEl = document.getElementById('backtestProgress');
    const resultsEl  = document.getElementById('backtestResultsArea');

    if (progressEl) progressEl.style.display = 'block';
    if (resultsEl)  resultsEl.innerHTML = '';

    try {
      const results = await Backtest.run({
        strategyName: Backtest.STRATEGIES[strategyKey].name,
        tickers: watchlist.slice(0, 5), // Max 5 tickers per backtest
        startDate,
        endDate,
        strategy: Backtest.STRATEGIES[strategyKey],
        accountSize: portfolio.currentValue,
        onProgress: (msg, pct) => {
          const bar  = document.getElementById('backtestProgressBar');
          const text = document.getElementById('backtestProgressText');
          if (bar)  bar.style.width  = `${pct}%`;
          if (text) text.textContent = msg;
        }
      });

      if (progressEl) progressEl.style.display = 'none';
      BacktestUI.renderBacktestResults(results);

    } catch (err) {
      if (progressEl) progressEl.style.display = 'none';
      Utils.toast(`Backtest failed: ${err.message}`, 'error');
      if (resultsEl) resultsEl.innerHTML = `<div class="bt-error">Error: ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Run Backtest';
    }
  },

  renderBacktestResults(results) {
    const el = document.getElementById('backtestResultsArea');
    if (!el) return;

    const m  = results.metrics;
    const mc = results.monteCarlo;

    if (!m || m.totalTrades === 0) {
      el.innerHTML = '<div class="bt-error">No trades generated. Try a wider date range or different tickers.</div>';
      return;
    }

    const passColor  = color => `style="color:${color}"`;
    const pfColor    = m.profitFactor >= 1.5 ? 'var(--green)' : m.profitFactor >= 1.0 ? 'var(--amber)' : 'var(--red)';
    const wrColor    = m.winRate >= 50 ? 'var(--green)' : m.winRate >= 40 ? 'var(--amber)' : 'var(--red)';
    const ddColor    = m.maxDrawdown <= 15 ? 'var(--green)' : m.maxDrawdown <= 25 ? 'var(--amber)' : 'var(--red)';
    const retColor   = m.totalReturnPct >= 0 ? 'var(--green)' : 'var(--red)';
    const mcColor    = mc?.positivePercent >= 60 ? 'var(--green)' : mc?.positivePercent >= 40 ? 'var(--amber)' : 'var(--red)';

    el.innerHTML = `
      <div class="bt-results">

        <div class="bt-header">
          <div class="bt-title">${results.strategyName}</div>
          <div class="bt-subtitle">${results.startDate} → ${results.endDate} | ${results.tickers.join(', ')}</div>
        </div>

        <!-- Key Metrics -->
        <div class="bt-metrics-grid">
          <div class="bt-metric">
            <div class="bt-metric-label">Total Return</div>
            <div class="bt-metric-value" ${passColor(retColor)}>${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct}%</div>
            <div class="bt-metric-sub">${Utils.formatCurrency(m.totalReturn)}</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Win Rate</div>
            <div class="bt-metric-value" ${passColor(wrColor)}>${m.winRate}%</div>
            <div class="bt-metric-sub">${m.wins}W / ${m.losses}L</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Profit Factor</div>
            <div class="bt-metric-value" ${passColor(pfColor)}>${m.profitFactor}</div>
            <div class="bt-metric-sub">Min: 1.3</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Max Drawdown</div>
            <div class="bt-metric-value" ${passColor(ddColor)}>-${m.maxDrawdown}%</div>
            <div class="bt-metric-sub">Max: 25%</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Sharpe Ratio</div>
            <div class="bt-metric-value">${m.sharpeRatio}</div>
            <div class="bt-metric-sub">Min: 0.5</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Expectancy</div>
            <div class="bt-metric-value" ${passColor(m.expectancy >= 0 ? 'var(--green)' : 'var(--red)')}>${m.expectancy}%</div>
            <div class="bt-metric-sub">Per trade</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Worst Streak</div>
            <div class="bt-metric-value">${m.worstStreak} losses</div>
            <div class="bt-metric-sub">Consecutive</div>
          </div>
          <div class="bt-metric">
            <div class="bt-metric-label">Total Trades</div>
            <div class="bt-metric-value">${m.totalTrades}</div>
            <div class="bt-metric-sub">Avg: ${Utils.formatCurrency(m.avgTrade)}</div>
          </div>
        </div>

        <!-- Validation -->
        <div class="bt-section">
          <div class="bt-section-title">STRATEGY VALIDATION</div>
          <div class="bt-validation-grid">
            ${BacktestUI.validationRow('Win Rate ≥ 40%',      m.winRate >= 40,      `${m.winRate}%`)}
            ${BacktestUI.validationRow('Profit Factor ≥ 1.3', m.profitFactor >= 1.3, m.profitFactor)}
            ${BacktestUI.validationRow('Expectancy > 0',      m.expectancy > 0,      `${m.expectancy}%`)}
            ${BacktestUI.validationRow('Sharpe Ratio ≥ 0.5',  m.sharpeRatio >= 0.5,  m.sharpeRatio)}
            ${BacktestUI.validationRow('Max Drawdown < 25%',  m.maxDrawdown < 25,    `-${m.maxDrawdown}%`)}
            ${BacktestUI.validationRow('Min 10 Trades',       m.totalTrades >= 10,   m.totalTrades)}
          </div>
          <div class="bt-verdict ${BacktestUI.getVerdict(m) === 'VALIDATED' ? 'verdict--pass' : BacktestUI.getVerdict(m) === 'MARGINAL' ? 'verdict--warn' : 'verdict--fail'}">
            ${BacktestUI.getVerdict(m)}
          </div>
        </div>

        <!-- Period Breakdown -->
        ${results.periodBreakdown.length ? `
        <div class="bt-section">
          <div class="bt-section-title">YEAR BY YEAR</div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead><tr><th>Year</th><th>Trades</th><th>Win Rate</th><th>P&L</th><th>Assessment</th></tr></thead>
              <tbody>
                ${results.periodBreakdown.map(p => `
                  <tr>
                    <td>${p.period}</td>
                    <td>${p.trades}</td>
                    <td class="${p.winRate >= 50 ? 'positive' : p.winRate >= 40 ? '' : 'negative'}">${p.winRate}%</td>
                    <td class="${p.totalPL >= 0 ? 'positive' : 'negative'}">${p.totalPL >= 0 ? '+' : ''}${Utils.formatCurrency(p.totalPL)}</td>
                    <td class="${p.assessment === 'positive' ? 'positive' : 'negative'}">${p.assessment.toUpperCase()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}

        <!-- Out of Sample -->
        ${results.outOfSample?.metrics ? `
        <div class="bt-section">
          <div class="bt-section-title">OUT-OF-SAMPLE TEST (Last 20%)</div>
          <div class="bt-oos-grid">
            <div class="bt-oos-item"><span class="bt-oos-label">Trades</span><span class="bt-oos-val">${results.outOfSample.metrics.totalTrades}</span></div>
            <div class="bt-oos-item"><span class="bt-oos-label">Win Rate</span><span class="bt-oos-val ${results.outOfSample.metrics.winRate >= 40 ? 'positive' : 'negative'}">${results.outOfSample.metrics.winRate}%</span></div>
            <div class="bt-oos-item"><span class="bt-oos-label">Return</span><span class="bt-oos-val ${results.outOfSample.metrics.totalReturnPct >= 0 ? 'positive' : 'negative'}">${results.outOfSample.metrics.totalReturnPct}%</span></div>
            <div class="bt-oos-item"><span class="bt-oos-label">Consistent</span><span class="bt-oos-val ${results.outOfSample.consistent ? 'positive' : 'negative'}">${results.outOfSample.consistent ? 'YES' : 'LOW SAMPLE'}</span></div>
          </div>
        </div>
        ` : ''}

        <!-- Monte Carlo -->
        ${mc && !mc.insufficient ? `
        <div class="bt-section">
          <div class="bt-section-title">MONTE CARLO (${mc.iterations} simulations)</div>
          <div class="bt-mc-grid">
            <div class="bt-metric">
              <div class="bt-metric-label">Profitable Outcomes</div>
              <div class="bt-metric-value" ${passColor(mcColor)}>${mc.positivePercent}%</div>
            </div>
            <div class="bt-metric">
              <div class="bt-metric-label">Median Final</div>
              <div class="bt-metric-value">${Utils.formatCurrency(mc.medianFinalEquity)}</div>
            </div>
            <div class="bt-metric">
              <div class="bt-metric-label">10th Percentile</div>
              <div class="bt-metric-value negative">${Utils.formatCurrency(mc.p10)}</div>
            </div>
            <div class="bt-metric">
              <div class="bt-metric-label">90th Percentile</div>
              <div class="bt-metric-value positive">${Utils.formatCurrency(mc.p90)}</div>
            </div>
          </div>
          <div class="bt-verdict ${mc.verdict === 'viable' ? 'verdict--pass' : 'verdict--warn'}">
            MONTE CARLO: ${mc.verdict.toUpperCase()}
          </div>
        </div>
        ` : ''}

        <!-- Trade List -->
        ${results.trades.length ? `
        <div class="bt-section">
          <div class="bt-section-title">TRADE LOG (${results.trades.length} trades)</div>
          <div class="table-wrapper" style="max-height:300px;overflow-y:auto">
            <table class="data-table">
              <thead><tr><th>Ticker</th><th>Entry</th><th>Exit</th><th>Entry $</th><th>Exit $</th><th>Shares</th><th>P&L $</th><th>P&L %</th><th>Reason</th></tr></thead>
              <tbody>
                ${results.trades.map(t => `
                  <tr>
                    <td>${t.ticker}</td>
                    <td style="font-size:10px">${t.entryDate}</td>
                    <td style="font-size:10px">${t.exitDate}</td>
                    <td>$${t.entryPrice}</td>
                    <td>$${t.exitPrice}</td>
                    <td>${t.positionSize}</td>
                    <td class="${t.dollarPL >= 0 ? 'positive' : 'negative'}">${t.dollarPL >= 0 ? '+' : ''}$${t.dollarPL}</td>
                    <td class="${t.percentPL >= 0 ? 'positive' : 'negative'}">${t.percentPL >= 0 ? '+' : ''}${t.percentPL}%</td>
                    <td style="font-size:10px;color:var(--text-muted)">${t.exitReason}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}

      </div>
    `;
  },

  validationRow(label, passed, value) {
    return `
      <div class="bt-val-row">
        <span class="bt-val-label">${label}</span>
        <span class="bt-val-result">${value}</span>
        <span class="${passed ? 'positive' : 'negative'}">${passed ? '✓' : '✕'}</span>
      </div>
    `;
  },

  getVerdict(m) {
    const checks = [
      m.winRate >= 40,
      m.profitFactor >= 1.3,
      m.expectancy > 0,
      m.sharpeRatio >= 0.5,
      m.maxDrawdown < 25,
      m.totalTrades >= 10
    ];
    const passed = checks.filter(Boolean).length;
    if (passed === 6) return 'VALIDATED';
    if (passed >= 4) return 'MARGINAL';
    return 'NOT VALIDATED';
  },

  renderResults() {
    const stored = Backtest.getResults();
    const select = document.getElementById('savedBacktests');
    if (!select) return;

    const keys = Object.keys(stored);
    if (!keys.length) {
      select.innerHTML = '<option value="">No saved backtests</option>';
      return;
    }

    select.innerHTML = '<option value="">Load saved backtest...</option>' +
      keys.map(k => `<option value="${k}">${k} (${new Date(stored[k].timestamp).toLocaleDateString()})</option>`).join('');

    select.onchange = () => {
      if (select.value) BacktestUI.renderBacktestResults(stored[select.value]);
    };
  }
};
