// indicators.js — Technical indicator calculations

const Indicators = {

  // Simple Moving Average
  sma(closes, period) {
    if (!closes || closes.length < period) return null;
    const slice = closes.slice(-period);
    return Utils.round(slice.reduce((a, b) => a + b, 0) / period, 4);
  },

  // Exponential Moving Average
  ema(closes, period) {
    if (!closes || closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return Utils.round(ema, 4);
  },

  // RSI (14-period default)
  rsi(closes, period = 14) {
    if (!closes || closes.length < period + 1) return null;

    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return Utils.round(100 - (100 / (1 + rs)), 2);
  },

  // MACD (12, 26, 9)
  macd(closes) {
    if (!closes || closes.length < 26) return null;

    const ema12 = Indicators.ema(closes, 12);
    const ema26 = Indicators.ema(closes, 26);
    if (!ema12 || !ema26) return null;

    const macdLine = Utils.round(ema12 - ema26, 4);

    // Signal line: 9-period EMA of MACD values
    // Simplified: use the last 9 MACD values
    const macdValues = [];
    for (let i = 26; i <= closes.length; i++) {
      const e12 = Indicators.ema(closes.slice(0, i), 12);
      const e26 = Indicators.ema(closes.slice(0, i), 26);
      if (e12 && e26) macdValues.push(e12 - e26);
    }

    const signalLine = macdValues.length >= 9
      ? Utils.round(Indicators.ema(macdValues, 9), 4)
      : macdLine;

    const histogram = Utils.round(macdLine - signalLine, 4);

    return {
      macd: macdLine,
      signal: signalLine,
      histogram,
      bullish: macdLine > signalLine,
      crossover: histogram > 0 && (macdValues[macdValues.length - 2] || 0) <= 0
    };
  },

  // Bollinger Bands (20-period, 2 std dev)
  bollingerBands(closes, period = 20, stdDevMultiplier = 2) {
    if (!closes || closes.length < period) return null;

    const slice = closes.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      upper: Utils.round(mean + stdDevMultiplier * stdDev, 4),
      middle: Utils.round(mean, 4),
      lower: Utils.round(mean - stdDevMultiplier * stdDev, 4),
      bandwidth: Utils.round((stdDevMultiplier * 2 * stdDev) / mean * 100, 2)
    };
  },

  // ATR (14-period) — requires high/low/close arrays
  atr(highs, lows, closes, period = 14) {
    if (!highs || highs.length < period + 1) return null;

    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }

    const slice = trs.slice(-period);
    return Utils.round(slice.reduce((a, b) => a + b, 0) / period, 4);
  },

  // Calculate all indicators from a price history object
  // Expects: { closes: [], highs: [], lows: [], volumes: [] }
  calculate(priceHistory) {
    const { closes, highs, lows, volumes } = priceHistory;
    if (!closes || closes.length < 14) return null;

    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2] || currentPrice;

    const ma20  = Indicators.sma(closes, 20);
    const ma50  = Indicators.sma(closes, 50);
    const ma200 = Indicators.sma(closes, 200);
    const ema12 = Indicators.ema(closes, 12);
    const ema26 = Indicators.ema(closes, 26);
    const rsi14 = Indicators.rsi(closes, 14);
    const macdData = closes.length >= 26 ? Indicators.macd(closes) : null;
    const bb = closes.length >= 20 ? Indicators.bollingerBands(closes) : null;
    const atr14 = (highs && lows && closes.length >= 15)
      ? Indicators.atr(highs, lows, closes, 14)
      : null;

    // Volume analysis
    const avgVolume20 = volumes && volumes.length >= 20
      ? Indicators.sma(volumes, 20)
      : null;
    const currentVolume = volumes ? volumes[volumes.length - 1] : null;
    const volumeRatio = avgVolume20 && currentVolume
      ? Utils.round(currentVolume / avgVolume20, 2)
      : null;

    // Trend analysis
    const aboveMa20  = ma20  ? currentPrice > ma20  : null;
    const aboveMa50  = ma50  ? currentPrice > ma50  : null;
    const aboveMa200 = ma200 ? currentPrice > ma200 : null;

    // Trend score (0-4 based on MA alignment)
    let trendStrength = 0;
    if (aboveMa20)  trendStrength++;
    if (aboveMa50)  trendStrength++;
    if (aboveMa200) trendStrength++;
    if (ma20 && ma50 && ma20 > ma50) trendStrength++; // Short MA above long MA

    // RSI classification
    let rsiSignal = 'neutral';
    if (rsi14 !== null) {
      if (rsi14 >= 70) rsiSignal = 'overbought';
      else if (rsi14 >= 55) rsiSignal = 'bullish';
      else if (rsi14 <= 30) rsiSignal = 'oversold';
      else if (rsi14 <= 45) rsiSignal = 'bearish';
    }

    // Technical score (0-10 contribution to composite score)
    let techScore = 0;
    techScore += trendStrength * 2;           // 0-8 from trend
    if (rsiSignal === 'bullish') techScore += 1;
    if (rsiSignal === 'overbought') techScore -= 1;
    if (macdData?.bullish) techScore += 1;
    if (volumeRatio && volumeRatio > 1.5) techScore += 1;
    techScore = Utils.clamp(Math.round(techScore), 0, 10);

    return {
      currentPrice,
      prevPrice,
      change: Utils.round(currentPrice - prevPrice, 4),
      changePct: Utils.round(((currentPrice - prevPrice) / prevPrice) * 100, 2),

      ma20, ma50, ma200,
      ema12, ema26,
      rsi: rsi14,
      rsiSignal,
      macd: macdData,
      bb,
      atr: atr14,

      volume: currentVolume,
      avgVolume20,
      volumeRatio,
      highVolume: volumeRatio ? volumeRatio > 1.5 : null,

      aboveMa20, aboveMa50, aboveMa200,
      trendStrength, // 0-4
      techScore,     // 0-10

      // Key levels
      support: bb ? bb.lower : (ma200 || null),
      resistance: bb ? bb.upper : null,

      // Stop loss suggestion: 1 ATR below entry or below last support MA
      suggestedStop: atr14
        ? Utils.round(currentPrice - (atr14 * 2), 2)
        : (ma50 ? Utils.round(ma50 * 0.97, 2) : null),
    };
  },

  // Classify a 52-week position
  weekPositionLabel(price, week52Low, week52High) {
    if (!week52Low || !week52High) return '—';
    const range = week52High - week52Low;
    const position = ((price - week52Low) / range) * 100;
    if (position >= 90) return '52W High';
    if (position >= 70) return 'Upper Range';
    if (position <= 10) return '52W Low';
    if (position <= 30) return 'Lower Range';
    return 'Mid Range';
  },

  // Volume signal label
  volumeLabel(ratio) {
    if (!ratio) return '—';
    if (ratio >= 2.0) return 'Very High';
    if (ratio >= 1.5) return 'High';
    if (ratio >= 0.8) return 'Normal';
    return 'Low';
  }
};
