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
  // HUMAN APPROVAL GATE — Simple card for anyone
  // ============================================================
  showApprovalGate(cioResult, riskResult, candidate, quote) {
    clearInterval(AgentUI._timer);

    const gate = document.getElementById('approvalGate');
    if (!gate) return;

    const alert     = cioResult.tradeAlert || {};
    const scores    = cioResult.scores || {};
    const options   = Pipeline.state.results?.optionsAnalysis || {};
    const execution = Pipeline.state.results?.executionPlan || {};
    const isQualified = scores.total >= 42;
    const scoreColor  = Scoring.scoreColor(scores.total);

    // Decision label
    const decision = scores.total >= 50
      ? { emoji: '✅', label: 'BUY',   color: 'var(--green)',  bg: 'rgba(0,230,118,0.1)',  border: 'var(--green)' }
      : scores.total >= 42
      ? { emoji: '✅', label: 'BUY',   color: 'var(--green)',  bg: 'rgba(0,230,118,0.08)', border: 'var(--green)' }
      : scores.total >= 35
      ? { emoji: '👀', label: 'WATCH', color: 'var(--amber)',  bg: 'rgba(255,193,7,0.08)', border: 'var(--amber)' }
      : { emoji: '⏭️', label: 'SKIP',  color: 'var(--red)',    bg: 'rgba(255,61,87,0.08)', border: 'var(--red)'   };

    // One-sentence why (trimmed to 120 chars)
    const rawThesis = alert.thesis || '';
    const sentences = rawThesis.match(/[^.!?]+[.!?]+/g) || [];
    const oneLineSentence = sentences[0]?.trim() || rawThesis.slice(0, 120);

    // Stock numbers
    const stockEntry  = alert.entryZone  || execution.limitPrice || '—';
    const stockStop   = alert.stopLoss   || execution.stopPrice  || '—';
    const stockTarget = alert.target     || execution.targetPrice || '—';

    // Options numbers
    const optStrike   = options.recommendedStrike  || '—';
    const optExpiry   = options.recommendedExpiry  || '—';
    const optPremium  = options.realPremium        || options.estimatedPremium || '—';
    const optCost     = optPremium !== '—' ? `$${(optPremium * 100).toFixed(0)}` : '—';
    const optPremStop = optPremium !== '—' ? `$${(optPremium * 0.5).toFixed(2)}` : '—';
    const optLiveTag  = options.liveDataAvailable
      ? `<span style="font-size:10px;color:var(--green);font-family:var(--font-mono)">📡 LIVE</span>`
      : `<span style="font-size:10px;color:var(--amber);font-family:var(--font-mono)">est.</span>`;

    gate.style.display = 'block';
    gate.innerHTML = `
      <div style="border:2px solid ${decision.border};border-radius:12px;overflow:hidden;margin-top:16px;background:var(--bg-raised)">

        <!-- DECISION HEADER -->
        <div style="background:${decision.bg};border-bottom:1px solid ${decision.border};padding:18px 20px;display:flex;align-items:center;gap:16px">
          <div style="font-size:32px">${decision.emoji}</div>
          <div>
            <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:${decision.color};letter-spacing:0.05em">${decision.label}</div>
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${scores.total}/60 score</div>
          </div>
          <div style="flex:1;text-align:right">
            <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--text-primary)">${alert.ticker || candidate.ticker}</div>
            <div style="font-size:12px;color:var(--text-muted)">${alert.timeframe || '2-4 weeks'}</div>
          </div>
        </div>

        <!-- ONE SENTENCE WHY -->
        <div style="padding:14px 20px;background:var(--bg-surface);border-bottom:1px solid var(--border);font-size:13px;color:var(--text-secondary);line-height:1.5;font-style:italic">
          "${oneLineSentence}"
        </div>

        <!-- TWO COLUMN TRADE CARD -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--border)">

          <!-- STOCK PLAY -->
          <div style="padding:18px 20px;border-right:1px solid var(--border)">
            <div style="font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.12em;color:var(--text-muted);margin-bottom:14px">📈 STOCK PLAY</div>

            <div style="margin-bottom:12px">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">BUY AT</div>
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--cyan)">${stockEntry}</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <div style="padding:10px;background:rgba(255,61,87,0.06);border:1px solid var(--red-dim);border-radius:6px">
                <div style="font-size:9px;color:var(--red);font-family:var(--font-mono);margin-bottom:3px">🛑 STOP LOSS</div>
                <div style="font-family:var(--font-mono);font-size:15px;font-weight:600;color:var(--red)">${stockStop}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Sell if price drops here</div>
              </div>
              <div style="padding:10px;background:rgba(0,230,118,0.06);border:1px solid var(--green-dim);border-radius:6px">
                <div style="font-size:9px;color:var(--green);font-family:var(--font-mono);margin-bottom:3px">🎯 TAKE PROFIT</div>
                <div style="font-family:var(--font-mono);font-size:15px;font-weight:600;color:var(--green)">${stockTarget}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Sell shares here</div>
              </div>
            </div>

            <div style="padding:8px;background:var(--bg-surface);border-radius:4px;font-size:11px;color:var(--text-muted)">
              R/R: ${alert.riskReward || '—'} &nbsp;|&nbsp; Position: ${Utils.formatCurrency(riskResult.recommendedPositionDollar)}
            </div>
          </div>

          <!-- OPTIONS PLAY -->
          <div style="padding:18px 20px">
            <div style="font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.12em;color:var(--text-muted);margin-bottom:14px">🎯 OPTIONS PLAY ${optLiveTag}</div>

            <div style="margin-bottom:12px">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">BUY CONTRACT</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--cyan)">$${optStrike} Call — ${optExpiry}</div>
              <div style="font-family:var(--font-mono);font-size:13px;color:var(--text-secondary);margin-top:2px">Cost: ${optCost} per contract</div>
              ${optPremium !== '—' && options.realBid ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">Bid $${options.realBid} / Ask $${options.realAsk}</div>` : ''}
              ${optPremium !== '—' ? `<div style="font-size:10px;color:var(--amber);margin-top:2px">⚡ Got in cheaper? Stop = what you paid ÷ 2</div>` : ''}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <div style="padding:10px;background:rgba(255,61,87,0.06);border:1px solid var(--red-dim);border-radius:6px">
                <div style="font-size:9px;color:var(--red);font-family:var(--font-mono);margin-bottom:3px">🛑 EXIT IF</div>
                <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--red)">Stock → ${stockStop}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">OR premium → ${optPremStop}</div>
                <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Whichever comes first</div>
              </div>
              <div style="padding:10px;background:rgba(0,230,118,0.06);border:1px solid var(--green-dim);border-radius:6px">
                <div style="font-size:9px;color:var(--green);font-family:var(--font-mono);margin-bottom:3px">🎯 TAKE PROFIT</div>
                <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--green)">Stock → ${stockTarget}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Sell contract then</div>
              </div>
            </div>

            <div style="padding:8px;background:var(--bg-surface);border-radius:4px;font-size:11px;color:var(--text-muted)">
              ${options.probabilityOfProfit ? `Win odds: ${Math.round(options.probabilityOfProfit * 100)}%` : ''} &nbsp;|&nbsp; Max loss: ${optCost}
            </div>
          </div>
        </div>

        <!-- SHOW DETAILS TOGGLE -->
        <div style="border-bottom:1px solid var(--border)">
          <button onclick="AgentUI.toggleDetails()" style="width:100%;padding:12px 20px;background:none;border:none;font-family:var(--font-mono);font-size:11px;color:var(--cyan);cursor:pointer;text-align:left;letter-spacing:0.06em">
            ▼ Show Details (why the AI likes this, risks, score breakdown)
          </button>
          <div id="tradeDetails" style="display:none;padding:0 20px 16px">

            <!-- Score bars -->
            <div style="margin-bottom:14px">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);letter-spacing:0.1em;margin-bottom:8px">AI SCORE — ${scores.total}/60</div>
              ${AgentUI.renderScoreBar('Technical',   scores.technical)}
              ${AgentUI.renderScoreBar('Fundamental', scores.fundamental)}
              ${AgentUI.renderScoreBar('Catalyst',    scores.catalyst)}
              ${AgentUI.renderScoreBar('Risk/Reward', scores.risk)}
              ${AgentUI.renderScoreBar('Market',      scores.market)}
              ${AgentUI.renderScoreBar('Macro',       scores.macro)}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div style="background:rgba(0,230,118,0.04);border:1px solid var(--green-dim);border-radius:6px;padding:12px">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--green);margin-bottom:6px">✅ WHY THE AI LIKES THIS</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.thesis || '—'}</div>
              </div>
              <div style="background:rgba(255,61,87,0.04);border:1px solid var(--red-dim);border-radius:6px;padding:12px">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--red);margin-bottom:6px">⚠️ WHAT COULD GO WRONG</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.risks || '—'}</div>
              </div>
            </div>

            <div style="background:rgba(255,193,7,0.05);border:1px solid var(--amber-dim);border-radius:6px;padding:12px;margin-top:10px">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--amber);margin-bottom:6px">🚪 WALK AWAY IF...</div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.invalidation || '—'}</div>
            </div>

            <div style="background:var(--bg-surface);border-radius:6px;padding:12px;margin-top:10px;font-size:11px;color:var(--text-muted)">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:4px">BEST TIME TO ENTER</div>
              ${execution.entryTiming || 'Avoid first 30 minutes of market open. Wait for price to settle.'}
            </div>
          </div>
        </div>

        <!-- ACTION BUTTONS -->
        <div style="padding:16px 20px;display:flex;gap:12px;justify-content:flex-end;align-items:center">
          ${!isQualified ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--amber);flex:1">Score ${scores.total}/60 — below 42 minimum. Consider watching instead.</span>` : ''}
          <button class="btn btn--danger" onclick="AgentUI.recordDecision('declined')" style="padding:10px 20px;font-size:12px">
            ⏭️ Skip
          </button>
          <button class="btn btn--secondary" onclick="AgentUI.recordDecision('watch')" style="padding:10px 20px;font-size:12px">
            👀 Watch
          </button>
          <button class="btn btn--primary" onclick="AgentUI.recordDecision('approved')"
            style="padding:10px 24px;font-size:12px${!isQualified ? ';opacity:0.6' : ''}">
            ✅ Log Trade
          </button>
        </div>

      </div>
    `;
  },

  toggleDetails() {
    const el = document.getElementById('tradeDetails');
    const btn = el?.previousElementSibling;
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.innerHTML = isHidden
      ? '▲ Hide Details'
      : '▼ Show Details (why the AI likes this, risks, score breakdown)';
  },

    // Score emoji
    const scoreEmoji = scores.total >= 50 ? '🟢' : scores.total >= 42 ? '🟡' : '🔴';
    const regimeEmoji = (alert.marketRegime || '').includes('On') ? '📈' : (alert.marketRegime || '').includes('Off') ? '📉' : '➡️';

    gate.style.display = 'block';
    gate.innerHTML = `
      <div class="approval-gate">

        <!-- BIG SIMPLE HEADER -->
        <div class="approval-header">
          <div class="approval-badge ${scores.total >= 50 ? 'badge--high' : scores.total >= 42 ? 'badge--qualified' : 'badge--monitor'}">
            ${cioResult.scoreLabel}
          </div>
          <div class="approval-score" style="color:${scoreColor}">${scores.total}/60</div>
          <div class="approval-title">${alert.ticker || candidate.ticker} — ${(alert.assetType || 'EQUITY').toUpperCase()}</div>
        </div>

        <!-- SIMPLE SUMMARY CARD -->
        <div style="background:var(--bg-surface);border:2px solid ${scoreColor};border-radius:8px;padding:20px;margin:0">

          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:16px;letter-spacing:0.1em">THE SIMPLE VERSION</div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">

            <div style="text-align:center;padding:14px;background:var(--bg-raised);border-radius:6px">
              <div style="font-size:22px;margin-bottom:4px">📥</div>
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">BUY AT</div>
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--cyan)">${alert.entryZone || execution.limitPrice || '—'}</div>
            </div>

            <div style="text-align:center;padding:14px;background:var(--bg-raised);border-radius:6px">
              <div style="font-size:22px;margin-bottom:4px">🛑</div>
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">SELL IF IT DROPS TO</div>
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--red)">${alert.stopLoss || execution.stopPrice || '—'}</div>
            </div>

            <div style="text-align:center;padding:14px;background:var(--bg-raised);border-radius:6px">
              <div style="font-size:22px;margin-bottom:4px">🎯</div>
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">TAKE PROFIT AT</div>
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--green)">${alert.target || execution.targetPrice || '—'}</div>
            </div>

          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="padding:12px;background:var(--bg-raised);border-radius:6px">
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">💰 HOW MUCH TO SPEND</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:600;color:var(--text-primary)">${Utils.formatCurrency(riskResult.recommendedPositionDollar)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${riskResult.recommendedPositionPercent}% of your account</div>
            </div>
            <div style="padding:12px;background:var(--bg-raised);border-radius:6px">
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">⏱️ HOW LONG TO HOLD</div>
              <div style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--text-primary)">${alert.timeframe || '2-4 weeks'}</div>
              <div style="font-size:11px;color:var(--text-muted)">Swing trade</div>
            </div>
            <div style="padding:12px;background:var(--bg-raised);border-radius:6px">
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">📊 WIN/LOSS RATIO</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:600;color:var(--text-primary)">${alert.riskReward || '—'}</div>
              <div style="font-size:11px;color:var(--text-muted)">For every $1 risked</div>
            </div>
            <div style="padding:12px;background:var(--bg-raised);border-radius:6px">
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">${regimeEmoji} MARKET MOOD</div>
              <div style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--text-primary)">${alert.marketRegime || '—'}</div>
              <div style="font-size:11px;color:var(--text-muted)">Current regime</div>
            </div>
          </div>
        </div>

        <!-- OPTIONS CONTRACT -->
        ${options.recommendedStrategy ? `
        <div style="background:rgba(0,212,255,0.05);border:1px solid var(--cyan-dim);border-radius:8px;padding:16px;margin-top:12px">
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--cyan);margin-bottom:12px;letter-spacing:0.1em">📋 OPTIONS CONTRACT DETAILS</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">WHAT TO BUY</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--cyan)">${(options.recommendedStrategy || '').replace(/_/g,' ').toUpperCase()}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">STRIKE PRICE</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text-primary)">$${options.recommendedStrike || '—'}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">EXPIRY DATE</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--amber)">${options.recommendedExpiry || '—'}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">COST PER CONTRACT</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:${options.liveDataAvailable ? 'var(--green)' : 'var(--amber)'}">
                $${options.realPremium ? (options.realPremium * 100).toFixed(0) : options.estimatedPremium ? (options.estimatedPremium * 100).toFixed(0) : '—'}
                ${options.liveDataAvailable ? '<span style="font-size:9px;color:var(--green)"> 📡 LIVE</span>' : '<span style="font-size:9px;color:var(--amber)"> est.</span>'}
              </div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">CONTRACTS</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text-primary)">${execution.contracts || 1}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">BREAKEVEN</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text-primary)">$${options.breakeven || '—'}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">MAX YOU CAN LOSE</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--red)">$${options.maxLoss || execution.maxRisk || '—'}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:3px">ODDS OF WINNING</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text-primary)">${options.probabilityOfProfit ? Math.round(options.probabilityOfProfit * 100) + '%' : '—'}</div>
            </div>
          </div>
          ${execution.orderInstructions ? `
          <div style="margin-top:12px;padding:10px;background:var(--bg-raised);border-radius:4px;font-size:12px;color:var(--text-secondary);line-height:1.6">
            <strong style="color:var(--cyan);font-family:var(--font-mono);font-size:10px">HOW TO PLACE THE ORDER IN ROBINHOOD:</strong><br/>
            ${execution.orderInstructions}
          </div>` : ''}
        </div>` : ''}

        <!-- WHY + RISKS — SIMPLE LANGUAGE -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div style="background:rgba(0,230,118,0.04);border:1px solid var(--green-dim);border-radius:8px;padding:14px">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--green);margin-bottom:8px">✅ WHY THE AI LIKES THIS</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.thesis || '—'}</div>
          </div>
          <div style="background:rgba(255,61,87,0.04);border:1px solid var(--red-dim);border-radius:8px;padding:14px">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--red);margin-bottom:8px">⚠️ WHAT COULD GO WRONG</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.risks || '—'}</div>
          </div>
        </div>

        <!-- WALK AWAY IF -->
        <div style="background:rgba(255,193,7,0.05);border:1px solid var(--amber-dim);border-radius:8px;padding:14px;margin-top:12px">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--amber);margin-bottom:6px">🚪 WALK AWAY FROM THIS TRADE IF...</div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.invalidation || '—'}</div>
        </div>

        <!-- SCORE BREAKDOWN -->
        <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:14px;margin-top:12px">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:10px;letter-spacing:0.1em">${scoreEmoji} AI SCORE BREAKDOWN — ${scores.total}/60</div>
          <div class="approval-scores" style="padding:0">
            ${AgentUI.renderScoreBar('Technical',   scores.technical)}
            ${AgentUI.renderScoreBar('Fundamental', scores.fundamental)}
            ${AgentUI.renderScoreBar('Catalyst',    scores.catalyst)}
            ${AgentUI.renderScoreBar('Risk/Reward', scores.risk)}
            ${AgentUI.renderScoreBar('Market',      scores.market)}
            ${AgentUI.renderScoreBar('Macro',       scores.macro)}
          </div>
        </div>

        <!-- DECISION -->
        <div class="approval-actions" style="margin-top:16px">
          <button class="btn btn--danger approval-btn-decline" onclick="AgentUI.recordDecision('declined')">
            ✕ Pass on This Trade
          </button>
          <button class="btn btn--primary approval-btn-approve"
            onclick="AgentUI.recordDecision('approved')"
            ${!isQualified ? 'disabled title="Score too low — not recommended"' : ''}>
            ✓ Log to Journal & Execute
          </button>
        </div>
        ${!isQualified ? '<div class="approval-warning">Score is ' + scores.total + '/60 — minimum is 42 to trade. The AI says wait for a better setup.</div>' : ''}

      </div>
    `;
  },

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
              <span class="alert-val">${options.liveDataAvailable
                ? `$${options.realPremium} <span style="font-size:10px;color:var(--text-muted)">(bid $${options.realBid} / ask $${options.realAsk})</span>`
                : `$${options.estimatedPremium} <span style="font-size:10px;color:var(--amber)">est.</span>`
              }</span>
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

    if (decision !== 'watch') {
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
    }

    const icons   = { approved: '✅', watch: '👀', declined: '⏭️' };
    const titles  = { approved: 'Logged to Journal', watch: 'Added to Watchlist', declined: 'Skipped' };
    const msgs    = {
      approved: `Go to Robinhood and place the order. ${options.recommendedStrategy?.replace('_',' ') || ''} $${options.recommendedStrike} exp ${options.recommendedExpiry}. Stock stop: ${alert?.stopLoss} | Premium stop: ${options.estimatedPremium ? '$' + (options.estimatedPremium * 0.5).toFixed(2) : '—'}`,
      watch:    `${alert?.ticker} added to your monitor list. Run another scan or check back when price pulls back to the entry zone.`,
      declined: 'No position taken. The AI will find a better setup next scan.'
    };

    const gate = document.getElementById('approvalGate');
    if (gate) {
      gate.innerHTML = `
        <div class="pipeline-complete-block">
          <div class="complete-icon" style="font-size:36px">${icons[decision]}</div>
          <div class="complete-title">${titles[decision]}</div>
          <div class="complete-msg">${msgs[decision]}</div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:4px">
            ${decision === 'approved' ? `<button class="btn btn--secondary" onclick="App.switchTab('journal')">→ View Journal</button>` : ''}
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
