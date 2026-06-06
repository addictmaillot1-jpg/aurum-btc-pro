const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

function getSession() {
  const h = new Date().getUTCHours();
  if (h >= 22 || h < 7) return 'Asia 22h-07h UTC';
  if (h >= 7 && h < 10) return 'London Open 07h-10h UTC';
  if (h >= 10 && h < 12) return 'London Mid 10h-12h UTC';
  if (h >= 12 && h < 14) return 'Overlap London/NY 12h-14h UTC';
  if (h >= 14 && h < 17) return 'New York 14h-17h UTC';
  return 'Pre-market / Close';
}

async function generateSignal(asset, price, indicators, timeframe) {
  const session = getSession();
  const now = new Date().toLocaleString('fr-FR');

  const system = 'Tu es AURUM v18 PRO, le meilleur systeme de trading institutionnel. Tu recois des donnees de marche reelles avec indicateurs calcules localement. Tu generes des signaux ultra-precis bases uniquement sur ces donnees. Reponds UNIQUEMENT avec JSON valide sans texte ni backtick.';

  const prompt = `Analyse ${asset} et genere un signal de trading professionnel.

DONNEES MARCHE TEMPS REEL:
- Actif: ${asset}
- Prix actuel: ${price}
- Session: ${session}
- Timeframe analyse: ${timeframe}
- Date/Heure: ${now}

INDICATEURS TECHNIQUES CALCULES:
- RSI(14): ${indicators.rsi} ${indicators.rsi > 55 ? '(HAUSSIER)' : indicators.rsi < 45 ? '(BAISSIER)' : '(NEUTRE)'}
- EMA20: ${indicators.ema20}
- EMA50: ${indicators.ema50}  
- EMA200: ${indicators.ema200}
- Alignment EMA: ${indicators.bias}
- MACD: ${indicators.macd ? `Line=${indicators.macd.macd} Signal=${indicators.macd.signal} Histo=${indicators.macd.histogram}` : 'N/A'}
- ATR(14): ${indicators.atr} (volatilite)
- ADX(14): ${indicators.adx} ${indicators.adx > 25 ? '(TENDANCE FORTE)' : '(TENDANCE FAIBLE)'}
- Bollinger: Upper=${indicators.bollinger?.upper} Middle=${indicators.bollinger?.middle} Lower=${indicators.bollinger?.lower}
- Support: ${indicators.sr?.support}
- Resistance: ${indicators.sr?.resistance}
- Pivot: ${indicators.sr?.pivot}
- Score confluence: ${indicators.score}/100
- Qualite estimee: ${indicators.quality}

REGLES:
- SL = ATR x 1.5 = ${Math.round(indicators.atr * 1.5 * 100) / 100}
- TP1 = 1R (= SL distance)
- TP2 = 2R
- TP3 = 3R
- Si ADX < 25 et score < 60: direction NO_TRADE
- Entree PROCHE du prix actuel ${price}

FORMAT JSON OBLIGATOIRE:
{"direction":"BUY","confidence":88,"quality":"A","entry":${price},"zone":"${price - 2} - ${price + 2}","sl":${price - indicators.atr * 1.5},"tp1":${price + indicators.atr},"tp2":${price + indicators.atr * 2},"tp3":${price + indicators.atr * 3},"rr":"1:3","signal_type":"AUTO","reason":"Raison precise basee sur les indicateurs","rsi":${indicators.rsi},"ema_bias":"${indicators.bias}","session":"${session}","timeframe":"${timeframe}","atr":${indicators.atr},"adx":${indicators.adx},"score":${indicators.score}}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text;
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0) return null;

    const signal = JSON.parse(raw.slice(s, e + 1));

    if (!signal.direction) return null;
    if (signal.direction === 'NO_TRADE') {
      console.log('[AI] NO_TRADE signal - pas envoye');
      return null;
    }

    return signal;
  } catch (error) {
    console.error('[AI] Erreur generation signal:', error.message);
    return null;
  }
}

module.exports = { generateSignal };
