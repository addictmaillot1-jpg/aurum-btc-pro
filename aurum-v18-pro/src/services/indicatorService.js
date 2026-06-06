const https = require('https');

const TD_KEY = process.env.TWELVEDATA_KEY;

// =========================
// FETCH BOUGIES BTC
// =========================
function httpsGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname, path,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 8000
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchCandles(timeframe) {
  if (!TD_KEY) return null;
  try {
    const intervals = { M5: '5min', M15: '15min' };
    const interval  = intervals[timeframe] || '5min';
    const data = await httpsGet('api.twelvedata.com',
      `/time_series?symbol=BTC%2FUSD&interval=${interval}&outputsize=30&apikey=${TD_KEY}`);
    if (!data.values || !Array.isArray(data.values)) return null;
    return data.values.reverse().map(c => ({
      time:  new Date(c.datetime).getTime() / 1000,
      open:  parseFloat(c.open),
      high:  parseFloat(c.high),
      low:   parseFloat(c.low),
      close: parseFloat(c.close)
    })).filter(c => c.close > 0);
  } catch(e) {
    console.log(`[TD-BTC] ${timeframe}: ${e.message}`);
    return null;
  }
}

async function fetchPrice() {
  if (!TD_KEY) return 0;
  try {
    const d = await httpsGet('api.twelvedata.com', `/price?symbol=BTC%2FUSD&apikey=${TD_KEY}`);
    const p = parseFloat(d.price);
    if (p > 1000) return p;
  } catch(e) {}
  return 0;
}

// =========================
// INDICATEURS
// =========================
function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(diff, 0)) / period;
    al = (al * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (al === 0) return 100;
  return Math.round(100 - 100 / (1 + ag / al));
}

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return +ema.toFixed(2);
}

function calcMACD(closes) {
  const e12 = [], e26 = [];
  for (let i = 0; i < closes.length; i++) {
    e12.push(calcEMA(closes.slice(0, i + 1), 12));
    e26.push(calcEMA(closes.slice(0, i + 1), 26));
  }
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signal   = calcEMA(macdLine.slice(-9), 9);
  const macd     = macdLine[macdLine.length - 1];
  const histo    = macd - signal;
  return { macd: +macd.toFixed(2), signal: +signal.toFixed(2), histogram: +histo.toFixed(2), bullish: histo > 0 };
}

function calcATR(candles, period) {
  period = period || 14;
  if (candles.length < period + 1) return 100;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    ));
  }
  return +(trs.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(2);
}

function calcADX(candles) {
  if (candles.length < 20) return 20;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i < candles.length; i++) {
    const up   = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM  += (up > down && up > 0) ? up : 0;
    minusDM += (down > up && down > 0) ? down : 0;
    tr += Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
  }
  if (tr === 0) return 0;
  const pDI = (plusDM / tr) * 100, mDI = (minusDM / tr) * 100;
  if (pDI + mDI === 0) return 0;
  return Math.round(Math.abs(pDI - mDI) / (pDI + mDI) * 100);
}

function calcBollinger(closes, period, dev) {
  period = period || 20; dev = dev || 2;
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  return { upper: +(mean + dev * std).toFixed(2), middle: +mean.toFixed(2), lower: +(mean - dev * std).toFixed(2) };
}

function findSR(candles, lookback) {
  lookback = lookback || 20;
  const recent = candles.slice(-lookback);
  return {
    resistance: +Math.max(...recent.map(c => c.high)).toFixed(2),
    support:    +Math.min(...recent.map(c => c.low)).toFixed(2),
    pivot:      +recent[recent.length - 1].close.toFixed(2)
  };
}

// =========================
// DÉTECTION SMC — BOS / CHOCH / FVG / OB
// =========================
function detectSMC(candles) {
  if (!candles || candles.length < 10) return { bos: null, choch: null, fvgs: [], orderBlocks: [] };
  const n      = candles.length;
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const lb     = Math.min(10, n - 1);
  const pH     = Math.max(...highs.slice(-lb - 1, -1));
  const pL     = Math.min(...lows.slice(-lb - 1, -1));
  const lc     = closes[n - 1];
  const pTrend = closes[n - 5] < closes[n - 2] ? 'BULLISH' : 'BEARISH';

  let bos = null, choch = null;
  if (lc > pH) {
    bos   = pTrend === 'BULLISH' ? { type: 'BOS',   direction: 'BULLISH', level: +pH.toFixed(2) } : null;
    choch = pTrend === 'BEARISH' ? { type: 'CHOCH', direction: 'BULLISH', level: +pH.toFixed(2) } : null;
  } else if (lc < pL) {
    bos   = pTrend === 'BEARISH' ? { type: 'BOS',   direction: 'BEARISH', level: +pL.toFixed(2) } : null;
    choch = pTrend === 'BULLISH' ? { type: 'CHOCH', direction: 'BEARISH', level: +pL.toFixed(2) } : null;
  }

  const fvgs = [];
  for (let i = 2; i < n; i++) {
    if (candles[i].low > candles[i-2].high)
      fvgs.push({ direction: 'BULLISH', top: +candles[i].low.toFixed(2), bottom: +candles[i-2].high.toFixed(2) });
    else if (candles[i].high < candles[i-2].low)
      fvgs.push({ direction: 'BEARISH', top: +candles[i-2].low.toFixed(2), bottom: +candles[i].high.toFixed(2) });
  }

  const obs = [];
  for (let i = 1; i < n - 1; i++) {
    const c = candles[i], nx = candles[i + 1];
    const bs = Math.abs(c.close - c.open), nm = Math.abs(nx.close - nx.open);
    if (c.close > c.open && nx.close < nx.open && nm > bs * 1.5)
      obs.push({ direction: 'BEARISH', top: +c.high.toFixed(2), bottom: +c.low.toFixed(2) });
    if (c.close < c.open && nx.close > nx.open && nm > bs * 1.5)
      obs.push({ direction: 'BULLISH', top: +c.high.toFixed(2), bottom: +c.low.toFixed(2) });
  }

  return { bos, choch, fvgs: fvgs.slice(-3), orderBlocks: obs.slice(-3) };
}

