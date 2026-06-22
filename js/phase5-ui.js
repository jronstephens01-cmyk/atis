// phase5-ui.js — Phase 5 Validation UI

const Phase5UI = {

  init() {
    // Close trade modal
    document.getElementById('closePaperOptBtn')?.addEventListener('click', Phase5UI.showCloseModal);
    document.getElementById('closeOptModalClose')?.addEventListener('click', Phase5UI.hideCloseModal);
    document.getElementById('closeOptConfirmBtn')?.addEventListener('click', Phase5UI.confirmClose);

    Phase5UI.render();
  },

  render() {
    Phase5UI.renderProgress();
    Phase5UI.renderOpenTrades();
    Phase5UI.renderHistory();
  },

  // ============================================================
  // PROGRESS DASHBOARD
  // ============================================================
  renderProgress() {
    const report = Phase5.getProgressReport();
    const el = document.getElementById('phase5Progress');
    if (!el) return;

    const dayPct  = Math.min((report.daysElapsed / 90) * 100, 100);
    const tradePct = Math.min((report.closedTrades / 20) * 100, 100);

    el.innerHTML = `
      <div class="p5-header">
        <div class="p5-title">PHASE 5 — PAPER TRADING VALIDATION</div>
        <div class="p5-subtitle">90-day validation period to unlock real money trading (Phase 6)</div>
      </div>

      <!-- Progress Bars -->
      <div class="p5-progress-grid">
        <div class="p5-progress-item">
          <div class="p5-progress-label">
            <span>Days Elapsed</span>
            <span class="${report.daysElapsed >= 90 ? 'positive' : ''}">${report.daysElapsed} / 90 days</span>
          </div>
          <div class="p5-bar-wrap">
            <div class="p5-bar-fill" style="width:${dayPct}%;background:${report.daysElapsed >= 90 ? 'var(--green)' : 'var(--cyan)'}"></div>
          </div>
        </div>
        <div class="p5-progress-item">
          <div class="p5-progress-label">
            <span>Trades Completed</span>
            <span class="${report.closedTrades >= 20 ? 'positive' : ''}">${report.closedTrades} / 20 minimum</span>
          </div>
          <div class="p5-bar-wrap">
            <div class="p5-bar-fill" style="width:${tradePct}%;background:${report.closedTrades >= 20 ? 'var(--green)' : 'var(--cyan)'}"></div>
          </div>
        </div>
      </div>

      <!-- Stats Row -->
      <div class="p5-stats-row">
        <div class="p5-stat">
          <div class="p5-stat-label">Open Trades</div>
          <div class="p5-stat-value">${report.openTrades}</div>
        </div>
        <div class="p5-stat">
          <div class="p5-stat-label">Win Rate</div>
          <div class="p5-stat-value ${report.winRate >= 45 ? 'positive' : report.closedTrades < 5 ? '' : 'negative'}">${report.closedTrades ? report.winRate + '%' : '—'}</div>
        </div>
        <div class="p5-stat">
          <div class="p5-stat-label">Profit Factor</div>
          <div class="p5-stat-value ${report.profitFactor >= 1.3 ? 'positive' : report.closedTrades < 5 ? '' : 'negative'}">${report.closedTrades ? report.profitFactor : '—'}</div>
        </div>
        <div class="p5-stat">
          <div class="p5-stat-label">Total P&L</div>
          <div class="p5-stat-value ${report.totalPL >= 0 ? 'positive' : 'negative'}">${Utils.formatCurrency(report.totalPL)}</div>
        </div>
        <div class="p5-stat">
          <div class="p5-stat-label">Days Left</div>
          <div class="p5-stat-value">${report.daysRemaining}</div>
        </div>
      </div>

      <!-- Requirements Checklist -->
      <div class="p5-checklist">
        <div class="p5-checklist-title">PHASE 6 REQUIREMENTS</div>
        ${Phase5UI.renderRequirement('90 Days Elapsed', report.requirements.minDays)}
        ${Phase5UI.renderRequirement('20+ Trades Completed', report.requirements.minTrades)}
        ${Phase5UI.renderRequirement('Win Rate ≥ 45%', report.requirements.minWinRate)}
        ${Phase5UI.renderRequirement('Profit Factor ≥ 1.3', report.requirements.minProfitFactor)}
        ${Phase5UI.renderRequirement('No Rule Violations', report.requirements.noViolations)}
      </div>

      <!-- Phase 6 Banner -->
      ${report.phase6Unlocked ? `
        <div class="p5-unlocked">
          🎉 PHASE 6 UNLOCKED — All requirements met. You are ready for real money assisted trading.
        </div>
      ` : `
        <div class="p5-locked">
          🔒 Phase 6 locked — Complete all requirements above to unlock real money trading.
        </div>
      `}

      <!-- Checkpoints -->
      <div class="p5-checkpoints">
        ${Phase5UI.renderCheckpoint('30 Day', report.checkpoints.day30, report.daysElapsed >= 30)}
        ${Phase5UI.renderCheckpoint('60 Day', report.checkpoints.day60, report.daysElapsed >= 60)}
        ${Phase5UI.renderCheckpoint('90 Day', report.checkpoints.day90, report.daysElapsed >= 90)}
      </div>
    `;
  },

  renderRequirement(label, req) {
    const value = typeof req.current === 'boolean'
      ? (req.current ? 'Yes' : 'No')
      : req.current;
    return `
      <div class="p5-req-row">
        <span class="p5-req-icon">${req.met ? '✅' : '⏳'}</span>
        <span class="p5-req-label">${label}</span>
        <span class="p5-req-value ${req.met ? 'positive' : ''}">${value}</span>
      </div>
    `;
  },

  renderCheckpoint(label, checkpoint, reached) {
    return `
      <div class="p5-checkpoint ${reached ? 'p5-checkpoint--reached' : ''}">
        <div class="p5-checkpoint-icon">${reached ? '✓' : '○'}</div>
        <div class="p5-checkpoint-label">${label} Review</div>
        <div class="p5-checkpoint-date">${checkpoint.date || 'Pending'}</div>
      </div>
    `;
  },

  // ============================================================
  // OPEN TRADES TABLE
  // ============================================================
  renderOpenTrades() {
    const trades = Phase5.getPaperTrades().filter(t => t.status === 'open');
    const el = document.getElementById('phase5OpenTrades');
    if (!el) return;

    if (!trades.length) {
      el.innerHTML = '<tr class="empty-row"><td colspan="11">No open paper options trades. Run the AI Pipeline — qualified setups auto-log here.</td></tr>';
      return;
    }

    el.innerHTML = trades.map(t => {
      const unrealizedPL = t.currentPremium
        ? Utils.round((t.currentPremium - t.entryPremium) * 100 * t.contracts, 2)
        : 0;
      const fmtPL = Utils.formatPnL(unrealizedPL);
      const daysLeft = t.expiry
        ? Math.max(0, Math.ceil((new Date(t.expiry) - new Date()) / (1000 * 60 * 60 * 24)))
        : '—';

      return `
        <tr>
          <td style="font-family:var(--font-mono);color:var(--text-muted)">${t.tradeId}</td>
          <td><strong style="color:var(--text-primary)">${t.ticker}</strong></td>
          <td style="color:${t.type === 'call' ? 'var(--green)' : 'var(--red)'}">${t.type.toUpperCase()}</td>
          <td style="font-family:var(--font-mono)">$${t.strike}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${t.expiry}</td>
          <td style="font-family:var(--font-mono);color:${daysLeft <= 7 ? 'var(--red)' : daysLeft <= 14 ? 'var(--amber)' : 'var(--text-secondary)'}">${daysLeft}d</td>
          <td style="font-family:var(--font-mono)">${t.contracts}</td>
          <td style="font-family:var(--font-mono)">$${t.entryPremium.toFixed(2)}</td>
          <td style="font-family:var(--font-mono)">$${(t.currentPremium || t.entryPremium).toFixed(2)}</td>
          <td class="${fmtPL.cls}" style="font-family:var(--font-mono)">${fmtPL.text}</td>
          <td>
            <button class="btn btn--secondary" style="font-size:10px;padding:4px 8px"
              onclick="Phase5UI.showCloseModalFor('${t.tradeId}')">
              Close
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  // ============================================================
  // HISTORY TABLE
  // ============================================================
  renderHistory() {
    const trades = Phase5.getPaperTrades().filter(t => t.status === 'closed');
    const el = document.getElementById('phase5History');
    if (!el) return;

    if (!trades.length) {
      el.innerHTML = '<tr class="empty-row"><td colspan="10">No closed paper options trades yet.</td></tr>';
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
          <td style="color:${t.type === 'call' ? 'var(--green)' : 'var(--red)'}">${t.type.toUpperCase()}</td>
          <td style="font-family:var(--font-mono)">$${t.strike} / ${t.expiry}</td>
          <td style="font-family:var(--font-mono)">${t.contracts}</td>
          <td style="font-family:var(--font-mono)">$${t.entryPremium.toFixed(2)} → $${(t.exitPremium || 0).toFixed(2)}</td>
          <td class="${fmtPL.cls}" style="font-family:var(--font-mono)">${fmtPL.text}</td>
          <td class="${fmtPL.cls}" style="font-family:var(--font-mono)">${Utils.formatPercent(t.realizedPLPct || 0)}</td>
          <td>${badge}</td>
        </tr>
      `;
    }).join('');
  },

  // ============================================================
  // CLOSE TRADE MODAL
  // ============================================================
  showCloseModalFor(tradeId) {
    const trades = Phase5.getPaperTrades();
    const trade = trades.find(t => t.tradeId === tradeId);
    if (!trade) return;

    const modal = document.getElementById('closeOptModal');
    if (!modal) return;

    Utils.setText('closeOptTicker', `${trade.ticker} ${trade.type.toUpperCase()} $${trade.strike} ${trade.expiry}`);
    Utils.setText('closeOptEntry', `$${trade.entryPremium.toFixed(2)}`);
    Utils.setText('closeOptCost', Utils.formatCurrency(trade.totalCost));

    const exitInput = document.getElementById('closeOptExitPremium');
    if (exitInput) exitInput.value = (trade.currentPremium || trade.entryPremium).toFixed(2);

    document.getElementById('closeOptLessons').value = '';
    document.getElementById('closeOptReason').value = 'manual';
    modal.dataset.tradeId = tradeId;
    modal.style.display = 'flex';
  },

  hideCloseModal() {
    const modal = document.getElementById('closeOptModal');
    if (modal) modal.style.display = 'none';
  },

  confirmClose() {
    const modal = document.getElementById('closeOptModal');
    if (!modal) return;

    const tradeId     = modal.dataset.tradeId;
    const exitPremium = parseFloat(document.getElementById('closeOptExitPremium')?.value);
    const reason      = document.getElementById('closeOptReason')?.value || 'manual';
    const lessons     = document.getElementById('closeOptLessons')?.value?.trim() || '';

    if (isNaN(exitPremium) || exitPremium < 0) {
      Utils.toast('Enter a valid exit premium', 'error');
      return;
    }

    const trade = Phase5.closePaperTrade(tradeId, exitPremium, reason, lessons);
    if (!trade) {
      Utils.toast('Trade not found', 'error');
      return;
    }

    const fmtPL = Utils.formatPnL(trade.realizedPL);
    Utils.toast(`Closed: ${fmtPL.text} (${Utils.formatPercent(trade.realizedPLPct)})`,
      trade.realizedPL >= 0 ? 'success' : 'error');

    Phase5UI.hideCloseModal();
    Phase5UI.render();
  },

  // Auto-log from pipeline approval
  autoLogFromPipeline(cioResult, optionsResult, executionResult, scanId) {
    const alert   = cioResult.tradeAlert || {};
    const options = optionsResult || {};
    const exec    = executionResult || {};

    // Determine entry premium — use real if available, fall back to AI estimate
    const entryPremium = options.liveContract?.premium
      || options.estimatedPremium
      || exec.limitPrice
      || 0;

    if (!entryPremium || !alert.ticker) return;

    const trade = Phase5.logPaperOptionsTrade({
      ticker:        alert.ticker,
      type:          options.recommendedStrategy?.includes('put') ? 'put' : 'call',
      strike:        options.recommendedStrike || 0,
      expiry:        options.recommendedExpiry || '—',
      entryPremium,
      contracts:     exec.contracts || 1,
      totalCost:     exec.totalCost,
      stopPremium:   exec.stopPrice ? Utils.round(exec.stopPrice * 0.01, 2) : Utils.round(entryPremium * 0.5, 2),
      targetPremium: exec.targetPrice ? Utils.round(exec.targetPrice * 0.01, 2) : Utils.round(entryPremium * 2.0, 2),
      thesis:        alert.thesis,
      score:         cioResult.scores?.total,
      scanId,
      marketRegime:  alert.marketRegime,
      iv:            options.ivRankEstimate,
      openInterest:  options.liveContract?.openInterest
    });

    // Refresh phase5 tab if visible
    if (document.getElementById('tab-phase5')?.classList.contains('active')) {
      Phase5UI.render();
    }

    return trade;
  }
};

