// ================================================================
// AURUM BTC PRO — Bot scalping BTC/USD SMC/ICT
// Fichier unique server.js — tout est inclus
// ================================================================
// VARIABLES RAILWAY À CONFIGURER:
// TWELVEDATA_KEY     = ta clé Twelve Data
// TELEGRAM_TOKEN_BTC = token du bot @Aurumbtcpro_bot  
// TELEGRAM_CHAT_ID   = ton Chat ID
// ANTHROPIC_KEY      = ta clé Anthropic
// ================================================================

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const cron      = require('node-cron');
const path      = require('path');
const https     = require('https');
const Anthropic = require('@anthropic-ai/sdk');

const app    = express();
const PORT   = process.env.PORT || 3000;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TD_KEY   = process.env.TWELVEDATA_KEY;
const TG_TOKEN = process.env.TELEGRAM_TOKEN_BTC;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

let currentPrice   = 0;
let isAnalyzing    = false;
let activeSignal   = null;
let lastSignalTime = 0;
const MIN_INTERVAL = 15 * 60 * 1000;
const signals      = [];

// ================================================================
// MARKET SERVICE — Prix et bougies BTC
// ================================================================
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

async function getPrice() {
  if (!TD_KEY) return 0;
  try {
    const d = await httpsGet('api.twelvedata.com', `/price?symbol=BTC%2FUSD&apikey=${TD_KEY}`);
    const p = parseFloat(d.price);
    if (p > 1000) return p;
  } catch(e) {}
  return 0;
}

async function getCandles(timeframe) {
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

// ================================================================
// INDICATOR SERVICE — RSI EMA MACD ATR ADX Bollinger + SMC
// ================================================================
function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains/period, al = losses/period;
  for (let i = period+1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    ag = (ag*(period-1) + Math.max(d,0)) / period;
    al = (al*(period-1) + Math.max(-d,0)) / period;
  }
  if (al === 0) return 100;
  return Math.round(100 - 100/(1 + ag/al));
}

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length-1] || 0;
  const k = 2/(period+1);
  let ema = closes.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i = period; i < closes.length; i++) ema = closes[i]*k + ema*(1-k);
  return +ema.toFixed(2);
}

function calcMACD(closes) {
  const e12=[], e26=[];
  for (let i = 0; i < closes.length; i++) {
    e12.push(calcEMA(closes.slice(0,i+1), 12));
    e26.push(calcEMA(closes.slice(0,i+1), 26));
  }
  const ml  = e12.map((v,i) => v - e26[i]);
  const sig = calcEMA(ml.slice(-9), 9);
  const macd = ml[ml.length-1];
  const histo = macd - sig;
  return { macd: +macd.toFixed(2), signal: +sig.toFixed(2), histogram: +histo.toFixed(2), bullish: histo > 0 };
}

function calcATR(candles, period) {
  period = period || 14;
  if (candles.length < period+1) return 100;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low  - candles[i-1].close)
    ));
  }
  return +(trs.slice(-period).reduce((a,b)=>a+b,0)/period).toFixed(2);
}

function calcADX(candles) {
  if (candles.length < 20) return 20;
  let pDM=0, mDM=0, tr=0;
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i-1].high;
    const dn = candles[i-1].low - candles[i].low;
    pDM += (up > dn && up > 0) ? up : 0;
    mDM += (dn > up && dn > 0) ? dn : 0;
    tr  += Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close));
  }
  if (tr === 0) return 0;
  const p = (pDM/tr)*100, m = (mDM/tr)*100;
  if (p+m === 0) return 0;
  return Math.round(Math.abs(p-m)/(p+m)*100);
}

function calcBollinger(closes) {
  if (closes.length < 20) return null;
  const sl   = closes.slice(-20);
  const mean = sl.reduce((a,b)=>a+b,0)/20;
  const std  = Math.sqrt(sl.reduce((a,b)=>a+Math.pow(b-mean,2),0)/20);
  return { upper: +(mean+2*std).toFixed(2), middle: +mean.toFixed(2), lower: +(mean-2*std).toFixed(2) };
}

function findSR(candles) {
  const r = candles.slice(-20);
  return {
    resistance: +Math.max(...r.map(c=>c.high)).toFixed(2),
    support:    +Math.min(...r.map(c=>c.low)).toFixed(2),
    pivot:      +r[r.length-1].close.toFixed(2)
  };
}

