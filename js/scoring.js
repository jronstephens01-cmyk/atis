// scoring.js — 60-point Investment Committee Scoring Model

const Scoring = {

  THRESHOLDS: {
    REJECT:          35,
    MONITOR:         42,
    QUALIFIED:       50,
  },

  // Calculate composite score from individual components
  // Each component: 0-10
  composite({ technical, fundamental, risk, catalyst, market, macro }) {
    const scores = {
      technical:   Utils.clamp(Math.round(technical   || 0), 0, 10),
      fundamental: Utils.clamp(Math.round(fundamental || 0), 0, 10),
      risk:        Utils.clamp(Math.round(risk        || 0), 0, 10),
      catalyst:    Utils.clamp(Math.round(catalyst    || 0), 0, 10),
      market:      Utils.clamp(Math.round(market      || 0), 0, 10),
      macro:       Utils.clamp(Math.round(macro       || 0), 0, 10),
    };

    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    return {
      ...scores,
      total,
      ...Scoring.classify(total)
    };
  },

  // Classify a total score
  classify(total) {
    if (total >= Scoring.THRESHOLDS.QUALIFIED) {
      return {
        status: 'HIGH CONVICTION',
        action: 'proceed',
        cls: 'positive',
        description: 'High conviction setup. Proceed to human approval.'
      };
    }
    if (total >= Scoring.THRESHOLDS.MONITOR) {
      return {
        status: 'QUALIFIED',
        action: 'proceed',
        cls: '',
        description: 'Qualified setup. Proceed with standard position sizing.'
      };
    }
    if (total >= Scoring.THRESHOLDS.REJECT) {
      return {
        status: 'MONITOR ONLY',
        action: 'monitor',
        cls: '',
        description: 'Below threshold for active recommendation. Monitor only.'
      };
    }
    return {
      status: 'REJECT',
      action: 'reject',
      cls: 'negative',
      description: 'Does not meet minimum standards. Do not proceed.'
    };
  },

  // Generate a technical score from indicator data
  technicalScore(indicators) {
    if (!indicators) return 0;

    let score = 5; // Start neutral

    // Trend alignment (up to +3 or -3)
    if (indicators.trendStrength >= 4) score += 3;
    else if (indicators.trendStrength === 3) score += 2;
    else if (indicators.trendStrength === 2) score += 1;
    else if (indicators.trendStrength === 1) score -= 1;
    else score -= 2;

    // RSI
    if (indicators.rsiSignal === 'bullish') score += 1;
    if (indicators.rsiSignal === 'overbought') score -= 1;
    if (indicators.rsiSignal === 'oversold') score += 1; // Potential reversal

    // MACD
    if (indicators.macd?.bullish) score += 1;
    if (indicators.macd?.crossover) score += 1;

    // Volume confirmation
    if (indicators.highVolume) score += 1;

    return Utils.clamp(Math.round(score), 0, 10);
  },

  // Generate a macro/market score from macro state
  macroScore(macroState) {
    if (!macroState || !macroState.scores) return 5;
    const total = macroState.totalScore || 0;
    // Convert 0-50 macro score to 0-10
    return Utils.clamp(Math.round(total / 5), 0, 10);
  },

  // Market score from regime
  marketScore(regime) {
    if (!regime) return 5;
    const r = regime.toLowerCase();
    if (r.includes('on')) return 8;
    if (r.includes('off')) return 3;
    return 5;
  },

  // Risk score: higher is better (setup has favorable R:R)
  riskScore(entry, stop, target) {
    if (!entry || !stop || !target) return 5;
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (risk === 0) return 5;
    const rrRatio = reward / risk;

    if (rrRatio >= 3.0) return 10;
    if (rrRatio >= 2.5) return 9;
    if (rrRatio >= 2.0) return 8;
    if (rrRatio >= 1.5) return 6;
    if (rrRatio >= 1.0) return 4;
    return 2; // Poor R:R
  },

  // Format score for display
  formatScore(score) {
    return `${score.total}/60`;
  },

  // Score bar width percent
  scorePct(score, max = 60) {
    return Utils.clamp((score / max) * 100, 0, 100);
  },

  // Score color
  scoreColor(total) {
    if (total >= Scoring.THRESHOLDS.QUALIFIED) return 'var(--green)';
    if (total >= Scoring.THRESHOLDS.MONITOR) return 'var(--cyan)';
    if (total >= Scoring.THRESHOLDS.REJECT) return 'var(--amber)';
    return 'var(--red)';
  }
};