// =========================
// DÉTECTION LIQUIDITÉ AVANCÉE
// Equal Highs / Equal Lows / Double Top / Double Bottom / Sessions
// =========================
function detectLiquidity(candles) {
  if (!candles || candles.length < 5) return {};

  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const n      = candles.length;
  const margin = calcATR(candles) * 0.3; // Tolérance = 30% de l'ATR

  // ── Equal Highs (EQH) ──
  // 2 bougies ou plus avec le même high → zone de liquidité buy-side
  const eqHighs = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(highs[i] - highs[j]) <= margin) {
        eqHighs.push(+((highs[i] + highs[j]) / 2).toFixed(2));
        break;
      }
    }
  }
  const equalHighs = [...new Set(eqHighs)].slice(-2); // 2 derniers EQH

  // ── Equal Lows (EQL) ──
  // 2 bougies ou plus avec le même low → zone de liquidité sell-side
  const eqLows = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(lows[i] - lows[j]) <= margin) {
        eqLows.push(+((lows[i] + lows[j]) / 2).toFixed(2));
        break;
      }
    }
  }
  const equalLows = [...new Set(eqLows)].slice(-2); // 2 derniers EQL

  // ── Double Top ──
  // 2 highs proches avec un creux entre eux → retournement baissier
  let doubleTop = null;
  for (let i = 2; i < n - 1; i++) {
    const prevHigh = Math.max(...highs.slice(0, i));
    const currHigh = highs[i];
    if (Math.abs(currHigh - prevHigh) <= margin * 2) {
      const valleyLow = Math.min(...lows.slice(Math.max(0, i - 5), i));
      doubleTop = {
        level:  +((currHigh + prevHigh) / 2).toFixed(2),
        valley: +valleyLow.toFixed(2),
        signal: 'BEARISH'
      };
    }
  }

  // ── Double Bottom ──
  // 2 lows proches avec un pic entre eux → retournement haussier
  let doubleBottom = null;
  for (let i = 2; i < n - 1; i++) {
    const prevLow = Math.min(...lows.slice(0, i));
    const currLow = lows[i];
    if (Math.abs(currLow - prevLow) <= margin * 2) {
      const peakHigh = Math.max(...highs.slice(Math.max(0, i - 5), i));
      doubleBottom = {
        level: +((currLow + prevLow) / 2).toFixed(2),
        peak:  +peakHigh.toFixed(2),
        signal: 'BULLISH'
      };
    }
  }

  // ── Liquidité par session (heure UTC) ──
  const now = new Date();
  const h   = now.getUTCHours();

  // Session asiatique : 22h-07h UTC → range typique
  // Session Londres  : 07h-12h UTC
  // Session New York : 13h-17h UTC

  // On identifie les niveaux hauts/bas des dernières bougies par session
  const sessionCandles = {
    asia:    candles.filter(c => { const ch = new Date(c.time * 1000).getUTCHours(); return ch >= 22 || ch < 7; }),
    london:  candles.filter(c => { const ch = new Date(c.time * 1000).getUTCHours(); return ch >= 7 && ch < 12; }),
    newyork: candles.filter(c => { const ch = new Date(c.time * 1000).getUTCHours(); return ch >= 13 && ch < 17; })
  };

  const sessionLiquidity = {};
  ['asia', 'london', 'newyork'].forEach(sess => {
    const sc = sessionCandles[sess];
    if (sc.length > 0) {
      sessionLiquidity[sess] = {
        high: +Math.max(...sc.map(c => c.high)).toFixed(2),
        low:  +Math.min(...sc.map(c => c.low)).toFixed(2),
        count: sc.length
      };
    }
  });

  // Session actuelle
  let currentSession = 'pre-market';
  if (h >= 22 || h < 7)  currentSession = 'asia';
  else if (h >= 7 && h < 12)  currentSession = 'london';
  else if (h >= 13 && h < 17) currentSession = 'newyork';

  return {
    equalHighs,   // Buy-side liquidity (BSL)
    equalLows,    // Sell-side liquidity (SSL)
    doubleTop,
    doubleBottom,
    sessionLiquidity,
    currentSession
  };
}

