const marketService = require('./marketService');

// RSI
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

// EMA
function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Math.round(ema * 100) / 100;
}

// MACD
function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const macdValues = closes.map((_, i) => {
    if (i < 26) return 0;
    return calcEMA(closes.slice(0, i + 1), 12) - calcEMA(closes.slice(0, i + 1), 26);
  }).filter(v => v !== 0);
  const signal = calcEMA(macdValues.slice(-9), 9);
  const histogram = macdLine - signal;
  return {
    macd: Math.round(macdLine * 1000) / 1000,
    signal: Math.round(signal * 1000) / 1000,
    histogram: Math.round(histogram * 1000) / 1000,
    bullish: histogram > 0 && macdLine > signal
  };
}

// ATR
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trs.push(tr);
  }
  return Math.round(trs.slice(-period).reduce((a, b) => a + b, 0) / period * 100) / 100;
}

// ADX
function calcADX(candles, period = 14) {
  if (candles.length < period * 2) return 20;
  let plusDM = [], minusDM = [], trs = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  const smoothTR = trs.slice(-period).reduce((a, b) => a + b, 0);
  const smoothPDM = plusDM.slice(-period).reduce((a, b) => a + b, 0);
  const smoothMDM = minusDM.slice(-period).reduce((a, b) => a + b, 0);
  if (smoothTR === 0) return 0;
  const plusDI = (smoothPDM / smoothTR) * 100;
  const minusDI = (smoothMDM / smoothTR) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  return Math.round(dx);
}

// Bollinger Bands
function calcBollinger(closes, period = 20, dev = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: Math.round((middle + dev * stdDev) * 100) / 100,
    middle: Math.round(middle * 100) / 100,
    lower: Math.round((middle - dev * stdDev) * 100) / 100,
    bandwidth: Math.round(stdDev * 2 * dev / middle * 100 * 100) / 100
  };
}

// Supports / Resistances
function findSupportResistance(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const pivot = (resistance + support + recent[recent.length - 1].close) / 3;
  return {
    resistance: Math.round(resistance * 100) / 100,
    support: Math.round(support * 100) / 100,
    pivot: Math.round(pivot * 100) / 100
  };
}

// Score de confluence
function calcConfluenceScore(indicators) {
  let score = 0;

  // EMA (20 pts)
  if (indicators.ema20 > indicators.ema50 && indicators.ema50 > indicators.ema200) score += 20; // Bullish
  else if (indicators.ema20 < indicators.ema50 && indicators.ema50 < indicators.ema200) score += 20; // Bearish

  // RSI (15 pts)
  if (indicators.rsi > 50 && indicators.rsi < 70) score += 15; // Bullish zone
  else if (indicators.rsi < 50 && indicators.rsi > 30) score += 15; // Bearish zone

  // MACD (15 pts)
  if (indicators.macd && (indicators.macd.histogram > 0 || indicators.macd.histogram < 0)) score += 15;

  // ATR (10 pts) - volatilite adequate
  if (indicators.atr > 0) score += 10;

  // Support/Resistance (15 pts)
  if (indicators.sr) score += 15;

  // ADX (10 pts) - tendance forte
  if (indicators.adx > 25) score += 10;

  // Bollinger (10 pts)
  if (indicators.bollinger) score += 10;

  // Macro (5 pts)
  score += 5;

  return Math.min(score, 100);
}

// Qualite du signal
function getQuality(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'NO TRADE';
}

const TF_MAP = {
  'M1': '1min', 'M5': '5min', 'M15': '15min',
  'M30': '30min', 'H1': '1h', 'H4': '4h', 'D1': '1day'
};

async function calculate(asset, timeframe = 'M15') {
  try {
    const interval = TF_MAP[timeframe] || '15min';
    const candles = await marketService.getCandles(asset, interval, 100);

    if (candles.length < 30) {
      return { error: 'Pas assez de donnees', score: 0, quality: 'NO TRADE' };
    }

    const closes = candles.map(c => c.close).reverse();
    const rsi = calcRSI(closes);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes.slice(-Math.min(closes.length, 200)), 200);
    const macd = calcMACD(closes);
    const atr = calcATR(candles.map(c => ({ ...c })).reverse());
    const adx = calcADX(candles.map(c => ({ ...c })).reverse());
    const bollinger = calcBollinger(closes);
    const sr = findSupportResistance(candles.map(c => ({ ...c })).reverse());
    const currentPrice = closes[closes.length - 1];

    const indicators = { rsi, ema20, ema50, ema200, macd, atr, adx, bollinger, sr, currentPrice };
    const score = calcConfluenceScore(indicators);
    const quality = getQuality(score);

    // Biais directionnel
    const bullish = ema20 > ema50 && rsi > 50 && macd.histogram > 0;
    const bearish = ema20 < ema50 && rsi < 50 && macd.histogram < 0;
    const bias = bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'NEUTRAL';

    return {
      rsi,
      ema20,
      ema50,
      ema200,
      macd,
      atr,
      adx,
      bollinger,
      sr,
      currentPrice,
      score,
      quality,
      bias,
      timeframe
    };
  } catch (error) {
    console.error('[Indicators] Erreur:', error.message);
    return { error: error.message, score: 0, quality: 'NO TRADE' };
  }
}

module.exports = { calculate, calcRSI, calcEMA, calcMACD, calcATR, calcADX, calcBollinger };
