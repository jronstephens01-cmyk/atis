// risk.js — Risk Engine for ATIS

const RiskEngine = {

  LIMITS: {
    DAILY_LOSS_PCT:    -3.0,
    WEEKLY_LOSS_PCT:   -7.0,
    MONTHLY_LOSS_PCT:  -15.0,
    HARD_FLOOR:        250.00,
    MAX_POSITION_PCT:  20.0,
    DEFAULT_POS_PCT:   7.5,
    MAX_SECTOR_PCT:    25.0,
    MAX_CORRELATED:    3,
    MAX_POSITIONS:     5,
  },

  // Check all drawdown limits — returns status and any triggered actions
  checkLimits(portfolio, riskState) {
    const value = portfolio.currentValue;
    const result = {
      action: 'NORMAL',
      alerts: [],
      positionSizeMultiplier: 1.0,
      emergencyStop: false
    };

    // Hard floor check
    if (value <= RiskEngine.LIMITS.HARD_FLOOR) {
      result.action = 'EMERGENCY_STOP';
      result.emergencyStop = true;
      result.alerts.push({
        level: 'CRITICAL',
        message: `Hard floor reached. Account at ${Utils.formatCurrency(value)}. All trading halted.`
      });
      return result;
    }

    // Soft floor warning (within $25 of floor)
    if (value <= RiskEngine.LIMITS.HARD_FLOOR + 25) {
      result.alerts.push({
        level: 'WARN',
        message: `Account approaching hard floor. Only ${Utils.formatCurrency(value - RiskEngine.LIMITS.HARD_FLOOR)} cushion remaining.`
      });
    }

    // Daily limit
    if (riskState.dailyPLPercent <= RiskEngine.LIMITS.DAILY_LOSS_PCT) {
      result.action = 'REDUCE_SIZE';
      result.positionSizeMultiplier = 0.5;
      result.alerts.push({
        level: 'WARN',
        message: `Daily loss limit hit (${Utils.formatPercent(riskState.dailyPLPercent)}). Position sizes halved.`
      });
    }

    // Weekly limit
    if (riskState.weeklyPLPercent <= RiskEngine.LIMITS.WEEKLY_LOSS_PCT) {
      result.action = 'REDUCE_SIZE';
      result.positionSizeMultiplier = 0.5;
      result.alerts.push({
        level: 'WARN',
        message: `Weekly loss limit hit (${Utils.formatPercent(riskState.weeklyPLPercent)}). Risk review required.`
      });
    }

    // Monthly limit
    if (riskState.monthlyPLPercent <= RiskEngine.LIMITS.MONTHLY_LOSS_PCT) {
      result.action = 'REDUCE_SIZE';
      result.positionSizeMultiplier = 0.5;
      result.alerts.push({
        level: 'WARN',
        message: `Monthly loss limit hit (${Utils.formatPercent(riskState.monthlyPLPercent)}). Evaluation required before new positions.`
      });
    }

    return result;
  },

  // Calculate recommended position size in dollars
  calculatePositionSize(portfolio, riskState, compositeScore = 45, macroRegime = 'Neutral') {
    const accountValue = portfolio.currentValue;

    // Reject if below hard floor
    if (accountValue <= RiskEngine.LIMITS.HARD_FLOOR) return 0;

    // Reject if score too low
    if (compositeScore < 35) return 0;

    // Base percent
    let basePercent = RiskEngine.LIMITS.DEFAULT_POS_PCT / 100;

    // Drawdown multiplier
    let sizeMultiplier = riskState.positionSizeMultiplier || 1.0;

    // Macro regime adjustment
    if (macroRegime && macroRegime.toLowerCase().includes('off')) {
      sizeMultiplier *= 0.75;
    }

    // Score adjustment
    if (compositeScore >= 50) {
      sizeMultiplier *= 1.1; // High conviction gets slight bump
    } else if (compositeScore < 42) {
      sizeMultiplier *= 0.8; // Below qualified threshold
    }

    let positionDollar = accountValue * basePercent * sizeMultiplier;

    // Hard cap: 20% of current account value
    const maxDollar = accountValue * (RiskEngine.LIMITS.MAX_POSITION_PCT / 100);
    positionDollar = Math.min(positionDollar, maxDollar);

    // Floor: don't recommend less than $10
    if (positionDollar < 10) return 0;

    return Utils.round(positionDollar, 2);
  },

  // Get position size as a percentage of portfolio
  positionSizePct(positionDollar, portfolioValue) {
    if (!portfolioValue || portfolioValue === 0) return 0;
    return Utils.round((positionDollar / portfolioValue) * 100, 2);
  },

  // Calculate drawdown from peak
  calcDrawdown(currentValue, peakValue) {
    if (!peakValue || peakValue === 0) return { dollar: 0, percent: 0 };
    const dollar = currentValue - peakValue;
    const percent = ((currentValue - peakValue) / peakValue) * 100;
    return {
      dollar: Utils.round(dollar, 2),
      percent: Utils.round(percent, 2)
    };
  },

  // Update peak value if new high reached
  updatePeak(portfolio) {
    if (portfolio.currentValue > portfolio.peakValue) {
      portfolio.peakValue = portfolio.currentValue;
    }
    return portfolio;
  },

  // Validate a proposed trade against all risk rules
  validateTrade(proposed, portfolio, riskState) {
    const errors = [];
    const warnings = [];

    const { ticker, positionDollar, sector } = proposed;
    const accountValue = portfolio.currentValue;

    // Hard floor
    if (accountValue <= RiskEngine.LIMITS.HARD_FLOOR) {
      errors.push('Hard floor breached. No new positions allowed.');
    }

    // Max positions
    if (portfolio.positions.length >= RiskEngine.LIMITS.MAX_POSITIONS) {
      errors.push(`Maximum positions reached (${RiskEngine.LIMITS.MAX_POSITIONS}).`);
    }

    // Position size
    const positionPct = RiskEngine.positionSizePct(positionDollar, accountValue);
    if (positionPct > RiskEngine.LIMITS.MAX_POSITION_PCT) {
      errors.push(`Position size ${Utils.formatPercent(positionPct)} exceeds max ${RiskEngine.LIMITS.MAX_POSITION_PCT}%.`);
    }

    // Cash check
    if (positionDollar > portfolio.cashAvailable) {
      errors.push(`Insufficient cash. Need ${Utils.formatCurrency(positionDollar)}, have ${Utils.formatCurrency(portfolio.cashAvailable)}.`);
    }

    // Sector exposure
    if (sector) {
      const currentSectorPct = portfolio.exposure?.sectors?.[sector] || 0;
      const newSectorPct = currentSectorPct + positionPct;
      if (newSectorPct > RiskEngine.LIMITS.MAX_SECTOR_PCT) {
        errors.push(`Sector exposure for ${sector} would reach ${Utils.formatPercent(newSectorPct)}, exceeding ${RiskEngine.LIMITS.MAX_SECTOR_PCT}% limit.`);
      } else if (newSectorPct > RiskEngine.LIMITS.MAX_SECTOR_PCT * 0.8) {
        warnings.push(`Sector exposure for ${sector} approaching limit (${Utils.formatPercent(newSectorPct)}).`);
      }
    }

    // Daily loss limit
    if (riskState.dailyLimitHit) {
      warnings.push('Daily loss limit hit. Position sizing reduced by 50%.');
    }

    return {
      approved: errors.length === 0,
      errors,
      warnings
    };
  },

  // Recalculate P&L for portfolio from trade log
  recalculatePnL(tradeLog, portfolio) {
    const today = new Date().toDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let dailyPL = 0, weeklyPL = 0, monthlyPL = 0;

    for (const trade of tradeLog) {
      if (trade.status !== 'closed' || !trade.dollarGL) continue;
      const tradeDate = new Date(trade.date);

      if (tradeDate.toDateString() === today) dailyPL += trade.dollarGL;
      if (tradeDate >= weekAgo) weeklyPL += trade.dollarGL;
      if (tradeDate >= monthAgo) monthlyPL += trade.dollarGL;
    }

    const accountValue = portfolio.currentValue;

    return {
      dailyPL: Utils.round(dailyPL, 2),
      weeklyPL: Utils.round(weeklyPL, 2),
      monthlyPL: Utils.round(monthlyPL, 2),
      dailyPLPercent: accountValue ? Utils.round((dailyPL / accountValue) * 100, 2) : 0,
      weeklyPLPercent: accountValue ? Utils.round((weeklyPL / accountValue) * 100, 2) : 0,
      monthlyPLPercent: accountValue ? Utils.round((monthlyPL / accountValue) * 100, 2) : 0,
      dailyLimitHit: accountValue ? (dailyPL / accountValue) * 100 <= RiskEngine.LIMITS.DAILY_LOSS_PCT : false,
      weeklyLimitHit: accountValue ? (weeklyPL / accountValue) * 100 <= RiskEngine.LIMITS.WEEKLY_LOSS_PCT : false,
      monthlyLimitHit: accountValue ? (monthlyPL / accountValue) * 100 <= RiskEngine.LIMITS.MONTHLY_LOSS_PCT : false,
      hardFloorBreached: accountValue <= RiskEngine.LIMITS.HARD_FLOOR,
      positionSizeMultiplier: (
        (accountValue ? (dailyPL / accountValue) * 100 <= RiskEngine.LIMITS.DAILY_LOSS_PCT : false) ||
        (accountValue ? (weeklyPL / accountValue) * 100 <= RiskEngine.LIMITS.WEEKLY_LOSS_PCT : false) ||
        (accountValue ? (monthlyPL / accountValue) * 100 <= RiskEngine.LIMITS.MONTHLY_LOSS_PCT : false)
      ) ? 0.5 : 1.0
    };
  },

  // Get dot class for a given P&L percent and limit
  getPnLDotClass(pctValue, limitPct) {
    if (pctValue <= limitPct) return 'dot--danger';
    if (pctValue <= limitPct * 0.5) return 'dot--warn';
    return 'dot--ok';
  },

  // Get floor dot class
  getFloorDotClass(currentValue) {
    const cushion = currentValue - RiskEngine.LIMITS.HARD_FLOOR;
    if (cushion <= 0) return 'dot--danger';
    if (cushion <= 50) return 'dot--warn';
    return 'dot--ok';
  },

  // Generate the system-level position size guidance text
  positionSizeGuidance(portfolio, riskState, macroRegime) {
    const accountValue = portfolio.currentValue;
    const multiplier = riskState.positionSizeMultiplier || 1.0;

    const low  = Utils.round(accountValue * 0.05 * multiplier, 2);
    const high = Utils.round(accountValue * 0.10 * multiplier, 2);
    const max  = Utils.round(accountValue * 0.20, 2);

    return {
      low,
      high,
      max,
      multiplier,
      reduced: multiplier < 1.0,
      rangeText: `${Utils.formatCurrency(low)} – ${Utils.formatCurrency(high)}`,
      maxText: `${Utils.formatCurrency(max)} absolute max`
    };
  }
};