// =========================
// SCORE CONFLUENCE
// =========================
function calcScore(ind, direction) {
  let score = 0;
  const isBull = direction === 'BULLISH' || direction === 'BUY';
  const isBear = direction === 'BEARISH' || direction === 'SELL';
  if (isBull && ind.ema20 > ind.ema50) score += 20;
  if (isBear && ind.ema20 < ind.ema50) score += 20;
  if (isBull && ind.rsi > 50 && ind.rsi < 75) score += 15;
  if (isBear && ind.rsi < 50 && ind.rsi > 25) score += 15;
  if (isBull && ind.macd?.bullish)  score += 15;
  if (isBear && !ind.macd?.bullish) score += 15;
  if (ind.atr > 0) score += 10;
  if (ind.adx > 25) score += 15;
  if (ind.bollinger) score += 15;
  return Math.min(100, score);
}

// =========================
// ANALYSE UN TIMEFRAME
// =========================
async function analyzeTimeframe(timeframe) {
  const candles = await fetchCandles(timeframe);
  if (!candles || candles.length < 15) return null;
  const recent = candles.slice(-30);
  const closes = recent.map(c => c.close);
  const sr     = findSR(recent);
  const smc    = detectSMC(recent);
  const liq    = detectLiquidity(recent);
  const ind = {
    rsi:       calcRSI(closes),
    ema20:     calcEMA(closes, Math.min(20, closes.length - 1)),
    ema50:     calcEMA(closes, Math.min(50, closes.length - 1)),
    macd:      calcMACD(closes),
    atr:       calcATR(recent),
    adx:       calcADX(recent),
    bollinger: calcBollinger(closes),
    sr, smc, liquidity: liq, candles: recent
  };
  const bias = ind.ema20 > ind.ema50 && ind.rsi > 50 && ind.macd.bullish ? 'BULLISH' :
               ind.ema20 < ind.ema50 && ind.rsi < 50 && !ind.macd.bullish ? 'BEARISH' : 'NEUTRAL';
  const score = calcScore(ind, bias);

  // Logs SMC
  if (smc.bos)   console.log(`[SMC-BTC] ${timeframe} BOS   ${smc.bos.direction} @ ${smc.bos.level}`);
  if (smc.choch) console.log(`[SMC-BTC] ${timeframe} CHOCH ${smc.choch.direction} @ ${smc.choch.level}`);
  if (liq.equalHighs?.length) console.log(`[LIQ-BTC] ${timeframe} EQH: ${liq.equalHighs.join(', ')}`);
  if (liq.equalLows?.length)  console.log(`[LIQ-BTC] ${timeframe} EQL: ${liq.equalLows.join(', ')}`);
  if (liq.doubleTop)    console.log(`[LIQ-BTC] ${timeframe} Double Top @ ${liq.doubleTop.level}`);
  if (liq.doubleBottom) console.log(`[LIQ-BTC] ${timeframe} Double Bottom @ ${liq.doubleBottom.level}`);

  return { ...ind, score, bias, timeframe };
}

// =========================
// MAIN — M5 + M15
// =========================
async function calculate(asset, timeframe) {
  timeframe = timeframe || 'M5';
  try {
    const spotPrice = await fetchPrice();
    const results   = [];
    for (const tf of ['M5', 'M15']) {
      results.push(await analyzeTimeframe(tf));
      await new Promise(r => setTimeout(r, 500));
    }

    const tfData  = { M5: results[0], M15: results[1] };
    const m5Bias  = tfData['M5']?.bias  || 'NEUTRAL';
    const m15Bias = tfData['M15']?.bias || 'NEUTRAL';
    const aligned = m5Bias === m15Bias && m5Bias !== 'NEUTRAL';
    const trend   = m15Bias === 'BULLISH' && m5Bias === 'BULLISH' ? 'STRONG BULLISH' :
                    m15Bias === 'BEARISH' && m5Bias === 'BEARISH' ? 'STRONG BEARISH' : 'NEUTRAL';

    console.log(`[BTC-indicators] Trend: ${trend} | M15:${m15Bias} M5:${m5Bias} | Alignés: ${aligned}`);

    const main = tfData[timeframe] || tfData['M5'] || Object.values(tfData).find(v => v);
    if (!main) return { error: 'Données indisponibles', score: 0, quality: 'NO TRADE' };

    const dirScore = calcScore(main, trend.includes('BULLISH') ? 'BULLISH' : 'BEARISH');

    return {
      ...main,
      score: dirScore,
      price: spotPrice || main.ema20,
      allTimeframes: tfData,
      trendSummary: { trend, m15Bias, m5Bias, aligned, confluence: aligned ? 100 : 0 },
      quality: dirScore >= 80 ? 'A+' : dirScore >= 70 ? 'A' : dirScore >= 60 ? 'B' : 'NO TRADE'
    };
  } catch(e) {
    console.error('[BTC-indicators] Error:', e.message);
    return { error: e.message, score: 0, quality: 'NO TRADE' };
  }
}

module.exports = { calculate, fetchPrice };
