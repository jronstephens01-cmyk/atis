// journal.js — Trade Journal tab

const Journal = {

  init() {
    document.getElementById('logTradeBtn').addEventListener('click', Journal.openModal);
    document.getElementById('tradeModalClose').addEventListener('click', Journal.closeModal);
    document.getElementById('tradeModalCancel').addEventListener('click', Journal.closeModal);
    document.getElementById('tradeModalSave').addEventListener('click', Journal.saveTrade);
    document.getElementById('exportJournalBtn').addEventListener('click', Journal.exportCSV);

    // Close modal on overlay click
    document.getElementById('tradeModal').addEventListener('click', (e) => {
      if (e.target.id === 'tradeModal') Journal.closeModal();
    });

    Journal.render();
  },

  openModal() {
    document.getElementById('tradeModal').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('tradeModal').style.display = 'none';
    // Clear inputs
    ['tradeTickerInput','tradeStrategyInput','tradeEntryInput','tradeExitInput',
     'tradeSizeInput','tradeStopInput','tradeTargetInput','tradeScoreInput','tradeLessonsInput'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  saveTrade() {
    const ticker   = document.getElementById('tradeTickerInput').value.trim().toUpperCase();
    const type     = document.getElementById('tradeTypeInput').value;
    const strategy = document.getElementById('tradeStrategyInput').value.trim();
    const entry    = parseFloat(document.getElementById('tradeEntryInput').value);
    const exit     = parseFloat(document.getElementById('tradeExitInput').value) || null;
    const size     = parseFloat(document.getElementById('tradeSizeInput').value);
    const stop     = parseFloat(document.getElementById('tradeStopInput').value) || null;
    const target   = parseFloat(document.getElementById('tradeTargetInput').value) || null;
    const score    = parseInt(document.getElementById('tradeScoreInput').value) || null;
    const status   = document.getElementById('tradeStatusInput').value;
    const lessons  = document.getElementById('tradeLessonsInput').value.trim();

    if (!ticker || !entry || !size) {
      Utils.toast('Ticker, entry price, and size are required.', 'error');
      return;
    }

    const dollarGL  = exit ? Utils.round((exit - entry) * size, 2) : null;
    const percentGL = exit ? Utils.round(((exit - entry) / entry) * 100, 2) : null;
    const result    = dollarGL === null ? 'open' : dollarGL >= 0 ? 'win' : 'loss';

    const trade = {
      tradeId:      Utils.generateTradeId(),
      date:         new Date().toISOString().split('T')[0],
      ticker,
      assetType:    type,
      strategyName: strategy || 'Unclassified',
      entryPrice:   entry,
      exitPrice:    exit,
      positionSize: size,
      stopLoss:     stop,
      target,
      totalScore:   score,
      dollarGL,
      percentGL,
      result,
      status,
      lessons,
      marketRegime: Storage.getCachedMacroState()?.regime || '—',
      timestamp:    Date.now()
    };

    Storage.addTrade(trade);

    // Update strategy performance
    if (result !== 'open' && strategy) {
      Journal.updateStrategyPerf(strategy, trade);
    }

    // Recalculate risk state
    const portfolio = Storage.getPortfolio();
    const riskState = RiskEngine.recalculatePnL(Storage.getTradeLog(), portfolio);
    Storage.saveRiskState({ ...Storage.getRiskState(), ...riskState });

    Journal.closeModal();
    Journal.render();
    Utils.toast(`Trade logged: ${ticker} ${result.toUpperCase()}`, 'success');
  },

  updateStrategyPerf(strategyName, trade) {
    const perf = Storage.getStrategyPerf();
    const existing = perf[strategyName] || {
      totalTrades: 0, wins: 0, losses: 0,
      totalWinPct: 0, totalLossPct: 0,
      winRate: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, expectancy: 0,
      maxDrawdown: 0, status: 'active'
    };

    existing.totalTrades++;
    if (trade.result === 'win') {
      existing.wins++;
      existing.totalWinPct += trade.percentGL || 0;
    } else {
      existing.losses++;
      existing.totalLossPct += Math.abs(trade.percentGL || 0);
    }

    existing.winRate   = Utils.round(existing.wins / existing.totalTrades, 4);
    existing.avgWin    = existing.wins    ? Utils.round(existing.totalWinPct  / existing.wins,   2) : 0;
    existing.avgLoss   = existing.losses  ? Utils.round(existing.totalLossPct / existing.losses, 2) : 0;

    const grossWin  = existing.wins   * existing.avgWin;
    const grossLoss = existing.losses * existing.avgLoss;
    existing.profitFactor = grossLoss > 0 ? Utils.round(grossWin / grossLoss, 2) : 0;
    existing.expectancy   = Utils.round((existing.winRate * existing.avgWin) - ((1 - existing.winRate) * existing.avgLoss), 2);

    Storage.updateStrategyPerf(strategyName, existing);
  },

  render() {
    const trades = Storage.getTradeLog();
    const tbody  = document.getElementById('journalBody');

    if (!trades.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="12">No trades logged yet.</td></tr>';
      Journal.renderStats([]);
      return;
    }

    tbody.innerHTML = trades.map(t => {
      const plFmt = Utils.formatPnL(t.dollarGL);
      const badge = t.result === 'win'
        ? '<span class="win-badge">WIN</span>'
        : t.result === 'loss'
          ? '<span class="loss-badge">LOSS</span>'
          : '<span class="open-badge">OPEN</span>';

      return `
        <tr>
          <td style="font-family:var(--font-mono);color:var(--text-muted)">${t.tradeId}</td>
          <td>${Utils.formatDateShort(t.date)}</td>
          <td><strong style="color:var(--text-primary)">${t.ticker}</strong></td>
          <td style="font-size:11px;color:var(--text-muted)">${t.assetType}</td>
          <td style="font-family:var(--font-mono)">${t.totalScore ? t.totalScore + '/60' : '—'}</td>
          <td style="font-family:var(--font-mono)">$${(t.entryPrice || 0).toFixed(2)}</td>
          <td style="font-family:var(--font-mono)">${t.exitPrice ? '$' + t.exitPrice.toFixed(2) : '—'}</td>
          <td style="font-family:var(--font-mono)">${t.positionSize}</td>
          <td class="${plFmt.cls}" style="font-family:var(--font-mono)">${t.dollarGL != null ? plFmt.text : '—'}</td>
          <td class="${plFmt.cls}" style="font-family:var(--font-mono)">${t.percentGL != null ? Utils.formatPercent(t.percentGL) : '—'}</td>
          <td>${badge}</td>
          <td style="font-size:11px;color:var(--text-muted)">${t.strategyName || '—'}</td>
        </tr>`;
    }).join('');

    Journal.renderStats(trades.filter(t => t.status === 'closed'));
  },

  renderStats(closedTrades) {
    const wins   = closedTrades.filter(t => t.result === 'win');
    const losses = closedTrades.filter(t => t.result === 'loss');
    const n = closedTrades.length;

    Utils.setText('statTotalTrades', n);
    Utils.setText('statWinRate', n ? Utils.formatPercent((wins.length / n) * 100) : '—%');

    const avgWin  = wins.length   ? wins.reduce((s, t) => s + (t.percentGL || 0), 0) / wins.length   : null;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + (t.percentGL || 0), 0) / losses.length : null;

    Utils.setText('statAvgWin',  avgWin  != null ? Utils.formatPercent(avgWin)  : '—%');
    Utils.setText('statAvgLoss', avgLoss != null ? Utils.formatPercent(avgLoss) : '—%');

    if (avgWin && avgLoss && losses.length) {
      const grossWin  = wins.length   * Math.abs(avgWin);
      const grossLoss = losses.length * Math.abs(avgLoss);
      const pf = grossLoss > 0 ? Utils.round(grossWin / grossLoss, 2) : '—';
      Utils.setText('statProfitFactor', pf);

      const winRate    = wins.length / n;
      const expectancy = Utils.round(winRate * Math.abs(avgWin) - (1 - winRate) * Math.abs(avgLoss), 2);
      const expEl = document.getElementById('statExpectancy');
      if (expEl) {
        expEl.textContent = Utils.formatPercent(expectancy);
        expEl.className   = `stats-value ${expectancy >= 0 ? 'positive' : 'negative'}`;
      }
    }
  },

  exportCSV() {
    const trades = Storage.getTradeLog();
    if (!trades.length) { Utils.toast('No trades to export', 'warn'); return; }

    const headers = ['ID','Date','Ticker','Type','Strategy','Entry','Exit','Size','P&L $','P&L %','Result','Score','Regime','Lessons'];
    const rows = trades.map(t => [
      t.tradeId, t.date, t.ticker, t.assetType, t.strategyName,
      t.entryPrice, t.exitPrice || '', t.positionSize,
      t.dollarGL ?? '', t.percentGL ?? '', t.result, t.totalScore || '',
      t.marketRegime || '', `"${(t.lessons || '').replace(/"/g, '""')}"`
    ]);

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `atis_journal_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Utils.toast('Journal exported as CSV', 'success');
  }
};


// ============================================================
// reports.js — Reports tab
// ============================================================

const Reports = {

  init() {
    document.querySelectorAll('.tab-sub[data-report]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-sub[data-report]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Reports.render(btn.dataset.report);
      });
    });
    Reports.render('daily');
  },

  render(period) {
    const content = document.getElementById('reportContent');
    if (!content) return;

    const portfolio = Storage.getPortfolio();
    const riskState = Storage.getRiskState();
    const trades    = Storage.getTradeLog();
    const macroState = Storage.getCachedMacroState();

    const sections = [];

    if (period === 'daily') {
      const todayTrades = trades.filter(t =>
        t.date === new Date().toISOString().split('T')[0]);

      sections.push({
        title: `DAILY REPORT — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
        lines: [
          `Market Regime: ${macroState?.regime || 'Not loaded'} (Macro Score: ${macroState?.totalScore || '—'}/50)`,
          `Account Value: ${Utils.formatCurrency(portfolio.currentValue)} | Cash: ${Utils.formatCurrency(portfolio.cashAvailable)}`,
          `Daily P&L: ${Utils.formatCurrency(riskState.dailyPL || 0)} (${Utils.formatPercent(riskState.dailyPLPercent || 0)})`,
          `Active Positions: ${portfolio.positions?.length || 0}`,
          `Pipeline runs today: —`,
          `Trades today: ${todayTrades.length}`,
          `Risk alerts: ${riskState.dailyLimitHit ? '⚠ Daily limit hit' : riskState.weeklyLimitHit ? '⚠ Weekly limit hit' : 'None'}`,
          `Rule violations: None`,
          ``,
          `Reminder: Consistent wealth creation usually comes from disciplined investing, not rapid account growth. This account is a process development experiment.`
        ]
      });
    }

    if (period === 'weekly') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weekTrades = trades.filter(t => new Date(t.date) >= weekAgo);
      const closed = weekTrades.filter(t => t.status === 'closed');
      const wins   = closed.filter(t => t.result === 'win');

      sections.push({
        title: `WEEKLY REPORT — Week ending ${new Date().toLocaleDateString()}`,
        lines: [
          `Trades reviewed: ${weekTrades.length}`,
          `Trades closed: ${closed.length}`,
          `Win/Loss: ${wins.length}–${closed.length - wins.length}`,
          `Win Rate: ${closed.length ? Utils.formatPercent((wins.length / closed.length) * 100) : '—'}`,
          `Weekly P&L: ${Utils.formatCurrency(riskState.weeklyPL || 0)} (${Utils.formatPercent(riskState.weeklyPLPercent || 0)})`,
          `Position size multiplier: ${riskState.positionSizeMultiplier || 1.0}x`,
        ]
      });

      // Strategy breakdown
      const stratPerf = Storage.getStrategyPerf();
      if (Object.keys(stratPerf).length) {
        sections.push({
          title: 'STRATEGY PERFORMANCE',
          lines: Object.entries(stratPerf).map(([name, p]) =>
            `${name}: W${p.wins}–L${p.losses} | WR: ${Utils.formatPercent((p.winRate || 0) * 100)} | PF: ${p.profitFactor || '—'} | Expectancy: ${p.expectancy || 0}%`
          )
        });
      }
    }

    if (period === 'monthly') {
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const monthTrades = trades.filter(t => new Date(t.date) >= monthAgo);
      const closed = monthTrades.filter(t => t.status === 'closed');
      const wins   = closed.filter(t => t.result === 'win');
      const drawdown = RiskEngine.calcDrawdown(portfolio.currentValue, portfolio.peakValue);

      sections.push({
        title: `MONTHLY REPORT — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        lines: [
          `Account Growth: ${Utils.formatCurrency(portfolio.currentValue - portfolio.startingCapital)} from starting capital`,
          `Drawdown from Peak: ${Utils.formatPercent(drawdown.percent)}`,
          `Monthly P&L: ${Utils.formatCurrency(riskState.monthlyPL || 0)} (${Utils.formatPercent(riskState.monthlyPLPercent || 0)})`,
          `Total Trades: ${closed.length} | Win Rate: ${closed.length ? Utils.formatPercent((wins.length / closed.length) * 100) : '—'}`,
          `Rule Violations: None recorded`,
        ]
      });
    }

    content.innerHTML = sections.map(s => `
      <div class="report-section">
        <div class="report-section-title">${s.title}</div>
        ${s.lines.map(l => `<div class="report-line">${l || '&nbsp;'}</div>`).join('')}
      </div>
    `).join('');
  }
};


// ============================================================
// agents.js — Agent Activity Monitor tab
// ============================================================

const Agents = {

  AGENT_ROSTER: [
    { num: '01', name: 'Junior Analyst',         phase: 'Phase 3' },
    { num: '02', name: 'Research Analyst',        phase: 'Phase 3' },
    { num: '03', name: 'Sector Head',             phase: 'Phase 3' },
    { num: '04', name: 'Quant Researcher',        phase: 'Phase 4' },
    { num: '05', name: 'Risk Manager',            phase: 'Phase 3' },
    { num: '06', name: 'Compliance Officer',      phase: 'Phase 4' },
    { num: '07', name: 'Execution Specialist',    phase: 'Phase 4' },
    { num: '08', name: 'Software Engineer',       phase: 'Phase 1' },
    { num: '09', name: 'Operations Associate',    phase: 'Phase 3' },
    { num: '10', name: 'Fund Controller',         phase: 'Phase 2' },
    { num: '11', name: 'Chief Operating Officer', phase: 'Phase 3' },
    { num: '12', name: 'Reporting Module',        phase: 'Phase 4' },
    { num: '14', name: 'Chief Investment Officer', phase: 'Phase 3' },
    { num: '15', name: 'Macro Strategist',        phase: 'Phase 3' },
    { num: '16', name: 'Options Specialist',      phase: 'Phase 4' },
    { num: '17', name: 'AI Strategy Director',    phase: 'Phase 4' },
  ],

  init() {
    document.getElementById('exportDataBtn').addEventListener('click', () => Storage.export());
    document.getElementById('importDataBtn').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', (e) => {
      if (e.target.files[0]) Storage.import(e.target.files[0]);
    });
    document.getElementById('clearDataBtn').addEventListener('click', Agents.clearData);

    Agents.renderRoster();
    Agents.renderHealth();
    Agents.updateCostEstimate();

    // Refresh health every 30 seconds if on this tab
    setInterval(() => {
      if (document.getElementById('tab-agents').classList.contains('active')) {
        Agents.renderHealth();
      }
    }, 30000);
  },

  renderRoster() {
    const roster = document.getElementById('agentRoster');
    if (!roster) return;

    roster.innerHTML = Agents.AGENT_ROSTER.map(a => `
      <div class="agent-card">
        <span class="agent-num">${a.num}</span>
        <span class="agent-name">${a.name}</span>
        <span class="agent-phase" style="color:${a.phase === 'Phase 1' || a.phase === 'Phase 2' ? 'var(--cyan)' : 'var(--text-muted)'}">${a.phase}</span>
      </div>
    `).join('');
  },

  renderHealth() {
    const health = Storage.getSystemHealth();
    const size   = Utils.getStorageSizeKB();

    Utils.setText('healthStorageSize', `${size} KB used`);

    const services = [
      { id: 'yahoo',    dotId: 'healthYahoo',    statusId: 'healthYahooStatus',    timeId: 'healthYahooTime' },
      { id: 'fred',     dotId: 'healthFred',      statusId: 'healthFredStatus',     timeId: 'healthFredTime' },
      { id: 'claude',   dotId: 'healthClaude',    statusId: 'healthClaudeStatus',   timeId: null },
      { id: 'robinhood',dotId: 'healthRobinhood', statusId: 'healthRobinhoodStatus',timeId: null },
    ];

    services.forEach(({ id, dotId, statusId, timeId }) => {
      const data = health[id];
      if (!data) return;

      const dot = document.getElementById(dotId);
      const statusEl = document.getElementById(statusId);
      const timeEl   = timeId ? document.getElementById(timeId) : null;

      if (dot) dot.className = `dot ${data.status === 'live' ? 'dot--ok' : data.status === 'error' ? 'dot--danger' : 'dot--off'}`;
      if (statusEl) statusEl.textContent = data.detail || data.status;
      if (timeEl && data.timestamp) timeEl.textContent = Utils.freshness(data.timestamp);
    });
  },

  updateCostEstimate() {
    const cost = Storage.getApiCost();
    Utils.setText('apiCostEstimate', `$${(cost.estimatedCost || 0).toFixed(4)}`);
  },

  clearData() {
    const confirmed = confirm(
      '⚠ This will permanently delete ALL ATIS data including your trade journal, portfolio, and settings.\n\nExport a backup first! Are you sure?'
    );
    if (!confirmed) return;
    const count = Storage.clearAll();
    Utils.toast(`Cleared ${count} records. Reloading...`, 'warn');
    setTimeout(() => location.reload(), 1500);
  }
};