function detectSMC(candles) {
  if (!candles || candles.length < 10) return { bos: null, choch: null, fvgs: [], orderBlocks: [] };
  const n      = candles.length;
  const closes = candles.map(c=>c.close);
  const highs  = candles.map(c=>c.high);
  const lows   = candles.map(c=>c.low);
  const lb     = Math.min(10, n-1);
  const pH     = Math.max(...highs.slice(-lb-1,-1));
  const pL     = Math.min(...lows.slice(-lb-1,-1));
  const lc     = closes[n-1];
  const pTrend = closes[n-5] < closes[n-2] ? 'BULLISH' : 'BEARISH';

  let bos=null, choch=null;
  if (lc > pH) { bos=pTrend==='BULLISH'?{type:'BOS',direction:'BULLISH',level:+pH.toFixed(2)}:null; choch=pTrend==='BEARISH'?{type:'CHOCH',direction:'BULLISH',level:+pH.toFixed(2)}:null; }
  else if (lc < pL) { bos=pTrend==='BEARISH'?{type:'BOS',direction:'BEARISH',level:+pL.toFixed(2)}:null; choch=pTrend==='BULLISH'?{type:'CHOCH',direction:'BEARISH',level:+pL.toFixed(2)}:null; }

  const fvgs = [];
  for (let i=2; i<n; i++) {
    if (candles[i].low > candles[i-2].high) fvgs.push({ direction:'BULLISH', top:+candles[i].low.toFixed(2), bottom:+candles[i-2].high.toFixed(2) });
    else if (candles[i].high < candles[i-2].low) fvgs.push({ direction:'BEARISH', top:+candles[i-2].low.toFixed(2), bottom:+candles[i].high.toFixed(2) });
  }

  const obs = [];
  for (let i=1; i<n-1; i++) {
    const c=candles[i], nx=candles[i+1];
    const bs=Math.abs(c.close-c.open), nm=Math.abs(nx.close-nx.open);
    if (c.close>c.open && nx.close<nx.open && nm>bs*1.5) obs.push({ direction:'BEARISH', top:+c.high.toFixed(2), bottom:+c.low.toFixed(2) });
    if (c.close<c.open && nx.close>nx.open && nm>bs*1.5) obs.push({ direction:'BULLISH', top:+c.high.toFixed(2), bottom:+c.low.toFixed(2) });
  }

  return { bos, choch, fvgs: fvgs.slice(-3), orderBlocks: obs.slice(-3) };
}

async function calculateIndicators() {
  const spotPrice = await getPrice();
  const results   = [];
  for (const tf of ['M5','M15']) {
    const candles = await getCandles(tf);
    if (!candles || candles.length < 15) { results.push(null); await new Promise(r=>setTimeout(r,500)); continue; }
    const recent = candles.slice(-30);
    const closes = recent.map(c=>c.close);
    const sr     = findSR(recent);
    const smc    = detectSMC(recent);
    const ind = {
      rsi: calcRSI(closes), ema20: calcEMA(closes,Math.min(20,closes.length-1)),
      ema50: calcEMA(closes,Math.min(50,closes.length-1)),
      macd: calcMACD(closes), atr: calcATR(recent), adx: calcADX(recent),
      bollinger: calcBollinger(closes), sr, smc, candles: recent
    };
    const bias = ind.ema20>ind.ema50&&ind.rsi>50&&ind.macd.bullish?'BULLISH':ind.ema20<ind.ema50&&ind.rsi<50&&!ind.macd.bullish?'BEARISH':'NEUTRAL';
    results.push({ ...ind, bias, timeframe: tf });
    await new Promise(r=>setTimeout(r,500));
  }

  const tfData  = { M5: results[0], M15: results[1] };
  const m5Bias  = tfData['M5']?.bias  || 'NEUTRAL';
  const m15Bias = tfData['M15']?.bias || 'NEUTRAL';
  const aligned = m5Bias === m15Bias && m5Bias !== 'NEUTRAL';
  const trend   = m15Bias==='BULLISH'&&m5Bias==='BULLISH'?'STRONG BULLISH':m15Bias==='BEARISH'&&m5Bias==='BEARISH'?'STRONG BEARISH':'NEUTRAL';
  const main    = tfData['M5'] || tfData['M15'];

  // Log SMC
  const smc = tfData['M5']?.smc;
  if (smc) {
    if (smc.bos)   console.log(`[SMC-BTC] BOS   ${smc.bos.direction} @ ${smc.bos.level}`);
    if (smc.choch) console.log(`[SMC-BTC] CHOCH ${smc.choch.direction} @ ${smc.choch.level}`);
    if (smc.fvgs.length)        console.log(`[SMC-BTC] FVG x${smc.fvgs.length}`);
    if (smc.orderBlocks.length) console.log(`[SMC-BTC] OB  x${smc.orderBlocks.length}`);
  }

  console.log(`[BTC-indicators] Trend: ${trend} | M15:${m15Bias} M5:${m5Bias} | Alignés: ${aligned}`);
  return { ...main, price: spotPrice || main?.ema20, allTimeframes: tfData, trendSummary: { trend, m15Bias, m5Bias, aligned } };
}

