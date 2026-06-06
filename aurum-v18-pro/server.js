require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const marketService = require('./src/services/marketService');
const indicatorService = require('./src/services/indicatorService');
const aiService = require('./src/services/aiService');
const telegramService = require('./src/services/telegramService');
const signalRoutes = require('./src/routes/signals');
const statsRoutes = require('./src/routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes API
app.use('/api/signals', signalRoutes);
app.use('/api/stats', statsRoutes);

// Route principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route signal immediat
app.post('/api/analyze', async (req, res) => {
  try {
    const { asset = 'XAU/USD', timeframe = 'M15' } = req.body;
    console.log(`[AURUM] Analyse immediate: ${asset} ${timeframe}`);

    const price = await marketService.getPrice(asset);
    const indicators = await indicatorService.calculate(asset, timeframe);
    const signal = await aiService.generateSignal(asset, price, indicators, timeframe);

    if (signal) {
      await telegramService.sendSignal(signal, 'MANUAL', asset);
      await saveSignal(signal, asset, 'MANUAL');
    }

    res.json({ success: true, signal });
  } catch (error) {
    console.error('[AURUM] Erreur analyse:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route prix temps reel
app.get('/api/price/:asset', async (req, res) => {
  try {
    const asset = decodeURIComponent(req.params.asset);
    const price = await marketService.getPrice(asset);
    res.json({ success: true, price, asset, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// AUTO-ANALYSE - toutes les 5 minutes
let lastSignalTime = 0;
const MIN_SIGNAL_INTERVAL = 10 * 60 * 1000; // 10 min minimum entre signaux

cron.schedule('*/5 * * * *', async () => {
  console.log('[AURUM AUTO] Analyse automatique XAU/USD...');
  try {
    const now = Date.now();
    const price = await marketService.getPrice('XAU/USD');
    const indicators = await indicatorService.calculate('XAU/USD', 'M15');
    const signal = await aiService.generateSignal('XAU/USD', price, indicators, 'M15');

    if (!signal) {
      console.log('[AURUM AUTO] Pas de signal valide');
      return;
    }

    const quality = signal.quality;
    const confidence = signal.confidence;

    // Envoyer seulement si qualite A ou A+ et confiance >= 80
    if ((quality === 'A' || quality === 'A+') && confidence >= 80) {
      if (now - lastSignalTime >= MIN_SIGNAL_INTERVAL) {
        await telegramService.sendSignal(signal, 'AUTO', 'XAU/USD');
        await saveSignal(signal, 'XAU/USD', 'AUTO');
        lastSignalTime = now;
        console.log(`[AURUM AUTO] Signal envoye: ${signal.direction} ${confidence}% ${quality}`);
      } else {
        console.log('[AURUM AUTO] Signal ignore - trop recent');
      }
    } else {
      console.log(`[AURUM AUTO] Signal rejete: ${quality} ${confidence}%`);
    }
  } catch (error) {
    console.error('[AURUM AUTO] Erreur:', error.message);
  }
});

// Sauvegarde signal en memoire (remplacer par DB en prod)
const signals = [];
async function saveSignal(signal, asset, type) {
  signals.push({
    ...signal,
    asset,
    type,
    timestamp: new Date().toISOString()
  });
  if (signals.length > 100) signals.shift();
}

app.get('/api/history', (req, res) => {
  res.json({ success: true, signals: signals.slice().reverse() });
});

app.listen(PORT, () => {
  console.log(`[AURUM v18 PRO] Serveur demarre sur port ${PORT}`);
  console.log(`[AURUM v18 PRO] Interface: http://localhost:${PORT}`);
});
