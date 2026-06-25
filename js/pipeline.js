// pipeline.js — Parallel Agent Pipeline for ATIS Phase 5

const Pipeline = {

  STORAGE_KEY: 'atis_pipelineResults',
  state: {
    running: false,
    scanId: null,
    results: null,
    error: null
  },

  async run(watchlist) {
    if (Pipeline.state.running) { Utils.toast('Pipeline already running', 'warn'); return; }

    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) { Utils.toast('Worker URL not set in Agents tab', 'error'); return; }

    Pipeline.state.running = true;
    Pipeline.state.error   = null;
    Pipeline.state.scanId  = Utils.generateScanId();

    const results = {
      scanId: Pipeline.state.scanId,
      timestamp: Date.now(),
      watchlist,
      agents: {},
      finalRecommendation: null,
      status: 'running'
    };

    Pipeline.state.results = results;
    AgentUI.startPipeline(results.scanId);

    try {
      // ── WAVE 0: Data fetch ──────────────────────────────────────
      AgentUI.setAgentStatus('data', 'running', 'Fetching market data...');
      const marketData = await Pipeline.fetchAllData(watchlist, prefs.workerUrl);
      AgentUI.setAgentStatus('data', 'complete', `Data loaded for ${Object.keys(marketData.quotes || {}).length} tickers`);

      // ── WAVE 1: Macro (must go first) ───────────────────────────
      AgentUI.setAgentStatus('agent15', 'running', 'Classifying market regime...');
      const macroResult = await Pipeline.callAgent('agent15', AGENT_PROMPTS.macroStrategist, {
        task: 'classify_regime', macroData: marketData.macro, indexData: marketData.indices
      }, prefs.workerUrl);
      results.agents.agent15 = macroResult;
      AgentUI.setAgentStatus('agent15', 'complete', `Regime: ${macroResult.regime} (${macroResult.totalScore}/50)`);

      // ── WAVE 2: Scan first, then sector filter with candidates ───
      const portfolio  = Storage.getPortfolio();
      const riskState  = Storage.getRiskState();

      // Price-tier rotation — cycle through budget levels each scan
      // so users see affordable options regularly
      const scanLog    = Storage.get('atis_scanLog') || [];
      const scanCount  = scanLog.length;
      const tierCycle  = scanCount % 3; // 0=any, 1=prefer cheap, 2=prefer mid

      const quotes = marketData.quotes;

      // Categorize watchlist by price
      const cheapTickers  = watchlist.filter(t => {
        const p = quotes[t]?.regularMarketPrice || 0;
        return p > 0 && p < 50;
      });
      const midTickers    = watchlist.filter(t => {
        const p = quotes[t]?.regularMarketPrice || 0;
        return p >= 50 && p < 200;
      });
      const expTickers    = watchlist.filter(t => {
        const p = quotes[t]?.regularMarketPrice || 0;
        return p >= 200;
      });

      // Build tier hint for Agent 1
      const tierHint = tierCycle === 1 && cheapTickers.length
        ? `PRIORITY THIS SCAN: Focus on these lower-priced tickers first (options under $200/contract): ${cheapTickers.slice(0,10).join(', ')}`
        : tierCycle === 2 && midTickers.length
        ? `PRIORITY THIS SCAN: Focus on these mid-priced tickers (options $100-500/contract): ${midTickers.slice(0,10).join(', ')}`
        : 'Scan all tickers and pick the best setups across all price ranges';

      AgentUI.setAgentStatus('agent1', 'running', 'Scanning watchlist...');
      const scanResult = await Pipeline.callAgent('agent1', AGENT_PROMPTS.juniorAnalyst, {
        task: 'scan_candidates',
        watchlist,
        quotes: marketData.quotes,
        macroRegime: macroResult.regime,
        scoreThreshold: macroResult.scoreThreshold || 42,
        tierHint,
        cheapTickers:  cheapTickers.slice(0, 15),
        midTickers:    midTickers.slice(0, 15),
        priceTierFocus: tierCycle === 1 ? 'cheap' : tierCycle === 2 ? 'mid' : 'all'
      }, prefs.workerUrl);

      results.agents.agent1 = scanResult;

      if (!scanResult.candidates?.length) {
        AgentUI.setAgentStatus('agent1', 'complete', 'No candidates found');
        AgentUI.setAgentStatus('agent3', 'complete', 'No candidates to filter');
        Pipeline.finish(results, 'no_candidates');
        return;
      }
      AgentUI.setAgentStatus('agent1', 'complete', `${scanResult.candidates.length} candidates identified`);

      // Agent 3 runs after Agent 1 so it has the real candidate list
      AgentUI.setAgentStatus('agent3', 'running', 'Filtering by sector strength...');
      const sectorPreResult = await Pipeline.callAgent('agent3', AGENT_PROMPTS.sectorHead, {
        task: 'filter_by_sector',
        candidates: scanResult.candidates,
        sectorData: marketData.sectors,
        macroRegime: macroResult.regime
      }, prefs.workerUrl);

      results.agents.agent3 = sectorPreResult;

      // If sector filter returns empty, fall back to all candidates
      const filteredCandidates = (sectorPreResult.filteredCandidates?.length
        ? sectorPreResult.filteredCandidates
        : scanResult.candidates).filter(Boolean);

      AgentUI.setAgentStatus('agent3', 'complete', `${filteredCandidates.length} candidates passed sector filter`);

      if (!filteredCandidates.length) { Pipeline.finish(results, 'filtered_out'); return; }

      // Rotate to avoid always picking same ticker
      const lastTicker   = scanLog[0]?.ticker;
      const rotated      = filteredCandidates.filter(c => c.ticker !== lastTicker);
      const topCandidate = rotated[0] || filteredCandidates[0];
      scanLog.unshift({ ticker: topCandidate.ticker, date: new Date().toISOString(), tier: tierCycle });
      Storage.set('atis_scanLog', scanLog.slice(0, 20));

      // ── WAVE 3: Research + Live Options in parallel ──────────────
      AgentUI.setAgentStatus('agent2', 'running', `Analyzing ${topCandidate.ticker}...`);

      const [researchResult, liveOptionsData] = await Promise.all([
        Pipeline.callAgent('agent2', AGENT_PROMPTS.researchAnalyst, {
          task: 'analyze_candidate',
          ticker: topCandidate.ticker,
          quote: marketData.quotes[topCandidate.ticker],
          sector: topCandidate.sector,
          macroRegime: macroResult.regime
        }, prefs.workerUrl),
        Phase5.fetchLiveOptionsChain(topCandidate.ticker, null, null, prefs.workerUrl)
          .catch(() => null)
      ]);

      results.agents.agent2 = researchResult;
      AgentUI.setAgentStatus('agent2', 'complete',
        `Tech: ${researchResult.technicalScore}/10 | Fund: ${researchResult.fundamentalScore}/10 | Cat: ${researchResult.catalystScore}/10`);
      AgentUI.setAgentStatus('agent16', 'running', liveOptionsData ? 'Live data loaded — analyzing...' : 'Estimating from model...');

      // ── WAVE 4: Risk + Quant in parallel ────────────────────────
      AgentUI.setAgentStatus('agent5', 'running', 'Evaluating risk...');
      AgentUI.setAgentStatus('agent4', 'running', 'Statistical validation...');

      const [riskResult, quantResult] = await Promise.all([
        Pipeline.callAgent('agent5', AGENT_PROMPTS.riskManager, {
          task: 'evaluate_risk',
          ticker: topCandidate.ticker,
          accountValue: portfolio.currentValue,
          cashAvailable: portfolio.cashAvailable,
          peakValue: portfolio.peakValue,
          activePositions: portfolio.positions.length,
          dailyPLPercent: riskState.dailyPLPercent || 0,
          weeklyPLPercent: riskState.weeklyPLPercent || 0,
          monthlyPLPercent: riskState.monthlyPLPercent || 0,
          hardFloor: 250,
          macroRegime: macroResult.regime,
          compositeScore: (researchResult.technicalScore + researchResult.fundamentalScore + researchResult.catalystScore) * 2,
          sectorExposure: portfolio.exposure?.sectors || {},
          candidateSector: topCandidate.sector
        }, prefs.workerUrl),
        Pipeline.callAgent('agent4', AGENT_PROMPTS_P4.quantResearcher, {
          task: 'quant_validation',
          ticker: topCandidate.ticker,
          technicalScore: researchResult.technicalScore,
          trend: researchResult.technical?.trend,
          rsiSignal: researchResult.technical?.rsiSignal,
          volumeConfirmation: researchResult.technical?.volumeConfirmation,
          accountValue: portfolio.currentValue,
          positionCount: portfolio.positions.length
        }, prefs.workerUrl)
      ]);

      results.agents.agent5 = riskResult;
      results.agents.agent4 = quantResult;
      AgentUI.setAgentStatus('agent4', 'complete', `Quant: ${quantResult.quantScore}/10 | ${quantResult.recommendation}`);

      if (riskResult.decision === 'REJECTED') {
        AgentUI.setAgentStatus('agent5', 'rejected', `REJECTED: ${riskResult.reason}`);
        Pipeline.finish(results, 'risk_rejected');
        return;
      }
      AgentUI.setAgentStatus('agent5', 'complete',
        `APPROVED — ${Utils.formatCurrency(riskResult.recommendedPositionDollar)} (${riskResult.recommendedPositionPercent}%)`);

      // ── WAVE 5: CIO + Options Specialist in parallel ─────────────
      AgentUI.setAgentStatus('agent14', 'running', 'Generating recommendation...');

      const [cioResult, optionsResult] = await Promise.all([
        Pipeline.callAgent('agent14', AGENT_PROMPTS.cio, {
          task: 'final_review',
          ticker: topCandidate.ticker,
          macroRegime: macroResult.regime,
          macroScore: macroResult.totalScore,
          sector: topCandidate.sector,
          technicalScore: researchResult.technicalScore,
          fundamentalScore: researchResult.fundamentalScore,
          catalystScore: researchResult.catalystScore,
          riskDecision: riskResult.decision,
          positionDollar: riskResult.recommendedPositionDollar,
          positionPercent: riskResult.recommendedPositionPercent,
          quote: marketData.quotes[topCandidate.ticker],
          accountValue: portfolio.currentValue,
          summary: researchResult.summary,
          risks: researchResult.risks,
          catalyst: researchResult.catalyst
        }, prefs.workerUrl),
        Pipeline.callAgent('agent16', AGENT_PROMPTS_P4.optionsSpecialist, {
          task: 'options_analysis',
          ticker: topCandidate.ticker,
          price: marketData.quotes[topCandidate.ticker]?.regularMarketPrice,
          trend: researchResult.technical?.trend,
          macroRegime: macroResult.regime,
          accountValue: portfolio.currentValue,
          catalystExists: researchResult.catalyst?.exists,
          liveIV: liveOptionsData?.bestCall?.impliedVolatility
            ? Utils.round(liveOptionsData.bestCall.impliedVolatility * 100, 1) : null,
          liveBid:    liveOptionsData?.bestCall?.bid,
          liveAsk:    liveOptionsData?.bestCall?.ask,
          liveOI:     liveOptionsData?.bestCall?.openInterest,
          liveStrike: liveOptionsData?.bestCall?.strike,
          liveExpiry: liveOptionsData?.bestCall?.expiry
        }, prefs.workerUrl)
      ]);

      results.agents.agent14 = cioResult;
      AgentUI.setAgentStatus('agent14', 'complete', `${cioResult.scoreLabel} — Score: ${cioResult.scores.total}/60`);

      // Attach live options data — use Worker's recommended contract directly
      if (liveOptionsData?.bestCall) {
        const liveContract = Phase5.formatContract(liveOptionsData.bestCall, 'call');
        console.log('Live contract:', liveContract);
        optionsResult.liveContract      = liveContract;
        optionsResult.liveDataAvailable = !!(liveContract?.premium && liveContract.premium > 0.50);
        if (liveContract?.premium && liveContract.premium > 0.50) {
          optionsResult.estimatedPremium  = liveContract.premium;
          optionsResult.realPremium       = liveContract.premium;
          optionsResult.realBid           = liveContract.bid;
          optionsResult.realAsk           = liveContract.ask;
          // Use live strike/expiry if AI's recommendation has no real price
          optionsResult.recommendedStrike = liveContract.strike;
          optionsResult.recommendedExpiry = liveContract.expiry;
        }
      } else {
        optionsResult.liveDataAvailable = false;
      }
      results.agents.agent16 = optionsResult;
      AgentUI.setAgentStatus('agent16', 'complete',
        `${optionsResult.recommendedStrategy} | ${optionsResult.liveDataAvailable ? '📡 Live' : '📊 Est'} $${optionsResult.estimatedPremium} | ${optionsResult.optionsScore}/10`);

      // ── WAVE 6: Compliance + Execution + Strategy in parallel ────
      AgentUI.setAgentStatus('agent6',  'running', 'Compliance check...');
      AgentUI.setAgentStatus('agent7',  'running', 'Structuring order...');
      AgentUI.setAgentStatus('agent17', 'running', 'Strategy review...');

      const [complianceResult, executionResult, strategyResult] = await Promise.all([
        Pipeline.callAgent('agent6', AGENT_PROMPTS_P4.complianceOfficer, {
          task: 'compliance_check',
          ticker: topCandidate.ticker,
          macroClassified: true,
          sectorEvaluated: true,
          riskManagerApproved: riskResult.decision === 'APPROVED',
          positionSize: riskResult.recommendedPositionDollar,
          accountValue: portfolio.currentValue,
          stopLoss: cioResult.tradeAlert?.stopLoss,
          target: cioResult.tradeAlert?.target,
          riskReward: cioResult.tradeAlert?.riskReward,
          totalScore: cioResult.scores.total
        }, prefs.workerUrl),
        Pipeline.callAgent('agent7', AGENT_PROMPTS_P4.executionSpecialist, {
          task: 'structure_order',
          ticker: topCandidate.ticker,
          price: marketData.quotes[topCandidate.ticker]?.regularMarketPrice,
          positionDollar: riskResult.recommendedPositionDollar,
          accountValue: portfolio.currentValue,
          entryZone: cioResult.tradeAlert?.entryZone,
          stopLoss: cioResult.tradeAlert?.stopLoss,
          target: cioResult.tradeAlert?.target,
          recommendedStrategy: optionsResult.recommendedStrategy,
          recommendedStrike: optionsResult.recommendedStrike,
          recommendedExpiry: optionsResult.recommendedExpiry
        }, prefs.workerUrl),
        Pipeline.callAgent('agent17', AGENT_PROMPTS_P4.strategyDirector, {
          task: 'strategy_review',
          accountValue: portfolio.currentValue,
          startingCapital: portfolio.startingCapital || 1500,
          totalScore: cioResult.scores.total,
          riskDecision: riskResult.decision,
          quantRecommendation: quantResult.recommendation,
          complianceViolations: [],
          regime: macroResult.regime,
          ticker: topCandidate.ticker,
          recentTradeCount: Storage.getTradeLog().length
        }, prefs.workerUrl)
      ]);

      results.agents.agent6  = complianceResult;
      results.agents.agent7  = executionResult;
      results.agents.agent17 = strategyResult;

      AgentUI.setAgentStatus('agent6',  'complete', complianceResult.compliant ? 'COMPLIANT' : `VIOLATION: ${complianceResult.violations?.[0]}`);
      AgentUI.setAgentStatus('agent7',  'complete', `${executionResult.orderType} @ $${executionResult.limitPrice} | Risk: ${Utils.formatCurrency(executionResult.maxRisk)}`);
      AgentUI.setAgentStatus('agent17', 'complete', `System: ${strategyResult.systemHealth} | Progress: ${strategyResult.smallAccountProgress?.progressPercent?.toFixed(1)}%`);

      results.finalRecommendation = cioResult;
      results.executionPlan       = executionResult;
      results.optionsAnalysis     = optionsResult;
      // Store raw calls for 3-tier display
      results.optionsRawCalls     = liveOptionsData?.allCalls || [];
      results.status              = 'awaiting_approval';

      Pipeline.saveResults(results);
      AgentUI.showApprovalGate(cioResult, riskResult, topCandidate, marketData.quotes[topCandidate.ticker]);

    } catch (err) {
      console.error('Pipeline error:', err);
      Pipeline.state.error = err.message;
      AgentUI.showError(err.message);
      Utils.toast('Pipeline error: ' + err.message, 'error');
      results.status = 'error';
    } finally {
      Pipeline.state.running     = false;
      Pipeline.state.currentAgent = null;
    }
  },

  async callAgent(agentId, systemPrompt, contextPayload, workerUrl) {
    const response = await fetch(`${workerUrl}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, systemPrompt, context: contextPayload })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Agent ${agentId} failed: ${response.status} — ${errText}`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    Storage.recordApiCall(data.inputTokens || 800, data.outputTokens || 400);
    return data.output;
  },

  async fetchAllData(watchlist, workerUrl) {
    const allTickers = [...new Set([
      ...watchlist.filter(t => !t.startsWith('^')),
      'SPY', 'QQQ', 'IWM', '^VIX',
      ...Utils.SECTOR_ETFS
    ])];

    const [quotesRes, macroRes] = await Promise.allSettled([
      fetch(`${workerUrl}/api/market-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: allTickers, fields: ['quote'] })
      }).then(r => r.json()),
      fetch(`${workerUrl}/api/macro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(r => r.json())
    ]);

    const quotes = quotesRes.status === 'fulfilled' ? (quotesRes.value.data || {}) : {};
    const macro  = macroRes.status  === 'fulfilled' ? macroRes.value : {};

    Object.entries(quotes).forEach(([ticker, data]) => {
      if (data) Storage.cacheMarketData(ticker, { ...data, ticker });
    });

    const sectors = {};
    Utils.SECTOR_ETFS.forEach(etf => { if (quotes[etf]) sectors[etf] = quotes[etf]; });

    return {
      quotes, macro, sectors,
      indices: { SPY: quotes['SPY'], QQQ: quotes['QQQ'], IWM: quotes['IWM'], VIX: quotes['^VIX'] }
    };
  },

  finish(results, reason) {
    results.status = reason;
    Pipeline.saveResults(results);
    AgentUI.showPipelineComplete(reason);
    Pipeline.state.running = false;
  },

  saveResults(results) {
    const log = Storage.get(Pipeline.STORAGE_KEY) || [];
    const existing = log.findIndex(r => r.scanId === results.scanId);
    if (existing >= 0) log[existing] = results;
    else log.unshift(results);
    Storage.set(Pipeline.STORAGE_KEY, log.slice(0, 50));
  },

  getResults() { return Storage.get(Pipeline.STORAGE_KEY) || []; },

  recordDecision(scanId, decision, tradeData) {
    const log = Storage.get(Pipeline.STORAGE_KEY) || [];
    const idx = log.findIndex(r => r.scanId === scanId);
    if (idx >= 0) {
      log[idx].humanDecision     = decision;
      log[idx].humanDecisionTime = Date.now();
      log[idx].status            = decision === 'approved' ? 'approved' : 'declined';
      Storage.set(Pipeline.STORAGE_KEY, log);
    }
    if (decision === 'approved' && tradeData) {
      const trade = {
        tradeId:           Utils.generateTradeId(),
        scanId,
        date:              new Date().toISOString().split('T')[0],
        ticker:            tradeData.ticker,
        assetType:         tradeData.assetType,
        strategyName:      tradeData.setupType,
        marketRegime:      tradeData.marketRegime,
        entryPrice:        tradeData.executionLimit || null,
        exitPrice:         null,
        positionSize:      tradeData.optionsContracts || null,
        stopLoss:          tradeData.stopLoss,
        target:            tradeData.target,
        totalScore:        tradeData.totalScore,
        optionsStrategy:   tradeData.optionsStrategy,
        optionsStrike:     tradeData.optionsStrike,
        optionsExpiry:     tradeData.optionsExpiry,
        optionsPremium:    tradeData.optionsPremium,
        orderInstructions: tradeData.orderInstructions,
        status:            'open',
        result:            null,
        timestamp:         Date.now()
      };
      Storage.addTrade(trade);
      Utils.toast(`Trade logged: ${trade.ticker} — ${trade.tradeId}`, 'success');

      // Phase 5 auto-log
      const optionsResult  = log[idx]?.optionsAnalysis  || Pipeline.state.results?.optionsAnalysis;
      const executionResult = log[idx]?.executionPlan   || Pipeline.state.results?.executionPlan;
      if (optionsResult && executionResult) {
        Phase5UI.autoLogFromPipeline(
          { tradeAlert: tradeData, scores: { total: tradeData.totalScore } },
          optionsResult, executionResult, scanId
        );
      }
    }
  }
};
