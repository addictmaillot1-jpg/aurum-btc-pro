require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const cron     = require('node-cron');
const path     = require('path');
const https    = require('https');

const indicatorService = require('./src/services/indicatorService');
const newsService      = require('./src/services/newsService');
const aiService        = require('./src/services/aiService');
const telegramService  = require('./src/services/telegramService');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TD_KEY = process.env.TWELVEDATA_KEY;
let currentPrice = 0;
let isAnalyzing  = false;

// =========================
// GESTION TRADE ACTIF
// Pas de nouveau trade tant que SL/TP pas touché
// =========================
const signals      = [];
let activeSignal   = null;
let lastSignalTime = 0;
const MIN_INTERVAL = 15 * 60 * 1000;

function saveSignal(signal, type) {
  signals.push({ ...signal, type, timestamp: new Date().toISOString() });
  if (signals.length > 100) signals.shift();
}

async function checkActiveSignal(price) {
  if (!activeSignal || !price) return true;

  const { direction, entry, sl, tp1 } = activeSignal;
  const isBuy = direction === 'BUY';
  let closed  = false;
  let result  = '';

  if (isBuy) {
    if (price >= tp1) {
      closed = true;
      result = `✅ TP1 TOUCHÉ — PROFIT\nEntrée: ${entry} → TP1: ${tp1} (+${(tp1-entry).toFixed(2)}$)`;
    } else if (price <= sl) {
      closed = true;
      result = `❌ SL TOUCHÉ — PERTE\nEntrée: ${entry} → SL: ${sl} (-${(entry-sl).toFixed(2)}$)`;
    }
  } else {
    if (price <= tp1) {
      closed = true;
      result = `✅ TP1 TOUCHÉ — PROFIT\nEntrée: ${entry} → TP1: ${tp1} (+${(entry-tp1).toFixed(2)}$)`;
    } else if (price >= sl) {
      closed = true;
      result = `❌ SL TOUCHÉ — PERTE\nEntrée: ${entry} → SL: ${sl} (-${(sl-entry).toFixed(2)}$)`;
    }
  }

  if (closed) {
    console.log(`[BTC] Trade clôturé: ${result.replace(/\n/g,' ')}`);
    await telegramService.sendMessage(`🏁 <b>TRADE BTC CLÔTURÉ</b>\n${result}\n⏰ ${new Date().toLocaleString('fr-FR')}`);
    activeSignal = null;
    return true;
  }

  const elapsed = Math.round((Date.now() - new Date(activeSignal.timestamp).getTime()) / 60000);
  console.log(`[BTC] Trade actif ${activeSignal.direction} depuis ${elapsed}min | Prix: ${price} | TP1: ${tp1} | SL: ${sl}`);
  return false;
}

function fetchTDPrice() {
  return new Promise((resolve) => {
    if (!TD_KEY) { resolve(0); return; }
    const req = https.get({
      hostname: 'api.twelvedata.com',
      path: `/price?symbol=BTC%2FUSD&apikey=${TD_KEY}`,
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { const p=parseFloat(JSON.parse(raw).price); if(p>1000){resolve(p);return;} } catch(e){}
        resolve(0);
      });
    });
    req.on('error', ()=>resolve(0));
    req.on('timeout', ()=>{req.destroy();resolve(0);});
  });
}

// =========================
// ROUTES
// =========================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/price/update', async (req, res) => {
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

app.get('/api/price/:asset', (req, res) => {
  res.json({ success: true, price: currentPrice, timestamp: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({ tdKey: TD_KEY || '' });
});

app.get('/api/history', (req, res) => {
  res.json({ success: true, signals: signals.slice().reverse(), activeSignal });
});

// =========================
// CRON — Analyse BTC toutes les 15 min
// Pas de nouveau signal si trade actif
// =========================
cron.schedule('*/15 * * * *', async () => {
  console.log('[BTC AUTO] Analyse scalping BTC/USD...');
  try {
    if (isAnalyzing) { console.log('[BTC AUTO] Analyse déjà en cours'); return; }
    isAnalyzing = true;

    const now   = Date.now();
    const price = currentPrice || await fetchTDPrice();
    if (!price) { console.log('[BTC AUTO] Prix introuvable'); isAnalyzing=false; return; }

    // Pas de nouveau trade tant que le trade actif n'est pas clôturé
    const canTrade = await checkActiveSignal(price);
    if (!canTrade) {
      console.log('[BTC AUTO] Trade actif — attente TP1 ou SL');
      isAnalyzing = false;
      return;
    }

    if (now - lastSignalTime < MIN_INTERVAL) {
      console.log('[BTC AUTO] Trop récent');
      isAnalyzing = false;
      return;
    }

    const indicators = await indicatorService.calculate('BTC/USD', 'M5');
    indicators.price = price;
    console.log(`[BTC AUTO] Prix: ${price}`);

    // Vérifie alignement M15/M5
    const m15Bias = indicators.allTimeframes?.['M15']?.bias || 'NEUTRAL';
    const m5Bias  = indicators.allTimeframes?.['M5']?.bias  || 'NEUTRAL';
    if (m15Bias === 'NEUTRAL' || m5Bias === 'NEUTRAL' || m15Bias !== m5Bias) {
      console.log(`[BTC AUTO] M15/M5 non alignés (${m15Bias}/${m5Bias}) — NO_TRADE`);
      isAnalyzing = false;
      return;
    }

    // Vérif news avant analyse
    const newsRisk = await newsService.checkNewsRisk();
    if (newsRisk.blocked) {
      console.log(`[BTC AUTO] Bloqué par news: ${newsRisk.news_event}`);
      isAnalyzing = false;
      return;
    }

    const signal = await aiService.generateSignal('BTC/USD', price, indicators, 'M5', newsRisk);
    if (!signal) { console.log('[BTC AUTO] Pas de signal'); isAnalyzing=false; return; }

    const { quality, confidence } = signal;
    if ((quality === 'A' || quality === 'A+') && confidence >= 80) {
      await telegramService.sendSignal(signal, 'AUTO', 'BTC/USD');
      saveSignal(signal, 'AUTO');
      activeSignal   = { ...signal, timestamp: new Date().toISOString() };
      lastSignalTime = now;
      console.log(`[BTC AUTO] ✓ ${signal.direction} ${confidence}% ${quality} | Durée: ${signal.duree_estimee}`);
    } else {
      console.log(`[BTC AUTO] Rejeté: ${quality} ${confidence}%`);
    }

    isAnalyzing = false;
  } catch (err) {
    console.error('[BTC AUTO] Erreur:', err.message);
    isAnalyzing = false;
  }
});

// =========================
// DEMARRAGE
// =========================
app.listen(PORT, () => {
  console.log(`[AURUM BTC PRO] Port ${PORT}`);
  console.log(`[AURUM BTC PRO] Twelve Data: ${TD_KEY ? 'OK' : 'MANQUANT'}`);
  console.log(`[AURUM BTC PRO] Telegram BTC: ${process.env.TELEGRAM_TOKEN_BTC ? 'OK' : 'MANQUANT'}`);
  console.log(`[AURUM BTC PRO] Anthropic: ${process.env.ANTHROPIC_KEY ? 'OK' : 'MANQUANT'}`);
  console.log(`[AURUM BTC PRO] Finnhub: ${process.env.FINNHUB_KEY ? 'OK' : 'NON CONFIGURÉ (filtre news désactivé)'}`);
});
