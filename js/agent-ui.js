// agent-ui.js — Pipeline UI, Candidate Queue, Approval Gate

const AgentUI = {

  currentScanId: null,
  _timer: null,
  _startTime: null,
  _queueData: null,

  // ============================================================
  // PIPELINE START
  // ============================================================
  startPipeline(scanId) {
    AgentUI.currentScanId = scanId;
    AgentUI._startTime = Date.now();
    clearInterval(AgentUI._timer);

    const container = document.getElementById('pipelineContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="pipeline-header">
        <span class="pipeline-title">PIPELINE RUNNING</span>
        <span class="pipeline-scan-id">${scanId}</span>
        <span class="pipeline-time" id="pipelineTimer">0s</span>
      </div>
      <div class="pipeline-steps" id="pipelineSteps">
        ${AgentUI.renderStep('data',    '⬡', 'Data Ingestion',          'Fetching market + macro data')}
        ${AgentUI.renderStep('agent15', '15', 'Macro Strategist',        'Classifying market regime')}
        ${AgentUI.renderStep('agent1',  '01', 'Junior Analyst',          'Scanning watchlist')}
        ${AgentUI.renderStep('agent3',  '03', 'Sector Head',             'Filtering by sector strength')}
        ${AgentUI.renderStep('agent2',  '02', 'Research Analyst',        'Technical + fundamental analysis')}
        ${AgentUI.renderStep('agent4',  '04', 'Quant Researcher',        'Statistical validation')}
        ${AgentUI.renderStep('agent5',  '05', 'Risk Manager',            'Position sizing + risk check')}
        ${AgentUI.renderStep('agent14', '14', 'Chief Investment Officer','Generating recommendation')}
        ${AgentUI.renderStep('agent16', '16', 'Options Specialist',      'Live options analysis')}
        ${AgentUI.renderStep('agent6',  '06', 'Compliance Officer',      'Rule compliance check')}
        ${AgentUI.renderStep('agent7',  '07', 'Execution Specialist',    'Order structuring')}
        ${AgentUI.renderStep('agent17', '17', 'AI Strategy Director',    'Strategy review')}
      </div>
      <div id="approvalGate" style="display:none"></div>
    `;

    AgentUI._timer = setInterval(() => {
      const s = Math.floor((Date.now() - AgentUI._startTime) / 1000);
      const el = document.getElementById('pipelineTimer');
      if (el) el.textContent = `${s}s`;
    }, 1000);
  },

  renderStep(id, num, name, defaultStatus) {
    return `
      <div class="pipeline-step" id="step-${id}">
        <div class="step-num">${num}</div>
        <div class="step-body">
          <div class="step-name">${name}</div>
          <div class="step-status" id="status-${id}">${defaultStatus}</div>
        </div>
        <div class="step-indicator" id="indicator-${id}"></div>
      </div>
    `;
  },

  setAgentStatus(id, state, message) {
    const step      = document.getElementById(`step-${id}`);
    const statusEl  = document.getElementById(`status-${id}`);
    const indicator = document.getElementById(`indicator-${id}`);
    if (!step) return;
    step.className = `pipeline-step step--${state}`;
    if (statusEl)  statusEl.textContent = message || '';
    if (indicator) {
      if (state === 'complete')  indicator.innerHTML = '<span class="step-check">✓</span>';
      else if (state === 'rejected') indicator.innerHTML = '<span class="step-reject">✕</span>';
      else if (state === 'running')  indicator.innerHTML = '<span style="color:var(--amber);font-size:12px">●</span>';
      else indicator.innerHTML = '';
    }
  },

  showError(message) {
    clearInterval(AgentUI._timer);
    const gate = document.getElementById('approvalGate');
    if (gate) {
      gate.style.display = 'block';
      gate.innerHTML = `
        <div class="pipeline-error-block">
          <div class="pipeline-error-title">⚠ Pipeline Error</div>
          <div class="pipeline-error-msg">${message}</div>
          <div class="pipeline-error-hint">Check your Worker URL and Claude API key in Agents tab.</div>
          <button class="btn btn--secondary" style="margin-top:12px" onclick="AgentUI.resetPipeline()">↻ Try Again</button>
        </div>
      `;
    }
  },

  showPipelineComplete(reason) {
    clearInterval(AgentUI._timer);
    const msgs = {
      no_candidates: 'No candidates found in your watchlist today. Try again later or add more tickers.',
      filtered_out:  'All candidates were filtered out by sector analysis. Market conditions may be unfavorable.',
      risk_rejected: 'Setup rejected by Risk Manager. Capital preservation rules prevent this trade.',
    };
    const gate = document.getElementById('approvalGate');
    if (gate) {
      gate.style.display = 'block';
      gate.innerHTML = `
        <div class="pipeline-complete-block">
          <div class="complete-icon">◈</div>
          <div class="complete-title">Scan Complete</div>
          <div class="complete-msg">${msgs[reason] || 'Pipeline finished.'}</div>
          <button class="btn btn--secondary" onclick="AgentUI.resetPipeline()">↻ Run New Scan</button>
        </div>
      `;
    }
  },

  // ============================================================
  // CANDIDATE QUEUE — Stacked list
  // ============================================================
  showCandidateQueue(candidateQueue) {
    clearInterval(AgentUI._timer);
    const gate = document.getElementById('approvalGate');
    if (!gate) return;

    const sorted = [...candidateQueue].sort((a, b) =>
      (b.cioResult?.scores?.total || 0) - (a.cioResult?.scores?.total || 0)
    );
    AgentUI._queueData = sorted;

    gate.style.display = 'block';
    gate.innerHTML = `
      <div style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.1em;color:var(--text-muted)">SCANNER RESULTS</div>
          <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:20px;padding:2px 10px;font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">
            ${sorted.length} candidate${sorted.length !== 1 ? 's' : ''}
          </div>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button onclick="AgentUI._sortQueue('score')"  id="sortScore"  style="${AgentUI._sortBtnStyle(true)}">Score ↓</button>
            <button onclick="AgentUI._sortQueue('cost')"   id="sortCost"   style="${AgentUI._sortBtnStyle(false)}">Cost ↑</button>
            <button onclick="AgentUI._sortQueue('sector')" id="sortSector" style="${AgentUI._sortBtnStyle(false)}">Sector</button>
          </div>
        </div>
        <div id="candidateQueueList">
          ${sorted.map((entry, i) => AgentUI._renderQueueCard(entry, i)).join('')}
        </div>
      </div>
    `;
  },

  _sortBtnStyle(active) {
    return active
      ? 'padding:4px 10px;border-radius:4px;border:1px solid var(--cyan);background:var(--bg-raised);color:var(--cyan);font-family:var(--font-mono);font-size:11px;cursor:pointer'
      : 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-raised);color:var(--text-muted);font-family:var(--font-mono);font-size:11px;cursor:pointer';
  },

  _sortQueue(by) {
    if (!AgentUI._queueData) return;
    let sorted;
    if (by === 'score') {
      sorted = [...AgentUI._queueData].sort((a, b) =>
        (b.cioResult?.scores?.total || 0) - (a.cioResult?.scores?.total || 0));
    } else if (by === 'cost') {
      sorted = [...AgentUI._queueData].sort((a, b) => {
        const ca = AgentUI._cheapestAffordable(a, 99999);
        const cb = AgentUI._cheapestAffordable(b, 99999);
        return ca - cb;
      });
    } else {
      sorted = [...AgentUI._queueData].sort((a, b) =>
        (a.candidate?.sector || '').localeCompare(b.candidate?.sector || ''));
    }
    ['score','cost','sector'].forEach(k => {
      const btn = document.getElementById(`sort${k.charAt(0).toUpperCase()+k.slice(1)}`);
      if (btn) btn.style.cssText = AgentUI._sortBtnStyle(k === by);
    });
    const list = document.getElementById('candidateQueueList');
    if (list) list.innerHTML = sorted.map((entry, i) => AgentUI._renderQueueCard(entry, i)).join('');
  },

  _cheapestAffordable(entry, budget) {
    const allCalls = entry.optionsRawCalls || [];
    const allPuts  = entry.optionsRawPuts  || [];
    const pool     = [...allCalls, ...allPuts].filter(c => (c.mark || 0) > 0);
    if (!pool.length) return (entry.optionsResult?.estimatedPremium || 999) * 100;
    const affordable = pool.filter(c => (c.mark * 100) <= budget);
    const use = affordable.length ? affordable : pool;
    return Math.min(...use.map(c => c.mark * 100));
  },

  _renderQueueCard(entry, rank) {
    const { candidate, quote, research, riskResult, cioResult, optionsResult } = entry;
    const scores    = cioResult?.scores || {};
    const alert     = cioResult?.tradeAlert || {};
    const total     = scores.total || 0;
    const ticker    = candidate?.ticker || alert.ticker || '—';
    const price     = quote?.regularMarketPrice || 0;
    const changePct = quote?.regularMarketChangePercent || 0;

    const scoreColor = total >= 50 ? '#4ade80'
      : total >= 42 ? 'var(--cyan)'
      : total >= 35 ? 'var(--amber)'
      : 'var(--red)';

    const scoreLabel = total >= 50 ? 'HIGH CONVICTION'
      : total >= 42 ? 'QUALIFIED'
      : total >= 35 ? 'MONITOR'
      : 'WATCH ONLY';

    const labelColor  = scoreColor;
    const labelBorder = total >= 50 ? '#2a5c36'
      : total >= 42 ? 'var(--cyan-dim)'
      : total >= 35 ? 'var(--amber-dim)'
      : 'var(--red-dim)';
    const labelBg     = total >= 50 ? 'rgba(74,222,128,0.1)'
      : total >= 42 ? 'rgba(0,212,255,0.08)'
      : total >= 35 ? 'rgba(255,193,7,0.08)'
      : 'rgba(255,61,87,0.06)';

    const scorePct = (total / 60) * 100;
    const isQualified = total >= 35;

    // Cheapest contract for header display (calls + puts combined)
    const allContracts = [...(entry.optionsRawCalls || []), ...(entry.optionsRawPuts || [])]
      .filter(c => (c.mark || 0) > 0);
    const cheapest     = allContracts.length
      ? Math.min(...allContracts.map(c => c.mark * 100))
      : (optionsResult?.estimatedPremium || 0) * 100;
    const optCostDisplay = cheapest > 0 ? `$${cheapest.toFixed(0)}` : '—';
    const liveTag = optionsResult?.liveDataAvailable
      ? `<span style="font-size:9px;color:var(--green);margin-left:4px">📡 LIVE</span>`
      : `<span style="font-size:9px;color:var(--amber);margin-left:4px">est.</span>`;

    const thesis  = alert.thesis || research?.summary || '';
    const oneLiner = (thesis.match(/[^.!?]+[.!?]+/g)?.[0] || thesis).slice(0, 110);

    const rankStyle = rank === 0
      ? 'background:#2a2206;border:1px solid var(--amber);color:var(--amber)'
      : rank === 1
      ? 'background:var(--bg-raised);border:1px solid var(--border-bright);color:var(--text-muted)'
      : 'background:var(--bg-raised);border:1px solid var(--border);color:var(--text-dim)';

    const cardId   = `qcard-${ticker}`;
    const detailId = `qdetail-${ticker}`;

    return `
      <div id="${cardId}" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;transition:border-color .15s">

        <!-- COLLAPSED HEADER ROW -->
        <div onclick="AgentUI._toggleQueueDetail('${ticker}')"
          style="display:grid;grid-template-columns:34px 88px 1fr 160px 140px 110px 110px 106px;align-items:center;gap:8px;padding:11px 14px;cursor:pointer;user-select:none">

          <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;${rankStyle}">
            ${rank + 1}
          </div>

          <div>
            <div style="font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--text-primary);letter-spacing:.04em">${ticker}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim)">
              $${price.toFixed(2)}
              <span style="color:${changePct >= 0 ? 'var(--green)' : 'var(--red)'}">${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%</span>
            </div>
          </div>

          <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:8px">
            ${oneLiner}
          </div>

          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:4px;background:var(--bg-surface);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${scorePct}%;background:${scoreColor};border-radius:2px"></div>
            </div>
            <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:${scoreColor};white-space:nowrap">${total}/60</span>
          </div>

          <div>
            <span style="padding:3px 8px;border-radius:4px;font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.04em;background:${labelBg};border:1px solid ${labelBorder};color:${labelColor}">
              ${scoreLabel}
            </span>
          </div>

          <div style="text-align:right">
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--green)">${optCostDisplay} ${liveTag}</div>
            <div style="font-size:10px;color:var(--text-dim)">cheapest contract</div>
          </div>

          <div style="font-size:11px;color:var(--text-dim);text-align:right">${candidate?.sector || '—'}</div>

          <div style="display:flex;gap:5px;justify-content:flex-end" onclick="event.stopPropagation()">
            <button onclick="AgentUI._queueLog('${ticker}')"
              style="padding:5px 10px;border-radius:4px;border:none;background:var(--green);color:#000;font-size:11px;font-weight:700;cursor:pointer;${!isQualified ? 'opacity:.45;cursor:not-allowed' : ''}"
              ${!isQualified ? 'disabled' : ''}>✓ Log</button>
            <button onclick="AgentUI._queueWatch('${ticker}')"
              style="padding:5px 10px;border-radius:4px;border:1px solid var(--border-bright);background:var(--bg-surface);color:var(--text-muted);font-size:11px;font-weight:700;cursor:pointer">👁</button>
            <button onclick="AgentUI._queueSkip('${ticker}')"
              style="padding:5px 10px;border-radius:4px;border:none;background:transparent;color:var(--text-dim);font-size:11px;cursor:pointer">✕</button>
          </div>
        </div>

        <!-- EXPANDED DETAIL -->
        <div id="${detailId}" style="display:none;border-top:1px solid var(--border)">

          ${alert.beginnerTip ? `
          <div style="padding:10px 16px;background:rgba(0,212,255,0.04);border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:8px">
            <span style="font-size:14px;flex-shrink:0">💡</span>
            <div style="font-size:12px;color:var(--cyan);line-height:1.5">${alert.beginnerTip}</div>
          </div>` : ''}

          <!-- Setup grid -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:14px 16px 10px">
            <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);font-weight:600;letter-spacing:.08em;margin-bottom:5px">ENTRY ZONE</div>
              <div style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--cyan)">${alert.entryZone || '—'}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">R/R: ${alert.riskReward || '—'} · ${alert.timeframe || '—'}</div>
            </div>
            <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);font-weight:600;letter-spacing:.08em;margin-bottom:5px">STOP / TARGET</div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:700">
                <span style="color:var(--red)">${alert.stopLoss || '—'}</span>
                <span style="color:var(--text-dim);font-size:11px"> → </span>
                <span style="color:var(--green)">${alert.target || '—'}</span>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Position: ${Utils.formatCurrency(riskResult?.recommendedPositionDollar || 0)}</div>
            </div>
            <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);font-weight:600;letter-spacing:.08em;margin-bottom:5px">SCORES</div>
              <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--text-primary)">T:${research?.technicalScore||'—'} · F:${research?.fundamentalScore||'—'} · C:${research?.catalystScore||'—'}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Risk:${scores.risk||'—'} · Market:${scores.market||'—'} · Macro:${scores.macro||'—'}</div>
            </div>
          </div>

          <!-- OPTIONS TIERS — Calls + Puts -->
          <div style="padding:0 16px 14px">
            <!-- Header row with budget filter -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);font-weight:600;letter-spacing:.08em">
                OPTIONS TIERS
                ${optionsResult?.liveDataAvailable
                  ? '<span style="font-size:9px;color:var(--green);margin-left:4px">📡 LIVE</span>'
                  : '<span style="font-size:9px;color:var(--amber);margin-left:4px">estimated</span>'}
              </div>
              <div style="margin-left:auto;display:flex;align-items:center;gap:5px">
                <span style="font-size:10px;color:var(--text-muted)">Max budget:</span>
                <select id="budget-${ticker}" onchange="AgentUI._filterTiers('${ticker}', this.value)"
                  style="font-family:var(--font-mono);font-size:11px;background:var(--bg-surface);border:1px solid var(--border-bright);border-radius:4px;padding:2px 6px;color:var(--cyan);cursor:pointer">
                  <option value="99999">Any price</option>
                  <option value="50">Under $50</option>
                  <option value="100">Under $100</option>
                  <option value="200">Under $200</option>
                  <option value="300">Under $300</option>
                  <option value="500">Under $500</option>
                  <option value="1000">Under $1,000</option>
                  <option value="2000">Under $2,000</option>
                </select>
              </div>
            </div>

            <!-- CALLS row -->
            <div style="margin-bottom:10px">
              <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.08em;color:var(--green);margin-bottom:6px;display:flex;align-items:center;gap:6px">
                📈 CALLS
                <span style="color:var(--text-dim);font-weight:400">— profit if stock goes UP</span>
                ${optionsResult?.callRecommendation?.thesis
                  ? `<span style="color:var(--text-dim);font-weight:400;font-size:9px">· ${optionsResult.callRecommendation.thesis}</span>`
                  : ''}
              </div>
              <div id="callTiers-${ticker}" style="display:flex;gap:8px">
                ${AgentUI._buildCallTiers(entry, 99999)}
              </div>
            </div>

            <!-- PUTS row -->
            <div>
              <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.08em;color:var(--red);margin-bottom:6px;display:flex;align-items:center;gap:6px">
                📉 PUTS
                <span style="color:var(--text-dim);font-weight:400">— profit if stock goes DOWN</span>
                ${optionsResult?.putRecommendation?.thesis
                  ? `<span style="color:var(--text-dim);font-weight:400;font-size:9px">· ${optionsResult.putRecommendation.thesis}</span>`
                  : ''}
              </div>
              <div id="putTiers-${ticker}" style="display:flex;gap:8px">
                ${AgentUI._buildPutTiers(entry, 99999)}
              </div>
            </div>
          </div>

          <!-- Thesis / breakdown toggle -->
          <div style="border-top:1px solid var(--border)">
            <button onclick="AgentUI._toggleThesis('${ticker}')" id="thesisBtn-${ticker}"
              style="width:100%;padding:9px 16px;background:none;border:none;font-family:var(--font-mono);font-size:11px;color:var(--cyan);cursor:pointer;text-align:left;letter-spacing:.06em">
              ▼ Full thesis, risks &amp; score breakdown
            </button>
            <div id="thesis-${ticker}" style="display:none;padding:0 16px 14px">
              ${AgentUI._renderScoreBars(scores)}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
                <div style="background:rgba(0,230,118,0.04);border:1px solid var(--green-dim);border-radius:6px;padding:12px">
                  <div style="font-family:var(--font-mono);font-size:10px;color:var(--green);margin-bottom:6px">✅ WHY THE AI LIKES THIS</div>
                  <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.thesis || '—'}</div>
                </div>
                <div style="background:rgba(255,61,87,0.04);border:1px solid var(--red-dim);border-radius:6px;padding:12px">
                  <div style="font-family:var(--font-mono);font-size:10px;color:var(--red);margin-bottom:6px">⚠️ WHAT COULD GO WRONG</div>
                  <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.risks || research?.risks || '—'}</div>
                </div>
              </div>
              ${alert.invalidation ? `
              <div style="background:rgba(255,193,7,0.05);border:1px solid var(--amber-dim);border-radius:6px;padding:12px;margin-top:10px">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--amber);margin-bottom:6px">🚪 WALK AWAY IF...</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">${alert.invalidation}</div>
              </div>` : ''}
            </div>
          </div>

          <!-- Bottom action bar -->
          <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;background:var(--bg-surface)">
            ${!isQualified
              ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--amber);flex:1">Score ${total}/60 — below 35 min. Consider watching.</span>`
              : `<span style="flex:1"></span>`}
            <button onclick="AgentUI._queueSkip('${ticker}')"
              style="padding:9px 18px;border:1px solid var(--border-bright);border-radius:4px;background:var(--bg-raised);color:var(--text-muted);font-size:12px;font-weight:700;cursor:pointer">
              ⏭️ Skip
            </button>
            <button onclick="AgentUI._queueWatch('${ticker}')"
              style="padding:9px 18px;border:1px solid var(--amber);border-radius:4px;background:rgba(255,193,7,0.08);color:var(--amber);font-size:12px;font-weight:700;cursor:pointer">
              👁 Watch
            </button>
            <button onclick="AgentUI._queueLog('${ticker}')"
              style="padding:9px 22px;border:none;border-radius:4px;background:var(--green);color:#000;font-size:12px;font-weight:800;cursor:pointer;${!isQualified ? 'opacity:.45;cursor:not-allowed' : ''}"
              ${!isQualified ? 'disabled' : ''}>
              ✅ Log Trade
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // ── Budget filter — re-renders both call and put tier rows ───
  _filterTiers(ticker, maxBudget) {
    const budget = parseInt(maxBudget);
    const entry  = AgentUI._queueData?.find(e => e.candidate?.ticker === ticker);
    if (!entry) return;

    const callEl = document.getElementById(`callTiers-${ticker}`);
    const putEl  = document.getElementById(`putTiers-${ticker}`);
    if (callEl) callEl.innerHTML = AgentUI._buildCallTiers(entry, budget);
    if (putEl)  putEl.innerHTML  = AgentUI._buildPutTiers(entry, budget);
  },

  // ── CALL TIERS ───────────────────────────────────────────────
  // Picks conservative (closest OTM / lowest cost within budget),
  // standard (mid), aggressive (furthest OTM / cheapest).
  // Budget is enforced FIRST — only contracts <= budget are shown.
  // If nothing fits, shows cheapest 3 with OVER BUDGET badges.
  _buildCallTiers(entry, maxBudget) {
    const { optionsResult, optionsRawCalls } = entry;
    const allCalls = (optionsRawCalls || []).filter(c => (c.mark || 0) > 0 && c.type !== 'put');

    // Fall back to AI recommendation if no live chain
    if (!allCalls.length) {
      const rec = optionsResult?.callRecommendation || optionsResult;
      const premium = rec?.estimatedPremium || optionsResult?.realPremium || optionsResult?.estimatedPremium;
      if (!premium) return `<div style="flex:1;font-size:11px;color:var(--text-muted);padding:10px">No call data available</div>`;
      const cost = premium * 100;
      return AgentUI._oneTierCard('🟡', 'STANDARD', rec.strike || optionsResult.recommendedStrike, rec.expiry || optionsResult.recommendedExpiry, cost, null, null, cost <= maxBudget, 'AI recommended', 'call');
    }

    return AgentUI._buildTierRow(allCalls, maxBudget, 'call');
  },

  // ── PUT TIERS ────────────────────────────────────────────────
  _buildPutTiers(entry, maxBudget) {
    const { optionsResult, optionsRawPuts, optionsRawCalls, quote } = entry;
    const underlying = quote?.regularMarketPrice || 0;

    // Try dedicated put chain first, then filter raw calls pool by type
    let allPuts = (optionsRawPuts || []).filter(c => (c.mark || 0) > 0);

    // Some workers return all contracts in allCalls — filter by type field
    if (!allPuts.length && optionsRawCalls?.length) {
      allPuts = optionsRawCalls.filter(c => c.type === 'put' && (c.mark || 0) > 0);
    }

    // Fall back to AI put recommendation
    if (!allPuts.length) {
      const rec = optionsResult?.putRecommendation;
      if (!rec?.estimatedPremium && !rec?.strike) {
        // Synthesize approximate put from AI call data + underlying price
        const callStrike  = optionsResult?.recommendedStrike || underlying;
        const callExpiry  = optionsResult?.recommendedExpiry || '';
        const callPremium = (optionsResult?.realPremium || optionsResult?.estimatedPremium || 2);
        // ATM put is roughly same premium as ATM call (put-call parity)
        const putStrike   = Math.round((underlying * 0.97) / 5) * 5; // ~3% OTM
        const putPremium  = callPremium * 0.75; // OTM puts slightly cheaper
        const cost        = putPremium * 100;
        return AgentUI._oneTierCard('🟡', 'STANDARD', putStrike, callExpiry, cost, null, null, cost <= maxBudget, 'AI estimated · put-call parity', 'put');
      }
      const cost = (rec.estimatedPremium || 0) * 100;
      return AgentUI._oneTierCard('🟡', 'STANDARD', rec.strike, rec.expiry, cost, null, null, cost <= maxBudget, rec.thesis || 'AI recommended', 'put');
    }

    return AgentUI._buildTierRow(allPuts, maxBudget, 'put');
  },

  // ── Shared tier-row builder ──────────────────────────────────
  // THE KEY FIX: filter to budget first, pick tiers from that pool.
  // Only fall back to full pool if nothing fits budget.
  _buildTierRow(contracts, maxBudget, direction) {
    // Sort by strike: calls ascending (closest OTM = lowest strike first),
    // puts descending (closest OTM = highest strike first)
    const sorted = direction === 'call'
      ? [...contracts].sort((a, b) => a.strike - b.strike)
      : [...contracts].sort((a, b) => b.strike - a.strike);

    // Split into within-budget and over-budget
    const withinBudget = sorted.filter(c => (c.mark * 100) <= maxBudget);
    const overBudget   = sorted.filter(c => (c.mark * 100) >  maxBudget);

    const noBudgetMatch = withinBudget.length === 0 && maxBudget < 99999;

    // Use within-budget if we have any; otherwise cheapest available
    const pool = withinBudget.length > 0
      ? withinBudget
      : [...sorted].sort((a, b) => a.mark - b.mark).slice(0, 6);

    if (!pool.length) return `<div style="flex:1;font-size:11px;color:var(--text-muted);padding:10px">No contracts available</div>`;

    // Pick 3 tiers: conservative = index 0 (closest OTM in budget),
    // aggressive = last (furthest OTM / cheapest), standard = middle
    const conservative = pool[0];
    const aggressive   = pool[pool.length - 1];
    const standard     = pool[Math.floor((pool.length - 1) / 2)];

    // De-duplicate if pool is small
    const seen  = new Set();
    const tiers = [
      { label: 'CONSERVATIVE', contract: conservative, note: direction === 'call' ? 'Closest to price · highest win odds' : 'Closest to price · highest win odds' },
      { label: 'STANDARD',     contract: standard,     note: 'Middle ground' },
      { label: 'AGGRESSIVE',   contract: aggressive,   note: direction === 'call' ? 'Cheapest · bigger % gain if right' : 'Cheapest · biggest % gain if drops hard' },
    ].filter(t => {
      if (!t.contract) return false;
      const key = `${t.contract.strike}-${t.contract.expiry}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const overBudgetWarning = noBudgetMatch
      ? `<div style="grid-column:1/-1;padding:6px 8px;background:rgba(255,193,7,0.08);border:1px solid var(--amber-dim);border-radius:4px;font-family:var(--font-mono);font-size:10px;color:var(--amber);margin-bottom:6px">
           ⚠ No ${direction}s under $${maxBudget.toLocaleString()} — showing ${overBudget.length} cheapest available
         </div>`
      : '';

    const emoji = { CONSERVATIVE: '🟢', STANDARD: '🟡', AGGRESSIVE: '🔴' };

    return `
      ${overBudgetWarning}
      ${tiers.map(t => {
        const mark = t.contract.mark || ((t.contract.bid + t.contract.ask) / 2) || 0;
        const cost = mark * 100;
        const affordable = cost <= maxBudget;
        return AgentUI._oneTierCard(emoji[t.label], t.label, t.contract.strike, t.contract.expiry, cost, t.contract.bid, t.contract.ask, affordable, t.note, direction);
      }).join('')}
    `;
  },

  // ── Single tier card ─────────────────────────────────────────
  _oneTierCard(emoji, label, strike, expiry, cost, bid, ask, affordable, note, direction) {
    const isCall    = direction === 'call';
    const labelColor = label === 'CONSERVATIVE' ? (isCall ? 'var(--green)' : 'var(--red)')
      : label === 'STANDARD' ? 'var(--cyan)'
      : 'var(--amber)';
    const border    = affordable ? labelColor : 'var(--red)';
    const costColor = affordable ? labelColor : 'var(--red)';

    return `
      <div style="flex:1;padding:9px 11px;background:var(--bg-surface);border:1px solid ${border};border-radius:6px;${!affordable ? 'opacity:.6' : ''}">
        <div style="display:flex;align-items:flex-start;gap:5px;margin-bottom:4px">
          <span style="font-size:12px">${emoji}</span>
          <div style="flex:1">
            <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;color:${labelColor};letter-spacing:.06em">${label}</div>
            <div style="font-size:9px;color:var(--text-dim);margin-top:1px">${note}</div>
          </div>
        </div>
        <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:3px">
          $${strike} ${isCall ? 'Call' : 'Put'} — ${expiry || '—'}
        </div>
        ${bid != null && ask != null
          ? `<div style="font-size:10px;color:var(--text-muted)">Bid $${bid} / Ask $${ask}</div>`
          : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
          <span style="font-family:var(--font-mono);font-size:15px;font-weight:700;color:${costColor}">
            ${cost > 0 ? '$' + cost.toFixed(0) : '—'}
          </span>
          <span style="font-family:var(--font-mono);font-size:9px;padding:2px 5px;border-radius:3px;font-weight:700;
            background:${affordable ? 'rgba(0,230,118,0.1)' : 'rgba(255,61,87,0.1)'};
            color:${affordable ? 'var(--green)' : 'var(--red)'}">
            ${affordable ? '✓ AFFORDABLE' : 'OVER BUDGET'}
          </span>
        </div>
      </div>
    `;
  },

  _toggleQueueDetail(ticker) {
    const detail = document.getElementById(`qdetail-${ticker}`);
    const card   = document.getElementById(`qcard-${ticker}`);
    if (!detail) return;
    const isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : 'block';
    if (card) card.style.borderColor = isOpen ? 'var(--border)' : 'var(--cyan)';
  },

  _toggleThesis(ticker) {
    const el  = document.getElementById(`thesis-${ticker}`);
    const btn = document.getElementById(`thesisBtn-${ticker}`);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.innerHTML = isHidden
      ? `▲ Hide thesis &amp; breakdown`
      : `▼ Full thesis, risks &amp; score breakdown`;
  },

  _renderScoreBars(scores) {
    const items = [
      ['Technical',   scores.technical],
      ['Fundamental', scores.fundamental],
      ['Catalyst',    scores.catalyst],
      ['Risk/Reward', scores.risk],
      ['Market',      scores.market],
      ['Macro',       scores.macro],
    ];
    return `
      <div style="margin-top:4px">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);letter-spacing:.1em;margin-bottom:8px">AI SCORE — ${scores.total || 0}/60</div>
        ${items.map(([label, val]) => {
          const pct   = ((val || 0) / 10) * 100;
          const color = val >= 7 ? 'var(--green)' : val >= 5 ? 'var(--cyan)' : val >= 3 ? 'var(--amber)' : 'var(--red)';
          return `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
              <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);width:100px;flex-shrink:0">${label}</span>
              <div style="flex:1;height:4px;background:var(--bg-surface);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:2px"></div>
              </div>
              <span style="font-family:var(--font-mono);font-size:11px;color:${color};width:32px;text-align:right">${val || 0}/10</span>
            </div>`;
        }).join('')}
      </div>
    `;
  },

  // ── Queue actions ────────────────────────────────────────────
  _queueLog(ticker) {
    const entry = AgentUI._queueData?.find(e => e.candidate?.ticker === ticker);
    if (!entry) return;
    const { cioResult, optionsResult, executionPlan } = entry;
    const alert  = cioResult?.tradeAlert || {};
    const scores = cioResult?.scores || {};
    if (scores.total < 35) return;

    Pipeline.recordDecision(AgentUI.currentScanId, 'approved', {
      ...alert,
      totalScore:        scores.total,
      optionsStrategy:   optionsResult?.recommendedStrategy,
      optionsStrike:     optionsResult?.recommendedStrike,
      optionsExpiry:     optionsResult?.recommendedExpiry,
      optionsPremium:    optionsResult?.estimatedPremium,
      optionsContracts:  executionPlan?.contracts,
      executionLimit:    executionPlan?.limitPrice,
      executionStop:     executionPlan?.stopPrice,
      executionTarget:   executionPlan?.targetPrice,
      orderInstructions: executionPlan?.orderInstructions
    });

    const card = document.getElementById(`qcard-${ticker}`);
    if (card) {
      card.style.borderColor = 'var(--green)';
      card.style.opacity     = '0.65';
      const detail = document.getElementById(`qdetail-${ticker}`);
      if (detail) detail.style.display = 'none';
    }
    Utils.toast(`${ticker} logged to journal ✓`, 'success');
  },

  _queueWatch(ticker) {
    const card = document.getElementById(`qcard-${ticker}`);
    if (!card) return;
    const watching = card.dataset.watching === '1';
    card.dataset.watching  = watching ? '0' : '1';
    card.style.borderColor = watching ? 'var(--border)' : 'var(--amber)';
    Utils.toast(`${ticker} ${watching ? 'removed from' : 'added to'} watch`, 'info');
  },

  _queueSkip(ticker) {
    const card = document.getElementById(`qcard-${ticker}`);
    if (card) {
      card.style.transition = 'opacity .2s, max-height .25s';
      card.style.opacity    = '0';
      setTimeout(() => { card.style.display = 'none'; }, 220);
    }
  },

  // ============================================================
  // LEGACY single-gate — wraps into queue for consistency
  // ============================================================
  showApprovalGate(cioResult, riskResult, candidate, quote) {
    const syntheticEntry = {
      candidate,
      quote,
      research: {
        technicalScore:   cioResult.scores?.technical,
        fundamentalScore: cioResult.scores?.fundamental,
        catalystScore:    cioResult.scores?.catalyst,
        summary:          cioResult.tradeAlert?.thesis,
        risks:            cioResult.tradeAlert?.risks
      },
      riskResult,
      quantResult:     {},
      cioResult,
      optionsResult:   Pipeline.state.results?.optionsAnalysis  || {},
      optionsRawCalls: Pipeline.state.results?.optionsRawCalls  || [],
      optionsRawPuts:  Pipeline.state.results?.optionsRawPuts   || [],
      executionPlan:   Pipeline.state.results?.executionPlan    || {}
    };
    AgentUI.showCandidateQueue([syntheticEntry]);
  },

  renderScoreBar(label, score) {
    const pct   = ((score || 0) / 10) * 100;
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
    const results   = Pipeline.state.results;
    if (!results) return;
    const alert     = results.finalRecommendation?.tradeAlert;
    const scores    = results.finalRecommendation?.scores;
    const options   = results.optionsAnalysis || {};
    const execution = results.executionPlan   || {};
    if (decision !== 'watch') {
      Pipeline.recordDecision(AgentUI.currentScanId, decision, alert ? {
        ...alert,
        totalScore:        scores?.total,
        optionsStrategy:   options.recommendedStrategy,
        optionsStrike:     options.recommendedStrike,
        optionsExpiry:     options.recommendedExpiry,
        optionsPremium:    options.estimatedPremium,
        optionsContracts:  execution.contracts,
        executionLimit:    execution.limitPrice,
        orderInstructions: execution.orderInstructions
      } : null);
    }
    Utils.toast(
      decision === 'approved' ? 'Logged to Journal ✓'
      : decision === 'watch'  ? 'Added to watch list'
      : 'Skipped', 'info'
    );
  },

  resetPipeline() {
    clearInterval(AgentUI._timer);
    AgentUI._queueData = null;
    const container = document.getElementById('pipelineContainer');
    if (container) {
      container.innerHTML = `
        <div class="pipeline-idle">
          <div class="pipeline-idle-icon">◈</div>
          <div class="pipeline-idle-text">Pipeline ready. Add tickers to your watchlist and run the AI analysis.</div>
        </div>
      `;
    }
  }
};
