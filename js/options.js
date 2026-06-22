// options.js — Black-Scholes Options Calculator

const Options = {

  // Standard normal CDF approximation
  normCDF(x) {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  },

  // Standard normal PDF
  normPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  },

  // Black-Scholes pricing and Greeks
  // S = current price, K = strike, T = time to expiry (years),
  // r = risk-free rate, sigma = implied volatility (decimal)
  blackScholes(S, K, T, r, sigma, type = 'call') {
    if (!S || !K || !T || !sigma || T <= 0 || sigma <= 0) return null;

    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    let price, delta, gamma, theta, vega, rho;

    gamma = Options.normPDF(d1) / (S * sigma * sqrtT);
    vega  = S * Options.normPDF(d1) * sqrtT / 100; // Per 1% move in IV

    if (type === 'call') {
      price = S * Options.normCDF(d1) - K * Math.exp(-r * T) * Options.normCDF(d2);
      delta = Options.normCDF(d1);
      theta = (-(S * Options.normPDF(d1) * sigma) / (2 * sqrtT)
              - r * K * Math.exp(-r * T) * Options.normCDF(d2)) / 365;
      rho   = K * T * Math.exp(-r * T) * Options.normCDF(d2) / 100;
    } else {
      price = K * Math.exp(-r * T) * Options.normCDF(-d2) - S * Options.normCDF(-d1);
      delta = Options.normCDF(d1) - 1;
      theta = (-(S * Options.normPDF(d1) * sigma) / (2 * sqrtT)
              + r * K * Math.exp(-r * T) * Options.normCDF(-d2)) / 365;
      rho   = -K * T * Math.exp(-r * T) * Options.normCDF(-d2) / 100;
    }

    return {
      price:    Utils.round(price, 4),
      delta:    Utils.round(delta, 4),
      gamma:    Utils.round(gamma, 6),
      theta:    Utils.round(theta, 4),
      vega:     Utils.round(vega, 4),
      rho:      Utils.round(rho, 4),
      d1:       Utils.round(d1, 4),
      d2:       Utils.round(d2, 4),
    };
  },

  // Estimate days to expiry from expiration date string (YYYY-MM-DD)
  daysToExpiry(expiryDate) {
    const now = new Date();
    const expiry = new Date(expiryDate);
    return Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
  },

  // Full options evaluation for a setup
  evaluate(params) {
    const {
      underlying,    // current stock price
      strike,        // strike price
      expiry,        // expiration date string
      type,          // 'call' or 'put'
      premium,       // current ask price (cost per share)
      contracts,     // number of contracts
      openInterest,  // open interest
      bidAskSpread,  // as a decimal (e.g. 0.03 = 3%)
      iv,            // implied volatility as decimal (e.g. 0.30 = 30%)
    } = params;

    const daysToExp = Options.daysToExpiry(expiry);
    const T = daysToExp / 365;
    const r = 0.05; // approximate risk-free rate

    const greeks = Options.blackScholes(underlying, strike, T, r, iv, type);

    if (!greeks) return null;

    const costPerShare = premium;
    const totalCost = Utils.round(costPerShare * 100 * contracts, 2);

    // Breakeven
    const breakeven = type === 'call'
      ? Utils.round(strike + costPerShare, 2)
      : Utils.round(strike - costPerShare, 2);

    // Max loss = premium paid
    const maxLoss = totalCost;

    // For long options, max gain is theoretically unlimited (calls) 
    // or strike - premium (puts if stock goes to 0)
    const maxGainNote = type === 'call'
      ? 'Unlimited (theoretically)'
      : Utils.formatCurrency((strike - costPerShare) * 100 * contracts);

    // Liquidity checks
    const liquidityOk = openInterest >= 500 && bidAskSpread < 0.05;
    const liquidityFlags = [];
    if (openInterest < 500) liquidityFlags.push(`Low OI: ${openInterest} (min: 500)`);
    if (bidAskSpread >= 0.05) liquidityFlags.push(`Wide spread: ${Utils.formatPercent(bidAskSpread * 100)} (max: 5%)`);

    // IV classification (rough estimate without historical IV data)
    let ivLabel = 'Normal';
    if (iv >= 0.60) ivLabel = 'Extreme';
    else if (iv >= 0.40) ivLabel = 'High';
    else if (iv < 0.20) ivLabel = 'Low';

    return {
      greeks,
      daysToExpiry: daysToExp,
      T,
      breakeven,
      maxLoss,
      maxGainNote,
      totalCost,
      liquidityOk,
      liquidityFlags,
      ivLabel,

      // Risk/reward rough estimate (if target is defined)
      rrRatio: null, // Set by agent with target price

      // Moneyness
      itm: type === 'call' ? underlying > strike : underlying < strike,
      otm: type === 'call' ? underlying < strike : underlying > strike,
      moneynessLabel: (() => {
        const diff = Math.abs(underlying - strike) / underlying;
        if (diff < 0.01) return 'ATM';
        if (type === 'call') return underlying > strike ? 'ITM' : 'OTM';
        return underlying < strike ? 'ITM' : 'OTM';
      })(),

      // Summary string for display
      summary: `${contracts} ${type.toUpperCase()} contract${contracts > 1 ? 's' : ''} @ $${strike} | ${daysToExp}d | ${ivLabel} IV | ${liquidityOk ? '✓ Liquid' : '⚠ Liquidity Issue'}`
    };
  },

  // Check if an options setup meets minimum requirements
  meetsRequirements(openInterest, bidAskSpread) {
    return {
      oi: openInterest >= 500,
      spread: bidAskSpread < 0.05,
      approved: openInterest >= 500 && bidAskSpread < 0.05
    };
  },

  // Format Greek value for display
  formatGreek(name, value) {
    if (value == null) return '—';
    switch (name) {
      case 'delta': return value.toFixed(3);
      case 'gamma': return value.toFixed(5);
      case 'theta': return `${value.toFixed(4)}/day`;
      case 'vega':  return `${value.toFixed(4)}/1% IV`;
      case 'rho':   return value.toFixed(4);
      default:      return value.toFixed(4);
    }
  }
};
