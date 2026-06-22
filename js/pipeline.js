// pipeline.js — Agent Pipeline Orchestrator for ATIS Phase 3

const Pipeline = {

  STORAGE_KEY: 'atis_pipelineResults',
  state: {
    running: false,
    currentAgent: null,
    scanId: null,
    results: null,
    error: null
  },

  // ============================================================
  // MAIN PIPELINE RUNNER
  // ============================================================
  async run(watchlist) {
    if (Pipeline.state.running) {
      Utils.toast('Pipeline already running', 'warn');
      return;
    }

    const prefs = Storage.getPrefs();
    if (!prefs.workerUrl) {
      Utils.toast('Worker URL not set', 'error');
      return;
    }

    Pipeline.state.running = true;
    Pipeline.state.error = null;
    Pipeline.state.scanId = Utils.generateScanId();

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
      // Fetch all market data first
      AgentUI.setAgentStatus('data', 'running', 'Fetching market data...');
      const marketData = await Pipeline.fetchAllData(watchlist, prefs.workerUrl);
      AgentUI.setAgentStatus('data', 'complete', `Data loaded for ${Object.keys(marketData.quotes || {}).length} tickers`);

      // AGENT 15 — Macro Strategist
      AgentUI.setAgentStatus('agent15', 'running', 'Classifying market regime...');
      const macroResult = await Pipeline.callAgent(
        'agent15',
        AGENT_PROMPTS.macroStrategist,
        {
          task: 'classify_regime',
          macroData: marketData.macro,
          indexData: marketData.indices
        },
        prefs.workerUrl
      );
      results.agents.agent15 = macroResult;
      AgentUI.setAgentStatus('agent15', 'complete',
        `Regime: ${macroResult.regime} (${macroResult.totalScore}/50)`);

      // AGENT 1 — Junior Analyst
      AgentUI.setAgentStatus('agent1', 'running', 'Scanning watchlist...');
      const scanResult = await Pipeline.callAgent(
        'agent1',
        AGENT_PROMPTS.juniorAnalyst,
        {
          task: 'scan_candidates',
          watchlist,
          quotes: marketData.quotes,
          macroRegime: macroResult.regime,
          scoreThreshold: macroResult.scoreThreshold || 42
        },
        prefs.workerUrl
      );
      results.agents.agent1 = scanResult;

      if (!scanResult.candidates || scanResult.candidates.length === 0) {
        AgentUI.setAgentStatus('agent1', 'complete', 'No candidates found — market conditions unfavorable');
        Pipeline.finish(results, 'no_candidates');
        return;
      }
      AgentUI.setAgentStatus('agent1', 'complete',
        `${scanResult.candidates.length} candidates identified`);

      // AGENT 3 — Sector Head
      AgentUI.setAgentStatus('agent3', 'running', 'Filtering by sector strength...');
      const sectorResult = await Pipeline.callAgent(
        'agent3',
        AGENT_PROMPTS.sectorHead,
        {
          task: 'filter_by_sector',
          candidates: scanResult.candidates,
          sectorData: marketData.sectors,
          macroRegime: macroResult.regime
        },
        prefs.workerUrl
      );
      results.agents.agent3 = sectorResult;

      const filteredCandidates = sectorResult.filteredCandidates || scanResult.candidates;
      if (!filteredCandidates.length) {
        AgentUI.setAgentStatus('agent3', 'complete', 'All candidates filtered out — weak sector conditions');
        Pipeline.finish(results, 'filtered_out');
        return;
      }
      AgentUI.setAgentStatus('agent3', 'complete',
        `${filteredCandidates.length} candidates passed sector filter`);

      // AGENT 2 — Research Analyst (top candidate only for Phase 3)
      const topCandidate = filteredCandidates[0];
      AgentUI.setAgentStatus('agent2', 'running',
        `Analyzing ${topCandidate.ticker}...`);

      const researchResult = await Pipeline.callAgent(
        'agent2',
        AGENT_PROMPTS.researchAnalyst,
        {
          task: 'analyze_candidate',
          ticker: topCandidate.ticker,
          quote: marketData.quotes[topCandidate.ticker],
          sector: topCandidate.sector,
          macroRegime: macroResult.regime,
          indicators: marketData.indicators?.[topCandidate.ticker]
        },
        prefs.workerUrl
      );
      results.agents.agent2 = researchResult;
      AgentUI.setAgentStatus('agent2', 'complete',
        `Tech: ${researchResult.technicalScore}/10 | Fund: ${researchResult.fundamentalScore}/10 | Cat: ${researchResult.catalystScore}/10`);

      // AGENT 5 — Risk Manager
      AgentUI.setAgentStatus('agent5', 'running', 'Evaluating risk...');
      const portfolio = Storage.getPortfolio();
      const riskState = Storage.getRiskState();

      const riskResult = await Pipeline.callAgent(
        'agent5',
        AGENT_PROMPTS.riskManager,
        {
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
        },
        prefs.workerUrl
      );
      results.agents.agent5 = riskResult;

      if (riskResult.decision === 'REJECTED') {
        AgentUI.setAgentStatus('agent5', 'rejected',
          `REJECTED: ${riskResult.reason}`);
        Pipeline.finish(results, 'risk_rejected');
        return;
      }
      AgentUI.setAgentStatus('agent5', 'complete',
        `APPROVED — Position: ${Utils.formatCurrency(riskResult.recommendedPositionDollar)} (${riskResult.recommendedPositionPercent}%)`);

      // AGENT 14 — CIO
      AgentUI.setAgentStatus('agent14', 'running', 'Generating investment thesis...');
      const cioResult = await Pipeline.callAgent(
        'agent14',
        AGENT_PROMPTS.cio,
        {
          task: 'final_review',
          ticker: topCandidate.ticker,
          macroResult,
          sectorResult: { topSector: topCandidate.sector, strength: topCandidate.sectorStrength },
          researchResult,
          riskResult,
          quote: marketData.quotes[topCandidate.ticker],
          accountValue: portfolio.currentValue
        },
        prefs.workerUrl
      );
      results.agents.agent14 = cioResult;
      AgentUI.setAgentStatus('agent14', 'complete',
        `${cioResult.scoreLabel} — Score: ${cioResult.scores.total}/60`);

      // AGENT 4 — Quant Researcher (Phase 4)
      AgentUI.setAgentStatus('agent4', 'running', 'Statistical validation...');
      const quantResult = await Pipeline.callAgent(
        'agent4',
        AGENT_PROMPTS_P4.quantResearcher,
        {
          task: 'quant_validation',
          ticker: topCandidate.ticker,
          researchResult,
          quote: marketData.quotes[topCandidate.ticker],
          accountValue: portfolio.currentValue,
          existingPositions: portfolio.positions
        },
        prefs.workerUrl
      );
      results.agents.agent4 = quantResult;
      AgentUI.setAgentStatus('agent4', 'complete',
        `Quant Score: ${quantResult.quantScore}/10 | ${quantResult.recommendation}`);

      // AGENT 16 — Options Specialist (Phase 5 — live options data)
      AgentUI.setAgentStatus('agent16', 'running', 'Fetching live options chain...');

      // Fetch LIVE options chain
      let liveOptionsData = null;
      try {
        liveOptionsData = await Phase5.fetchLiveOptionsChain(
          topCandidate.ticker, null, null, prefs.workerUrl
        );
        if (liveOptionsData) {
          AgentUI.setAgentStatus('agent16', 'running', `Live options loaded — analyzing...`);
        }
      } catch (err) {
        console.warn('Live options fetch failed:', err.message);
      }

      const optionsResult = await Pipeline.callAgent(
        'agent16',
        AGENT_PROMPTS_P4.optionsSpecialist,
        {
          task: 'options_analysis',
          ticker: topCandidate.ticker,
          price: marketData.quotes[topCandidate.ticker]?.regularMarketPrice,
          trend: researchResult.technical?.trend,
          macroRegime: macroResult.regime,
          accountValue: portfolio.currentValue,
          catalystExists: researchResult.catalyst?.exists,
          liveIV: liveOptionsData?.bestCall?.impliedVolatility
            ? Utils.round(liveOptionsData.bestCall.impliedVolatility * 100, 1) : null,
          liveBid: liveOptionsData?.bestCall?.bid,
          liveAsk: liveOptionsData?.bestCall?.ask,
          liveOI:  liveOptionsData?.bestCall?.openInterest,
          liveStrike: liveOptionsData?.bestCall?.strike,
          liveExpiry: liveOptionsData?.bestCall?.expiry
        },
        prefs.workerUrl
      );

      // Attach live contract data
      if (liveOptionsData) {
        const isCall = !optionsResult.recommendedStrategy?.includes('put');
        const liveContract = Phase5.formatContract(
          isCall ? liveOptionsData.bestCall : liveOptionsData.bestPut,
          isCall ? 'call' : 'put'
        );
        optionsResult.liveContract = liveContract;
        optionsResult.liveDataAvailable = true;
        if (liveContract?.premium) {
          optionsResult.estimatedPremium = liveContract.premium;
          optionsResult.realPremium = liveContract.premium;
        }
      } else {
        optionsResult.liveDataAvailable = false;
      }

      results.agents.agent16 = optionsResult;
      AgentUI.setAgentStatus('agent16', 'complete',
        `${optionsResult.recommendedStrategy} | ${optionsResult.liveDataAvailable ? '📡 Live' : '📊 Estimated'} $${optionsResult.estimatedPremium} | Score: ${optionsResult.optionsScore}/10`);

      // AGENT 6 — Compliance (Phase 4)
      AgentUI.setAgentStatus('agent6', 'running', 'Compliance check...');
      const complianceResult = await Pipeline.callAgent(
        'agent6',
        AGENT_PROMPTS_P4.complianceOfficer,
        {
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
        },
        prefs.workerUrl
      );
      results.agents.agent6 = complianceResult;
      AgentUI.setAgentStatus('agent6', 'complete',
        complianceResult.compliant ? 'COMPLIANT' : `VIOLATION: ${complianceResult.violations?.[0]}`);

      // AGENT 7 — Execution Specialist (Phase 4)
      AgentUI.setAgentStatus('agent7', 'running', 'Order structuring...');
      const executionResult = await Pipeline.callAgent(
        'agent7',
        AGENT_PROMPTS_P4.executionSpecialist,
        {
          task: 'structure_order',
          ticker: topCandidate.ticker,
          quote: marketData.quotes[topCandidate.ticker],
          positionDollar: riskResult.recommendedPositionDollar,
          accountValue: portfolio.currentValue,
          tradeAlert: cioResult.tradeAlert,
          optionsResult
        },
        prefs.workerUrl
      );
      results.agents.agent7 = executionResult;
      AgentUI.setAgentStatus('agent7', 'complete',
        `${executionResult.orderType} @ $${executionResult.limitPrice} | Risk: ${Utils.formatCurrency(executionResult.maxRisk)}`);

      // AGENT 17 — Strategy Director (Phase 4)
      AgentUI.setAgentStatus('agent17', 'running', 'Strategy review...');
      const strategyResult = await Pipeline.callAgent(
        'agent17',
        AGENT_PROMPTS_P4.strategyDirector,
        {
          task: 'strategy_review',
          accountValue: portfolio.currentValue,
          startingCapital: portfolio.startingCapital,
          tradeHistory: Storage.getTradeLog().slice(0, 20),
          strategyPerformance: Storage.getStrategyPerf(),
          agentResults: { macroResult, researchResult, quantResult, riskResult, cioResult }
        },
        prefs.workerUrl
      );
      results.agents.agent17 = strategyResult;
      AgentUI.setAgentStatus('agent17', 'complete',
        `System: ${strategyResult.systemHealth} | Progress: ${strategyResult.smallAccountProgress?.progressPercent?.toFixed(1)}%`);

      // Set final recommendation
      results.finalRecommendation = cioResult;
      results.executionPlan = executionResult;
      results.optionsAnalysis = optionsResult;
      results.status = 'awaiting_approval';

      // Store results
      Pipeline.saveResults(results);

      // Show human approval gate
      AgentUI.showApprovalGate(cioResult, riskResult, topCandidate, marketData.quotes[topCandidate.ticker]);

    } catch (err) {
      console.error('Pipeline error:', err);
      Pipeline.state.error = err.message;
      AgentUI.showError(err.message);
      Utils.toast('Pipeline error: ' + err.message, 'error');
      results.status = 'error';
    } finally {
      Pipeline.state.running = false;
      Pipeline.state.currentAgent = null;
    }
  },

  // ============================================================
  // AGENT API CALL
  // ============================================================
  async callAgent(agentId, systemPrompt, contextPayload, workerUrl) {
    Pipeline.state.currentAgent = agentId;

    const response = await fetch(`${workerUrl}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        systemPrompt,
        context: contextPayload
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Agent ${agentId} failed: ${response.status} — ${errText}`);
    }

    const data = await response.json();

    if (data.error) throw new Error(data.error);

    // Track API cost
    Storage.recordApiCall(data.inputTokens || 800, data.outputTokens || 400);

    return data.output;
  },

  // ============================================================
  // DATA FETCHER
  // ============================================================
  async fetchAllData(watchlist, workerUrl) {
    const allTickers = [
      ...watchlist.filter(t => !t.startsWith('^')),
      'SPY', 'QQQ', 'IWM', '^VIX',
      ...Utils.SECTOR_ETFS
    ];

    const uniqueTickers = [...new Set(allTickers)];

    const [quotesRes, macroRes] = await Promise.allSettled([
      fetch(`${workerUrl}/api/market-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: uniqueTickers, fields: ['quote'] })
      }).then(r => r.json()),
      fetch(`${workerUrl}/api/macro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(r => r.json())
    ]);

    const quotes = quotesRes.status === 'fulfilled' ? (quotesRes.value.data || {}) : {};
    const macro  = macroRes.status  === 'fulfilled' ? macroRes.value : {};

    // Cache market data
    Object.entries(quotes).forEach(([ticker, data]) => {
      if (data) Storage.cacheMarketData(ticker, { ...data, ticker });
    });

    // Extract sector data
    const sectors = {};
    Utils.SECTOR_ETFS.forEach(etf => {
      if (quotes[etf]) sectors[etf] = quotes[etf];
    });

    // Extract index data
    const indices = {
      SPY: quotes['SPY'],
      QQQ: quotes['QQQ'],
      IWM: quotes['IWM'],
      VIX: quotes['^VIX']
    };

    return { quotes, macro, sectors, indices };
  },

  // ============================================================
  // PIPELINE COMPLETION
  // ============================================================
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
    Storage.set(Pipeline.STORAGE_KEY, log.slice(0, 50)); // Keep last 50
  },

  getResults() {
    return Storage.get(Pipeline.STORAGE_KEY) || [];
  },

  // Human decision
  recordDecision(scanId, decision, tradeData) {
    const log = Storage.get(Pipeline.STORAGE_KEY) || [];
    const idx = log.findIndex(r => r.scanId === scanId);
    if (idx >= 0) {
      log[idx].humanDecision = decision;
      log[idx].humanDecisionTime = Date.now();
      log[idx].status = decision === 'approved' ? 'approved' : 'declined';
      Storage.set(Pipeline.STORAGE_KEY, log);
    }

    if (decision === 'approved' && tradeData) {
      // Log to trade journal
      const trade = {
        tradeId: Utils.generateTradeId(),
        scanId,
        date: new Date().toISOString().split('T')[0],
        ticker: tradeData.ticker,
        assetType: tradeData.assetType,
        strategyName: tradeData.setupType,
        marketRegime: tradeData.marketRegime,
        entryPrice: null,
        exitPrice: null,
        positionSize: null,
        stopLoss: tradeData.stopLoss,
        target: tradeData.target,
        totalScore: tradeData.totalScore,
        status: 'open',
        result: null,
        timestamp: Date.now()
      };
      Storage.addTrade(trade);
      Utils.toast(`Trade logged: ${trade.ticker} — ${trade.tradeId}`, 'success');

      // Phase 5 — Auto-log to paper options tracker
      const optionsResult = log[idx]?.optionsAnalysis || Pipeline.state.results?.optionsAnalysis;
      const executionResult = log[idx]?.executionPlan || Pipeline.state.results?.executionPlan;
      if (optionsResult && executionResult) {
        Phase5UI.autoLogFromPipeline(
          { tradeAlert: tradeData, scores: { total: tradeData.totalScore } },
          optionsResult,
          executionResult,
          scanId
        );
      }
    }
  }
};