// ================================================================
// AI SERVICE — Analyse SMC BTC avec Claude
// ================================================================
function getSession() {
  const h = new Date().getUTCHours();
  if (h >= 22 || h < 7)  return 'Asia 22h-07h UTC';
  if (h >= 7  && h < 10) return 'London Open 07h-10h UTC';
  if (h >= 10 && h < 12) return 'London Mid 10h-12h UTC';
  if (h >= 12 && h < 14) return 'Overlap London/NY 12h-14h UTC';
  if (h >= 14 && h < 17) return 'New York 14h-17h UTC';
  return 'Pre-market / Close';
}

function formatCandles(candles, limit) {
  if (!candles || !candles.length) return 'N/A';
  return candles.slice(-limit).map(c => {
    const d = new Date(c.time*1000).toISOString().slice(0,16);
    return `${d} O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)}`;
  }).join('\n');
}

async function generateSignal(price, indicators) {
  const session = getSession();
  const now     = new Date().toLocaleString('fr-FR');
  const atr     = indicators.atr || price * 0.005;
  const slDist  = Math.max(Math.round(atr * 2.0 * 100) / 100, 200);
  const tfd     = indicators.allTimeframes || {};

  const candlesM15 = tfd['M15'] ? formatCandles(tfd['M15'].candles||[], 20) : 'N/A';
  const candlesM5  = tfd['M5']  ? formatCandles(tfd['M5'].candles ||[], 30) : 'N/A';

  const tfSummary = ['M5','M15'].map(tf => {
    const d = tfd[tf]; if (!d) return `${tf}: N/A`;
    const smc = d.smc||{};
    return `${tf}: RSI=${d.rsi} EMA20=${d.ema20} EMA50=${d.ema50} ATR=${d.atr} ADX=${d.adx} MACD=${d.macd?.histogram} → ${d.bias} | BOS:${smc.bos?.direction||'NONE'} CHOCH:${smc.choch?.direction||'NONE'} FVG:${smc.fvgs?.length||0} OB:${smc.orderBlocks?.length||0}`;
  }).join('\n');

  const system = `Tu es un trader institutionnel spécialisé dans le scalping BTCUSD.
OBJECTIF: Setups BTC/USD à très forte probabilité. Durée: 1 min à 45 min max.
M15=CERVEAU (tendance, BOS, CHOCH, liquidité, FVG, OB, biais)
M5=GÂCHETTE (entrée précise, validation M15, momentum)
RÈGLE ABSOLUE: M15/M5 non alignés = NO_TRADE.
M15 BUY + M5 BUY = autorisé | M15 SELL + M5 SELL = autorisé | Sinon = NO_TRADE
Priorité: Structure > Liquidité > SMC > Momentum (confirmation seulement)
Notation: A+(liquidité capturée+BOS+FVG/OB+alignés+momentum) A(structure forte+confluence) B(acceptable incomplet) < B=NO_TRADE
SL derrière structure invalidante. TP1=1R TP2=2R TP3=3R. Ratio min 1:2 sinon NO_TRADE.
Si doute → NO_TRADE. Répondre UNIQUEMENT JSON valide sans backtick.`;

  const prompt = `SCALPING BTCUSD — ${now} | SESSION: ${session}
PRIX: ${price} | ATR: ${atr} | ADX: ${indicators.adx} | RSI: ${indicators.rsi}
SL min: ${slDist}$

═══ BOUGIES M15 ═══
${candlesM15}

═══ BOUGIES M5 ═══
${candlesM5}

═══ INDICATEURS + SMC ═══
${tfSummary}

═══ NIVEAUX CLÉS ═══
Support: ${indicators.sr?.support} | Résistance: ${indicators.sr?.resistance}
EMA20: ${indicators.ema20} | EMA50: ${indicators.ema50}

═══ SL/TP CALCULÉS ═══
BUY  → SL=${+(price-slDist).toFixed(2)} TP1=${+(price+slDist).toFixed(2)} TP2=${+(price+slDist*2).toFixed(2)} TP3=${+(price+slDist*3).toFixed(2)}
SELL → SL=${+(price+slDist).toFixed(2)} TP1=${+(price-slDist).toFixed(2)} TP2=${+(price-slDist*2).toFixed(2)} TP3=${+(price-slDist*3).toFixed(2)}

{"direction":"BUY|SELL|NO_TRADE","confidence":0-100,"quality":"A+|A|B","entry":${price},"sl":0,"tp1":0,"tp2":0,"tp3":0,"rr":"1:2+","timeframe_context":"M15","timeframe_entry":"M5","duree_estimee":"1-45min","bias_m15":"","bias_m5":"","bos":"","choch":"","fvg":"","order_block":"","liquidity":"","reason":"","risks":"","invalidation":"","session":"${session}","atr":${atr},"adx":${indicators.adx},"rsi":${indicators.rsi}}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system,
      messages: [{ role: 'user', content: prompt }]
    });
    const raw = response.content[0].text;
    const s=raw.indexOf('{'), e=raw.lastIndexOf('}');
    if (s < 0) return null;
    const signal = JSON.parse(raw.slice(s,e+1));
    if (!signal.direction) return null;
    if (signal.direction === 'NO_TRADE') { console.log('[AI-BTC] NO_TRADE'); return null; }

    // Vérif alignement M15/M5
    const m15 = tfd['M15']?.bias||'NEUTRAL', m5 = tfd['M5']?.bias||'NEUTRAL';
    if (signal.direction==='BUY'  && (m15!=='BULLISH'||m5!=='BULLISH')) { console.log(`[AI-BTC] BUY bloqué M15:${m15} M5:${m5}`); return null; }
    if (signal.direction==='SELL' && (m15!=='BEARISH'||m5!=='BEARISH')) { console.log(`[AI-BTC] SELL bloqué M15:${m15} M5:${m5}`); return null; }

    // Correction SL/TP
    const isBuy = signal.direction==='BUY', entry = parseFloat(signal.entry)||price;
    if (isBuy  && parseFloat(signal.sl)>entry) { signal.sl=+(entry-slDist).toFixed(2);signal.tp1=+(entry+slDist).toFixed(2);signal.tp2=+(entry+slDist*2).toFixed(2);signal.tp3=+(entry+slDist*3).toFixed(2); }
    if (!isBuy && parseFloat(signal.sl)<entry) { signal.sl=+(entry+slDist).toFixed(2);signal.tp1=+(entry-slDist).toFixed(2);signal.tp2=+(entry-slDist*2).toFixed(2);signal.tp3=+(entry-slDist*3).toFixed(2); }

    // Vérif R:R min 1:2
    const rr = Math.abs(entry-parseFloat(signal.tp2)) / Math.abs(entry-parseFloat(signal.sl));
    if (rr < 1.8) { console.log(`[AI-BTC] R:R insuffisant: ${rr.toFixed(1)}`); return null; }

    if (signal.confidence <= 10) signal.confidence *= 10;
    console.log(`[AI-BTC] ${signal.direction} ${signal.confidence}% ${signal.quality} | M15:${m15} M5:${m5} | Durée:${signal.duree_estimee}`);
    return signal;
  } catch(e) { console.error('[AI-BTC]', e.message); return null; }
}

// ================================================================
// TELEGRAM SERVICE
// ================================================================
function httpsPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: 'api.telegram.org', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({ok:false}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function escapeHTML(t) { return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function tgSend(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try { await httpsPost(`/bot${TG_TOKEN}/sendMessage`, { chat_id: TG_CHAT, text: escapeHTML(text), parse_mode: 'HTML' }); } catch(e) {}
}

async function tgSendSignal(signal) {
  if (!TG_TOKEN || !TG_CHAT || !signal) return;
  const isBuy = signal.direction==='BUY';
  const emoji = isBuy?'🟢':'🔴';
  const q     = signal.quality||'B';
  const star  = q==='A+'?'⭐⭐⭐':q==='A'?'⭐⭐':'⭐';
  const conf  = signal.confidence<=10?signal.confidence*10:signal.confidence;

  const msg = `${emoji} <b>AURUM BTC PRO — ${signal.direction}</b> 🤖 AUTO
━━━━━━━━━━━━━━━━
₿ <b>BTC/USD</b> | M5 → M15 | ${escapeHTML(signal.session||'')}
🏆 Setup <b>${q}</b> ${star} | Confiance: <b>${conf}%</b>
📊 Biais M15: <b>${escapeHTML(signal.bias_m15||'')}</b> | M5: <b>${escapeHTML(signal.bias_m5||'')}</b>

📍 <b>ENTRÉE:</b> <code>${signal.entry}</code>
🛑 <b>Stop Loss:</b> <code>${signal.sl}</code>
❌ <b>Invalidation:</b> <code>${escapeHTML(signal.invalidation||'N/A')}</code>
⏱ <b>Durée:</b> ${escapeHTML(signal.duree_estimee||'N/A')}

✅ <b>TP1:</b> <code>${signal.tp1}</code>
✅ <b>TP2:</b> <code>${signal.tp2}</code>
✅ <b>TP3:</b> <code>${signal.tp3}</code>
📊 <b>R:R:</b> ${escapeHTML(signal.rr||'N/A')}

🔄 <b>BOS:</b> ${escapeHTML(signal.bos||'NONE')}
🔄 <b>CHOCH:</b> ${escapeHTML(signal.choch||'NONE')}
📊 <b>FVG:</b> ${escapeHTML(signal.fvg||'NONE')}
🏦 <b>Order Block:</b> ${escapeHTML(signal.order_block||'NONE')}
💧 <b>Liquidité:</b> ${escapeHTML(signal.liquidity||'N/A')}

💬 <b>Analyse SMC:</b>
<i>${escapeHTML(signal.reason||'')}</i>

⚠️ <b>Risques:</b> <i>${escapeHTML(signal.risks||'')}</i>
━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString('fr-FR')}
⚠️ <i>Risque max 1-2% du capital</i>`;

  try {
    const r = await httpsPost(`/bot${TG_TOKEN}/sendMessage`, { chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' });
    if (r.ok) console.log('[Telegram-BTC] Signal envoyé ✓');
    else console.error('[Telegram-BTC]', r.description);
  } catch(e) { console.error('[Telegram-BTC]', e.message); }
}

// ================================================================
// GESTION TRADE ACTIF — Pas de nouveau trade tant que SL/TP pas touché
// ================================================================
function saveSignal(signal, type) {
  signals.push({ ...signal, type, timestamp: new Date().toISOString() });
  if (signals.length > 100) signals.shift();
}

async function checkActiveSignal(price) {
  if (!activeSignal || !price) return true;
  const { direction, entry, sl, tp1 } = activeSignal;
  const isBuy = direction === 'BUY';
  let closed=false, result='';

  if (isBuy) {
    if (price >= tp1) { closed=true; result=`✅ TP1 TOUCHÉ — PROFIT\nEntrée: ${entry} → TP1: ${tp1} (+${(tp1-entry).toFixed(2)}$)`; }
    else if (price <= sl) { closed=true; result=`❌ SL TOUCHÉ — PERTE\nEntrée: ${entry} → SL: ${sl} (-${(entry-sl).toFixed(2)}$)`; }
  } else {
    if (price <= tp1) { closed=true; result=`✅ TP1 TOUCHÉ — PROFIT\nEntrée: ${entry} → TP1: ${tp1} (+${(entry-tp1).toFixed(2)}$)`; }
    else if (price >= sl) { closed=true; result=`❌ SL TOUCHÉ — PERTE\nEntrée: ${entry} → SL: ${sl} (-${(sl-entry).toFixed(2)}$)`; }
  }

  if (closed) {
    console.log(`[BTC] Trade clôturé: ${result.replace(/\n/g,' ')}`);
    await tgSend(`🏁 <b>TRADE BTC CLÔTURÉ</b>\n${result}\n⏰ ${new Date().toLocaleString('fr-FR')}`);
    activeSignal = null;
    return true;
  }
  const el = Math.round((Date.now() - new Date(activeSignal.timestamp).getTime()) / 60000);
  console.log(`[BTC] Trade actif ${activeSignal.direction} depuis ${el}min | Prix:${price} | TP1:${tp1} | SL:${sl}`);
  return false;
}

// ================================================================
// ROUTES
// ================================================================
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.post('/api/price/update', async (req,res) => {
  const { price } = req.body;
  if (price && price > 1000) {
    currentPrice = parseFloat(price);
    if (activeSignal) await checkActiveSignal(currentPrice);
  }
  res.json({ success: true, activeSignal: activeSignal ? {
    direction: activeSignal.direction, entry: activeSignal.entry,
    sl: activeSignal.sl, tp1: activeSignal.tp1
  } : null });
});

app.get('/api/price/:asset', (req,res) => res.json({ success:true, price:currentPrice, timestamp:new Date().toISOString() }));
app.get('/api/config', (req,res) => res.json({ tdKey: TD_KEY||'' }));
app.get('/api/history', (req,res) => res.json({ success:true, signals:signals.slice().reverse(), activeSignal }));

// ================================================================
// CRON — Analyse BTC toutes les 15 min
// ================================================================
cron.schedule('*/15 * * * *', async () => {
  console.log('[BTC AUTO] Analyse scalping BTC/USD...');
  try {
    if (isAnalyzing) { console.log('[BTC AUTO] Déjà en cours'); return; }
    isAnalyzing = true;

    const now   = Date.now();
    const price = currentPrice || await getPrice();
    if (!price) { console.log('[BTC AUTO] Prix introuvable'); isAnalyzing=false; return; }

    // Pas de nouveau trade si trade actif
    const canTrade = await checkActiveSignal(price);
    if (!canTrade) { console.log('[BTC AUTO] Trade actif — attente TP1/SL'); isAnalyzing=false; return; }
    if (now - lastSignalTime < MIN_INTERVAL) { console.log('[BTC AUTO] Trop récent'); isAnalyzing=false; return; }

    const indicators = await calculateIndicators();
    indicators.price = price;
    console.log(`[BTC AUTO] Prix: ${price} | Trend: ${indicators.trendSummary?.trend}`);

    // Vérif alignement M15/M5 avant d'appeler l'IA
    if (!indicators.trendSummary?.aligned) { console.log('[BTC AUTO] M15/M5 non alignés — NO_TRADE'); isAnalyzing=false; return; }

    const signal = await generateSignal(price, indicators);
    if (!signal) { console.log('[BTC AUTO] Pas de signal'); isAnalyzing=false; return; }

    const { quality, confidence } = signal;
    if ((quality==='A'||quality==='A+') && confidence>=75) {
      await tgSendSignal(signal);
      saveSignal(signal, 'AUTO');
      activeSignal   = { ...signal, timestamp: new Date().toISOString() };
      lastSignalTime = now;
      console.log(`[BTC AUTO] ✓ ${signal.direction} ${confidence}% ${quality}`);
    } else {
      console.log(`[BTC AUTO] Rejeté: ${quality} ${confidence}%`);
    }
    isAnalyzing = false;
  } catch(e) { console.error('[BTC AUTO]', e.message); isAnalyzing=false; }
});

// ================================================================
// DÉMARRAGE
// ================================================================
app.listen(PORT, () => {
  console.log(`[AURUM BTC PRO] Port ${PORT}`);
  console.log(`[AURUM BTC PRO] Twelve Data: ${TD_KEY?'OK':'MANQUANT'}`);
  console.log(`[AURUM BTC PRO] Telegram BTC: ${TG_TOKEN?'OK':'MANQUANT'}`);
  console.log(`[AURUM BTC PRO] Anthropic: ${process.env.ANTHROPIC_KEY?'OK':'MANQUANT'}`);
});
