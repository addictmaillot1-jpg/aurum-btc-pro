const https = require('https');

const TOKEN   = process.env.TELEGRAM_TOKEN_BTC;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function httpsPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: 'api.telegram.org', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({ ok: false }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function escapeHTML(text) {
  return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function sendSignal(signal, type, asset) {
  if (!TOKEN || !CHAT_ID || !signal || !signal.direction) return false;

  const isBuy  = signal.direction === 'BUY';
  const emoji  = isBuy ? '🟢' : '🔴';
  const q      = signal.quality || 'B';
  const star   = q==='A+'?'⭐⭐⭐':q==='A'?'⭐⭐':'⭐';
  const label  = type==='AUTO'?'🤖 AUTO':'📡 MANUEL';
  const conf   = signal.confidence<=10?signal.confidence*10:signal.confidence;

  const msg = `${emoji} <b>AURUM BTC PRO — ${signal.direction}</b> ${label}
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
    const result = await httpsPost(`/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID, text: msg, parse_mode: 'HTML'
    });
    if (result.ok) { console.log('[Telegram-BTC] Signal envoyé ✓'); return true; }
    else { console.error('[Telegram-BTC] Erreur:', result.description); return false; }
  } catch(err) {
    console.error('[Telegram-BTC] Erreur réseau:', err.message);
    return false;
  }
}

async function sendMessage(text) {
  if (!TOKEN || !CHAT_ID) return;
  try {
    await httpsPost(`/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID, text: escapeHTML(text), parse_mode: 'HTML'
    });
  } catch(err) {
    console.error('[Telegram-BTC] Erreur message:', err.message);
  }
}

module.exports = { sendSignal, sendMessage };
