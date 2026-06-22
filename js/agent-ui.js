// agent-ui.js — Pipeline UI and Human Approval Gate for ATIS Phase 3

const AgentUI = {

  currentScanId: null,

  // ============================================================
  // PIPELINE DISPLAY
  // ============================================================
  startPipeline(scanId) {
    AgentUI.currentScanId = scanId;

    const container = document.getElementById('pipelineContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="pipeline-header">
        <div class="pipeline-title">PIPELINE RUNNING</div>
        <div class="pipeline-scan-id">${scanId}</div>
        <div class="pipeline-time" id="pipelineTimer">0s</div>
      </div>
      <div class="pipeline-steps" id="pipelineSteps">
        ${AgentUI.renderStep('data',    '⬡', 'Data Ingestion',     'Fetching market + macro data')}
        ${AgentUI.renderStep('agent15', '15', 'Macro Strategist',  'Classifying market regime')}
        ${AgentUI.renderStep('agent1',  '01', 'Junior Analyst',    'Scanning watchlist')}
        ${AgentUI.renderStep('agent3',  '03', 'Sector Head',       'Filtering by sector strength')}
        ${AgentUI.renderStep('agent2',  '02', 'Research Analyst',  'Technical + fundamental analysis')}
        ${AgentUI.renderStep('agent5',  '05', 'Risk Manager',      'Position sizing + risk check')}
        ${AgentUI.renderStep('agent14', '14', 'Chief Investment Officer', 'Generating recommendation')}
        ${AgentUI.renderStep('agent4',  '04', 'Quant Researcher',  'Statistical validation')}
        ${AgentUI.renderStep('agent16', '16', 'Options Specialist', 'Options analysis')}
        ${AgentUI.renderStep('agent6',  '06', 'Compliance Officer', 'Rule compliance check')}
        ${AgentUI.renderStep('agent7',  '07', 'Execution Specialist', 'Order structuring')}
        ${AgentUI.renderStep('agent17', '17', 'AI Strategy Director', 'Strategy review')}
      </div>
      <div id="approvalGate" style="display:none"></div>
      <div id="pipelineError" style="display:none"></div>
    `;

    // Start timer
    const start = Date.now();
    AgentUI._timer = setInterval(() => {
      const el = document.getElementById('pipelineTimer');
      if (el) el.textContent = Math.floor((Date.now() - start) / 1000) + 's';
    }, 1000);
  },

  renderStep(id, num, name, description) {
    return `
      <div class="pipeline-step" id="step-${id}">
        <div class="step-num">${num}</div>
        <div class="step-body">
          <div class="step-name">${name}</div>
          <div class="step-status" id="status-${id}">${description}</div>
        </div>
        <div class="step-indicator" id="indicator-${id}">
          <span class="dot dot--off"></span>
        </div>
      </div>
    `;
  },

  setAgentStatus(agentId, status, message) {
    const step = document.getElementById(`step-${agentId}`);
    const statusEl = document.getElementById(`status-${agentId}`);
    const indicator = document.getElementById(`indicator-${agentId}`);

    if (!step) return;

    // Reset classes
    step.className = 'pipeline-step';

    if (status === 'running') {
      step.classList.add('step--running');
      if (indicator) indicator.innerHTML = '<span class="dot dot--warn" style="animation:pulse 1s infinite"></span>';
      if (statusEl) statusEl.textContent = message;
    } else if (status === 'complete') {
      step.classList.add('step--complete');
      if (indicator) indicator.innerHTML = '<span class="step-check">✓</span>';
      if (statusEl) statusEl.textContent = message;
    } else if (status === 'rejected') {
      step.classList.add('step--rejected');
      if (indicator) indicator.innerHTML = '<span class="step-reject">✕</span>';
      if (statusEl) statusEl.textContent = message;
    }
  },

  showError(message) {
    clearInterval(AgentUI._timer);
    const el = document.getElementById('pipelineError');
    if (el) {
      el.style.display = 'block';
      el.innerHTML = `
        <div class="pipeline-error-block">
          <div class="pipeline-error-title">Pipeline Error</div>
          <div class="pipeline-error-msg">${message}</div>
          <div class="pipeline-error-hint">Check your Worker URL and Claude API key in Agents tab.</div>
        </div>
      `;
    }
  },

  showPipelineComplete(reason) {
    clearInterval(AgentUI._timer);
    const gate = document.getElementById('approvalGate');
    if (!gate) return;

    const messages = {
      no_candidates: 'No candidates identified. Market conditions do not support new positions at this time.',
      filtered_out: 'All candidates filtered out by sector analysis. Leading sectors do not align with available watchlist tickers.',
      risk_rejected: 'Setup rejected by Risk Manager. Capital preservation rules prevent this trade.',
      error: 'Pipeline encountered an error. Check system health in Agents tab.'
    };

    gate.style.display = 'block';
    gate.innerHTML = `
      <div class="pipeline-complete-block">
        <div class="complete-icon">◈</div>
        <div class="complete-title">Scan Complete</div>
        <div class="complete-msg">${messages[reason] || 'Pipeline completed.'}</div>
        <button class="btn btn--secondary" onclick="AgentUI.resetPipeline()">↻ Run New Scan</button>
      </div>
    `;
  },

  // ============================================================
  // HUMAN APPROVAL GATE
  // ============================================================
  showApprovalGate(cioResult, riskResult, candidate, quote) {
    clearInterval(AgentUI._timer);

    const gate = document.getElementById('approvalGate');
    if (!gate) return;

    const alert    = cioResult.tradeAlert || {};
    const scores   = cioResult.scores || {};
    const options  = Pipeline.state.results?.optionsAnalysis || {};
    const execution = Pipeline.state.results?.executionPlan || {};
    const scoreColor     = Scoring.scoreColor(scores.total);
    const isHighConviction = scores.total >= 50;
    const isQualified      = scores.total >= 42;

    gate.style.display = 'block';
    gate.innerHTML = `
      <div class="approval-gate">

        <!-- Header -->
        <div class="approval-header">
          <div class="approval-badge ${isHighConviction ? 'badge--high' : isQualified ? 'badge--qualified' : 'badge--monitor'}">
            ${cioResult.scoreLabel}
          </div>
          <div class="approval-score" style="color:${scoreColor}">${scores.total}/60</div>
          <div class="approval-title">RECOMMENDATION: ${alert.ticker || candidate.ticker} — ${(alert.assetType || 'EQUITY').toUpperCase()}</div>
        </div>

        <!-- Score Breakdown -->
        <div class="approval-scores">
          ${AgentUI.renderScoreBar('Technical',   scores.technical)}
          ${AgentUI.renderScoreBar('Fundamental', scores.fundamental)}
          ${AgentUI.renderScoreBar('Catalyst',    scores.catalyst)}
          ${AgentUI.renderScoreBar('Risk/Reward', scores.risk)}
          ${AgentUI.renderScoreBar('Market',      scores.market)}
          ${AgentUI.renderScoreBar('Macro',       scores.macro)}
        </div>

        <!-- OPTIONS DETAILS — Agent 16 output -->
        <div class="alert-section" style="background:rgba(0,212,255,0.04);border-left:3px solid var(--cyan)">
          <div class="alert-section-label" style="color:var(--cyan)">OPTIONS SETUP — AGENT 16 RECOMMENDATION</div>
          <div class="trade-alert-grid" style="padding:12px 0 0 0">
            <div class="alert-field">
              <span class="alert-label">STRATEGY</span>
              <span class="alert-val" style="color:var(--cyan)">${(options.recommendedStrategy || '—').replace('_',' ').toUpperCase()}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">STRIKE PRICE</span>
              <span class="alert-val positive">$${options.recommendedStrike || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">EXPIRY DATE</span>
              <span class="alert-val">${options.recommendedExpiry || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">PREMIUM (per share)</span>
              <span class="alert-val">$${options.estimatedPremium || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">DELTA</span>
              <span class="alert-val">${options.delta || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">BREAKEVEN</span>
              <span class="alert-val">$${options.breakeven || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">MAX LOSS</span>
              <span class="alert-val negative">$${options.maxLoss || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">PROB. OF PROFIT</span>
              <span class="alert-val">${options.probabilityOfProfit ? Math.round(options.probabilityOfProfit * 100) + '%' : '—'}</span>
            </div>
          </div>
          ${options.smallAccountWarnings?.length ? `
            <div style="margin-top:10px;padding:8px;background:rgba(255,193,7,0.1);border-radius:3px;font-family:var(--font-mono);font-size:11px;color:var(--amber)">
              ⚠ ${options.smallAccountWarnings.join(' | ')}
            </div>` : ''}
        </div>

        <!-- EXECUTION ORDER — Agent 7 output -->
        <div class="alert-section" style="background:rgba(0,230,118,0.03);border-left:3px solid var(--green-dim)">
          <div class="alert-section-label" style="color:var(--green)">EXECUTION ORDER — AGENT 7 INSTRUCTIONS</div>
          <div class="trade-alert-grid" style="padding:12px 0 0 0">
            <div class="alert-field">
              <span class="alert-label">ORDER TYPE</span>
              <span class="alert-val">${(execution.orderType || 'LIMIT').toUpperCase()}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">LIMIT PRICE</span>
              <span class="alert-val positive">$${execution.limitPrice || alert.entryZone || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">STOP PRICE</span>
              <span class="alert-val negative">$${execution.stopPrice || alert.stopLoss || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">TARGET PRICE</span>
              <span class="alert-val positive">$${execution.targetPrice || alert.target || '—'}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">CONTRACTS</span>
              <span class="alert-val">${execution.contracts || 1}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">TOTAL COST</span>
              <span class="alert-val">${Utils.formatCurrency(execution.totalCost || riskResult.recommendedPositionDollar)}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">MAX RISK</span>
              <span class="alert-val negative">${Utils.formatCurrency(execution.maxRisk || riskResult.recommendedPositionDollar)}</span>
            </div>
            <div class="alert-field">
              <span class="alert-label">ENTRY TIMING</span>
              <span class="alert-val" style="font-size:11px">${execution.entryTiming || 'Avoid first 30 min'}</span>
            </div>
          </div>
          ${execution.orderInstructions ? `
            <div style="margin-top:10px;padding:8px;background:var(--bg-surface);border-radius:3px;font-size:12px;color:var(--text-secondary)">
              📋 ${execution.orderInstructions}
            </div>` : ''}
          ${execution.smallAccountNote ? `
            <div style="margin-top:6px;padding:8px;background:rgba(0,212,255,0.05);border-radius:3px;font-family:var(--font-mono);font-size:11px;color:var(--cyan)">
              ℹ ${execution.smallAccountNote}
            </div>` : ''}
        </div>

        <!-- Equity Trade Alert -->
        <div class="alert-section">
          <div class="alert-section-label">EQUITY TRADE DETAILS</div>
          <div class="trade-alert-grid" style="padding:12px 0 0 0">
            <div class="alert-field"><span class="alert-label">REGIME</span><span class="alert-val">${alert.marketRegime || '—'}</span></div>
            <div class="alert-field"><span class="alert-label">ENTRY ZONE</span><span class="alert-val positive">${alert.entryZone || '—'}</span></div>
            <div class="alert-field"><span class="alert-label">STOP LOSS</span><span class="alert-val negative">${alert.stopLoss || '—'}</span></div>
            <div class="alert-field"><span class="alert-label">TARGET</span><span class="alert-val positive">${alert.target || '—'}</span></div>
            <div class="alert-field"><span class="alert-label">RISK/REWARD</span><span class="alert-val">${alert.riskReward || '—'}</span></div>
            <div class="alert-field"><span class="alert-label">POSITION SIZE</span><span class="alert-val">${Utils.formatCurrency(riskResult.recommendedPositionDollar)}</span></div>
            <div class="alert-field"><span class="alert-label">TIMEFRAME</span><span class="alert-val">${alert.timeframe || '—'}</span></div>
            <div class="alert-field"><span class="alert-label">CONFIDENCE</span><span class="alert-val">${alert.confidenceLevel || '—'}</span></div>
          </div>
        </div>

        <!-- Thesis -->
        <div class="alert-section">
          <div class="alert-section-label">WHY THIS SETUP EXISTS</div>
          <div class="alert-section-text">${alert.thesis || '—'}</div>
        </div>
        <div class="alert-section">
          <div class="alert-section-label">KEY RISKS</div>
          <div class="alert-section-text negative-text">${alert.risks || '—'}</div>
        </div>
        <div class="alert-section">
          <div class="alert-section-label">WHAT INVALIDATES THIS IDEA</div>
          <div class="alert-section-text">${alert.invalidation || '—'}</div>
        </div>

        <!-- Decision -->
        <div class="approval-actions">
          <button class="btn btn--danger approval-btn-decline"
            onclick="AgentUI.recordDecision('declined')">
            ✕ Decline
          </button>
          <button class="btn btn--primary approval-btn-approve"
            onclick="AgentUI.recordDecision('approved')"
            ${!isQualified ? 'disabled title="Score below 42 — not recommended"' : ''}>
            ✓ Log to Journal
          </button>
        </div>

        ${!isQualified ? '<div class="approval-warning">Score below qualification threshold (42). Approval not recommended.</div>' : ''}
      </div>
    `;
  },

  renderScoreBar(label, score) {
    const pct = ((score || 0) / 10) * 100;
    const color = score >= 7 ? 'var(--green)' : score >= 5 ? 'var(--cyan)' : score >= 3 ? 'var(--amber)' : 'var(--red)';
    return `
      <div class="approval-score-row">
        <span class="approval-score-label">${label}</span>
        <div class="approval-score-bar-wrap">
          <div class="approval-score-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="approval-score-num">${score || 0}/10</span>
      </div>
    `;
  },

  recordDecision(decision) {
    const results = Pipeline.state.results;
    if (!results) return;

    const alert    = results.finalRecommendation?.tradeAlert;
    const scores   = results.finalRecommendation?.scores;
    const options  = results.optionsAnalysis || {};
    const execution = results.executionPlan || {};

    Pipeline.recordDecision(AgentUI.currentScanId, decision, alert ? {
      ...alert,
      totalScore:        scores?.total,
      optionsStrategy:   options.recommendedStrategy,
      optionsStrike:     options.recommendedStrike,
      optionsExpiry:     options.recommendedExpiry,
      optionsPremium:    options.estimatedPremium,
      optionsBreakeven:  options.breakeven,
      optionsMaxLoss:    options.maxLoss,
      optionsContracts:  execution.contracts,
      executionLimit:    execution.limitPrice,
      executionStop:     execution.stopPrice,
      executionTarget:   execution.targetPrice,
      orderInstructions: execution.orderInstructions
    } : null);

    const gate = document.getElementById('approvalGate');
    if (gate) {
      gate.innerHTML = `
        <div class="pipeline-complete-block">
          <div class="complete-icon" style="color:${decision === 'approved' ? 'var(--green)' : 'var(--text-muted)'}">
            ${decision === 'approved' ? '✓' : '✕'}
          </div>
          <div class="complete-title">${decision === 'approved' ? 'Logged to Trade Journal' : 'Trade Declined'}</div>
          <div class="complete-msg">
            ${decision === 'approved'
              ? `Trade logged to your Journal. Go to Robinhood and place the order manually using the execution instructions above. Options: ${options.recommendedStrategy?.replace('_',' ') || 'see journal'} $${options.recommendedStrike} exp ${options.recommendedExpiry}.`
              : 'Declined. No position taken. Decision logged for review.'}
          </div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:4px">
            <button class="btn btn--secondary" onclick="App.switchTab('journal')">→ View Journal</button>
            <button class="btn btn--secondary" onclick="AgentUI.resetPipeline()">↻ Run New Scan</button>
          </div>
        </div>
      `;
    }
  },

  resetPipeline() {
    const container = document.getElementById('pipelineContainer');
    if (container) {
      container.innerHTML = `
        <div class="pipeline-idle">
          <div class="pipeline-idle-icon">◈</div>
          <div class="pipeline-idle-text">Pipeline ready. Add tickers to your watchlist and run a scan.</div>
        </div>
      `;
    }
    clearInterval(AgentUI._timer);
  }
};
