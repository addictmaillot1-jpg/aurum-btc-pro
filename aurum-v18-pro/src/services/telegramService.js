const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendSignal(signal, type, asset) {
  const dir = signal.direction === 'BUY' ? 'ACHAT' : 'VENTE';
  const emoji = type === 'AUTO' ? 'AURUM AUTO' : 'AURUM SIGNAL';
  const dirEmoji = signal.direction === 'BUY' ? 'BUY [+]' : 'SELL [-]';
  const qualColor = signal.quality === 'A+' ? 'ULTRA FORT' : signal.quality === 'A' ? 'FORT' : 'MOYEN';

  const msg = `<b>${emoji}</b> ${dirEmoji}
--------------------

<b>${asset}</b>
<b>Direction:</b> ${dir}
<b>Confiance:</b> ${signal.confidence}% - ${qualColor}
<b>Qualite:</b> ${signal.quality}

<b>Entree:</b> ${signal.entry}
<b>Zone:</b> ${signal.zone || signal.entry}
<b>SL:</b> ${signal.sl}
<b>TP1:</b> ${signal.tp1}
<b>TP2:</b> ${signal.tp2}
<b>TP3:</b> ${signal.tp3}
<b>R:R:</b> ${signal.rr}

<b>RSI:</b> ${signal.rsi} | <b>ADX:</b> ${signal.adx} | <b>ATR:</b> ${signal.atr}
<b>Biais EMA:</b> ${signal.ema_bias}
<b>Session:</b> ${signal.session}
<b>Timeframe:</b> ${signal.timeframe}

<b>Motif:</b> ${signal.reason}

${new Date().toLocaleString('fr-FR')}`;

  try {
    const r = await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      { chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' },
      { timeout: 10000 }
    );
    console.log('[Telegram] Signal envoye!');
    return true;
  } catch (error) {
    console.error('[Telegram] Erreur:', error.message);
    return false;
  }
}

async function sendMessage(text) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      { chat_id: CHAT_ID, text, parse_mode: 'HTML' },
      { timeout: 10000 }
    );
  } catch (error) {
    console.error('[Telegram] Erreur message:', error.message);
  }
}

module.exports = { sendSignal, sendMessage };
