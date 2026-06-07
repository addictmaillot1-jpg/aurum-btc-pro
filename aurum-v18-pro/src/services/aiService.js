const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

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
  if (!candles || candles.length === 0) return 'Données indisponibles';
  return candles.slice(-limit).map(c => {
    const d = new Date(c.time * 1000).toISOString().slice(0, 16);
    return `${d} O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)}`;
  }).join('\n');
}

async function generateSignal(asset, price, indicators, timeframe, newsRisk) {
  const session = getSession();
  const now     = new Date().toLocaleString('fr-FR');
  const atr     = indicators.atr || price * 0.002;
  const slDist  = Math.max(Math.round(atr * 1.5 * 100) / 100, 100);
  const tfd     = indicators.allTimeframes || {};
  const news    = newsRisk || { news_status: 'CLEAR', news_event: 'NONE', minutes_to_event: 0, macro_risk: 'LOW', blocked: false };

  // Bloquage immédiat si news BLOQUÉE
  if (news.blocked) {
    console.log(`[AI-BTC] Bloqué par news: ${news.news_event}`);
    return null;
  }

  // Direction forcée si trend clair et M15/M5 alignés
  const m15B = tfd['M15']?.bias || 'NEUTRAL';
  const m5B  = tfd['M5']?.bias  || 'NEUTRAL';
  const forcedDirection =
    (m15B === 'BULLISH' && m5B === 'BULLISH') ? 'BUY'  :
    (m15B === 'BEARISH' && m5B === 'BEARISH') ? 'SELL' : null;

  const candlesM15 = tfd['M15'] ? formatCandles(tfd['M15'].candles || [], 20) : 'N/A';
  const candlesM5  = tfd['M5']  ? formatCandles(tfd['M5'].candles  || [], 30) : 'N/A';

  const tfSummary = ['M5','M15'].map(tf => {
    const d = tfd[tf];
    if (!d) return `${tf}: N/A`;
    const smc = d.smc || {};
    const liq = d.liquidity || {};
    const eqh = liq.equalHighs?.join(', ') || 'NONE';
    const eql = liq.equalLows?.join(', ')  || 'NONE';
    const dt  = liq.doubleTop    ? `Double Top @ ${liq.doubleTop.level}`       : 'NONE';
    const db  = liq.doubleBottom ? `Double Bottom @ ${liq.doubleBottom.level}` : 'NONE';
    const sessLiq = liq.sessionLiquidity ? Object.entries(liq.sessionLiquidity).map(([s,v])=>`${s}[H:${v.high} L:${v.low}]`).join(' ') : 'N/A';
    return `${tf}: RSI=${d.rsi} EMA20=${d.ema20} EMA50=${d.ema50} ATR=${d.atr} ADX=${d.adx} MACD=${d.macd?.histogram} → ${d.bias}
  BOS:${smc.bos?.direction||'NONE'} CHOCH:${smc.choch?.direction||'NONE'} FVG:${smc.fvgs?.length||0} OB:${smc.orderBlocks?.length||0}
  EQH(BSL):${eqh} EQL(SSL):${eql}
  ${dt} | ${db}
  Sessions: ${sessLiq}`;
  }).join('\n');

  const system = `Tu es un trader institutionnel spécialisé dans le scalping BTCUSD.

OBJECTIF: Identifier uniquement les setups BTCUSD à très forte probabilité.
Durée moyenne des trades: Minimum 1 minute, Maximum 45 minutes.
La qualité du setup est prioritaire sur la fréquence des trades.
Si aucun avantage statistique clair n'existe: NO_TRADE.

ARCHITECTURE MULTI-TIMEFRAME:
M15 = CERVEAU → tendance dominante, BOS, CHOCH, liquidité, FVG, OB, biais principal
M5  = GÂCHETTE → entrée précise, validation M15, momentum, rejet, déclenchement

RÈGLE ABSOLUE: Si M15 et M5 ne sont pas alignés → NO_TRADE.
M15 BUY + M5 BUY = autorisé | M15 SELL + M5 SELL = autorisé | Sinon = NO_TRADE

PRIORITÉ D'ANALYSE:
1. Structure: HH, HL, LH, LL, BOS, CHOCH
2. Liquidité: BSL (Equal Highs), SSL (Equal Lows), Double Top/Bottom, Sessions
3. SMC: Order Blocks valides, FVG valides, zones institutionnelles
4. Momentum (confirmation uniquement): RSI, EMA20/50, MACD, ATR, ADX
5. News (priorité absolue)

═══ FILTRE NEWS PROFESSIONNEL ═══
Les annonces macroéconomiques majeures ont priorité sur toute analyse technique.

ÉVÉNEMENTS MAJEURS (FOMC, Fed Rate, CPI, Core CPI, PCE, Core PCE):
- 30 min avant ou 60 min après → NO_TRADE automatique, aucune exception

ÉVÉNEMENTS IMPORTANTS (NFP, ISM, GDP, Retail Sales, JOLTS, ADP):
- 15 min avant ou 30 min après → Réduire confiance, jamais A+ ni >85%

APRÈS UNE NEWS: Attendre stabilisation + BOS confirmé + liquidité capturée + retour FVG/OB.
Les premières bougies après news sont potentiellement manipulatrices.

RÈGLE PROFESSIONNELLE: Volatilité ≠ Opportunité. La priorité reste: Structure > Liquidité > BOS/CHOCH > FVG/OB > Momentum > News.

NOTATION:
A+ = Liquidité capturée + BOS confirmé + FVG/OB propre + M15/M5 alignés + Momentum aligné + News CLEAR
A  = Structure forte + bonne confluence + momentum valide
B  = Setup acceptable mais incomplet
< B = NO_TRADE

GESTION DU RISQUE:
SL = derrière la structure invalidante / dernier swing significatif
TP1=1R, TP2=2R, TP3=3R. Ratio min 1:2 sinon NO_TRADE.
Si doute → NO_TRADE.

Réponds UNIQUEMENT avec un JSON valide, sans texte ni backtick.`;

  const prompt = `SCALPING BTCUSD — ${now}
SESSION: ${session}
PRIX: ${price} | ATR: ${atr} | ADX: ${indicators.adx} | RSI: ${indicators.rsi}
SL distance min: ${slDist}$

═══ STATUT NEWS ═══
Status: ${news.news_status}
Événement: ${news.news_event}
Minutes avant/après: ${news.minutes_to_event}
Risque macro: ${news.macro_risk}
${news.blocked ? '⛔ TRADE BLOQUÉ — Fenêtre news critique' : news.reduce_confidence ? '⚠️ CONFIANCE RÉDUITE — News importante proche' : '✅ Pas de news critique'}

═══ BOUGIES M15 (20 dernières) ═══
${candlesM15}

═══ BOUGIES M5 (30 dernières) ═══
${candlesM5}

═══ INDICATEURS + SMC + LIQUIDITÉ PAR TIMEFRAME ═══
${tfSummary}

═══ NIVEAUX CLÉS ═══
Support: ${indicators.sr?.support} | Résistance: ${indicators.sr?.resistance}
EMA20: ${indicators.ema20} | EMA50: ${indicators.ema50}
Bollinger: U=${indicators.bollinger?.upper} L=${indicators.bollinger?.lower}

═══ CALCUL SL/TP ═══
SL distance = max(ATR×2, 200$) = ${slDist}$
BUY  → SL=${+(price-slDist).toFixed(2)}, TP1=${+(price+slDist).toFixed(2)}, TP2=${+(price+slDist*2).toFixed(2)}, TP3=${+(price+slDist*3).toFixed(2)}
SELL → SL=${+(price+slDist).toFixed(2)}, TP1=${+(price-slDist).toFixed(2)}, TP2=${+(price-slDist*2).toFixed(2)}, TP3=${+(price-slDist*3).toFixed(2)}

FORMAT JSON OBLIGATOIRE:
{
  "direction": "BUY | SELL | NO_TRADE",
  "confidence": 0-100,
  "quality": "A+ | A | B",
  "entry": ${price},
  "sl": 0,
  "tp1": 0,
  "tp2": 0,
  "tp3": 0,
  "rr": "1:2 ou plus",
  "timeframe_context": "M15",
  "timeframe_entry": "M5",
  "duree_estimee": "1 à 45 minutes",
  "bias_m15": "",
  "bias_m5": "",
  "bos": "",
  "choch": "",
  "fvg": "",
  "order_block": "",
  "liquidity": "",
  "equal_highs": "",
  "equal_lows": "",
  "double_top": "",
  "double_bottom": "",
  "session_liquidity": "",
  "reason": "",
  "risks": "",
  "invalidation": "",
  "news_status": "${news.news_status}",
  "news_event": "${news.news_event}",
  "minutes_to_event": ${news.minutes_to_event},
  "macro_risk": "${news.macro_risk}",
  "session": "${session}",
  "atr": ${atr},
  "adx": ${indicators.adx},
  "rsi": ${indicators.rsi},
  "score": ${indicators.score || 50}
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text;
    const s   = raw.indexOf('{');
    const e   = raw.lastIndexOf('}');
    if (s < 0) return null;

    let signal = JSON.parse(raw.slice(s, e+1));
    if (!signal.direction) return null;

    if (signal.direction === 'NO_TRADE') {
      if (forcedDirection) {
        console.log(`[AI-BTC] Claude dit NO_TRADE → force ${forcedDirection} (M15:${m15B} M5:${m5B})`);
        signal = {
          direction: forcedDirection,
          confidence: 80,
          quality: 'A',
          entry: price,
          sl:  forcedDirection === 'BUY' ? +(price-slDist).toFixed(2) : +(price+slDist).toFixed(2),
          tp1: forcedDirection === 'BUY' ? +(price+slDist).toFixed(2) : +(price-slDist).toFixed(2),
          tp2: forcedDirection === 'BUY' ? +(price+slDist*2).toFixed(2) : +(price-slDist*2).toFixed(2),
          tp3: forcedDirection === 'BUY' ? +(price+slDist*3).toFixed(2) : +(price-slDist*3).toFixed(2),
          rr: '1:3',
          timeframe_context: 'M15', timeframe_entry: 'M5',
          duree_estimee: '15-45 minutes',
          bias_m15: m15B, bias_m5: m5B,
          bos: 'Détecté', choch: 'N/A', fvg: 'N/A', order_block: 'N/A',
          liquidity: 'N/A', equal_highs: 'N/A', equal_lows: 'N/A',
          double_top: 'N/A', double_bottom: 'N/A', session_liquidity: 'N/A',
          reason: `Trend STRONG ${forcedDirection === 'BUY' ? 'BULLISH' : 'BEARISH'} — M15 et M5 alignés ${m15B}`,
          risks: 'Signal forcé par alignement technique',
          invalidation: forcedDirection === 'BUY' ? `Sous ${+(price-slDist).toFixed(2)}` : `Au-dessus de ${+(price+slDist).toFixed(2)}`,
          news_status: news.news_status, news_event: news.news_event,
          minutes_to_event: news.minutes_to_event, macro_risk: news.macro_risk,
          session, atr, adx: indicators.adx, rsi: indicators.rsi, score: indicators.score || 50
        };
      } else {
        console.log('[AI-BTC] NO_TRADE — pas de setup valide');
        return null;
      }
    }

    // Vérif alignement M15/M5
    const m15Bias = tfd['M15']?.bias || 'NEUTRAL';
    const m5Bias  = tfd['M5']?.bias  || 'NEUTRAL';
    if (signal.direction === 'BUY'  && (m15Bias !== 'BULLISH' || m5Bias !== 'BULLISH')) {
      console.log(`[AI-BTC] BUY bloqué — M15:${m15Bias} M5:${m5Bias} non alignés`);
      return null;
    }
    if (signal.direction === 'SELL' && (m15Bias !== 'BEARISH' || m5Bias !== 'BEARISH')) {
      console.log(`[AI-BTC] SELL bloqué — M15:${m15Bias} M5:${m5Bias} non alignés`);
      return null;
    }

    // Correction SL/TP si inversés
    const isBuy = signal.direction === 'BUY';
    const entry = parseFloat(signal.entry) || price;
    if (isBuy  && parseFloat(signal.sl) > entry) {
      signal.sl=+(entry-slDist).toFixed(2); signal.tp1=+(entry+slDist).toFixed(2);
      signal.tp2=+(entry+slDist*2).toFixed(2); signal.tp3=+(entry+slDist*3).toFixed(2);
    }
    if (!isBuy && parseFloat(signal.sl) < entry) {
      signal.sl=+(entry+slDist).toFixed(2); signal.tp1=+(entry-slDist).toFixed(2);
      signal.tp2=+(entry-slDist*2).toFixed(2); signal.tp3=+(entry-slDist*3).toFixed(2);
    }

    // Vérif R:R minimum 1:2
    const rrNum = Math.abs(entry - parseFloat(signal.tp2)) / Math.abs(entry - parseFloat(signal.sl));
    if (rrNum < 1.8) {
      console.log(`[AI-BTC] R:R insuffisant: ${rrNum.toFixed(1)} < 2`);
      return null;
    }

    // Si news HIGH_RISK → cap confiance à 85% et qualité max A
    if (news.reduce_confidence) {
      signal.confidence = Math.min(signal.confidence, 85);
      if (signal.quality === 'A+') signal.quality = 'A';
    }

    if (signal.confidence <= 10) signal.confidence = signal.confidence * 10;

    console.log(`[AI-BTC] ${signal.direction} ${signal.confidence}% ${signal.quality} | M15:${m15Bias} M5:${m5Bias} | News:${news.news_status} | Durée:${signal.duree_estimee}`);
    return signal;

  } catch (error) {
    console.error('[AI-BTC] Erreur:', error.message);
    return null;
  }
}

module.exports = { generateSignal };
