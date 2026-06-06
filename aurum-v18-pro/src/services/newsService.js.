const https = require('https');

const FINNHUB_KEY = process.env.FINNHUB_KEY;

// ================================================================
// ÉVÉNEMENTS MAJEURS — Fenêtre 30 min avant / 60 min après
// ================================================================
const MAJOR_EVENTS = [
  'FOMC', 'Federal Funds Rate', 'Fed Rate Decision', 'Fed Press Conference',
  'CPI', 'Core CPI', 'Consumer Price Index', 'PCE', 'Core PCE',
  'Personal Consumption Expenditures'
];

// ================================================================
// ÉVÉNEMENTS IMPORTANTS — Fenêtre 15 min avant / 30 min après
// ================================================================
const IMPORTANT_EVENTS = [
  'NFP', 'Nonfarm Payrolls', 'Non-Farm Payroll',
  'ISM Manufacturing', 'ISM Services', 'ISM Non-Manufacturing',
  'GDP', 'Gross Domestic Product',
  'Retail Sales', 'JOLTS', 'Job Openings',
  'ADP Employment', 'ADP Nonfarm'
];

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

// ================================================================
// FETCH CALENDRIER ÉCONOMIQUE FINNHUB
// ================================================================
async function fetchEconomicCalendar() {
  if (!FINNHUB_KEY) return [];
  try {
    const now  = new Date();
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000); // -2h
    const to   = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2h

    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);

    const data = await httpsGet('finnhub.io',
      `/api/v1/calendar/economic?from=${fromStr}&to=${toStr}&token=${FINNHUB_KEY}`);

    if (!data.economicCalendar || !Array.isArray(data.economicCalendar)) return [];
    return data.economicCalendar;
  } catch(e) {
    console.log(`[News] Finnhub erreur: ${e.message}`);
    return [];
  }
}

// ================================================================
// ANALYSE DU RISQUE NEWS
// ================================================================
async function checkNewsRisk() {
  const events  = await fetchEconomicCalendar();
  const now     = Date.now();
  const result  = {
    news_status:     'CLEAR',
    news_event:      'NONE',
    minutes_to_event: 0,
    macro_risk:      'LOW',
    blocked:         false,
    reduce_confidence: false
  };

  if (!events.length) return result;

  // Filtre événements US uniquement (impact sur BTC)
  const usEvents = events.filter(e => e.country === 'US' || e.country === 'United States');

  for (const event of usEvents) {
    const eventTime    = new Date(event.time || event.date).getTime();
    const minutesDiff  = (eventTime - now) / 60000; // positif = futur, négatif = passé
    const eventName    = event.event || event.name || '';

    // Vérifie si c'est un événement MAJEUR
    const isMajor = MAJOR_EVENTS.some(m => eventName.toLowerCase().includes(m.toLowerCase()));

    if (isMajor) {
      // Fenêtre 30 min avant / 60 min après
      if (minutesDiff > -60 && minutesDiff < 30) {
        result.news_status      = 'BLOCKED';
        result.news_event       = eventName;
        result.minutes_to_event = Math.round(minutesDiff);
        result.macro_risk       = 'HIGH';
        result.blocked          = true;
        console.log(`[News] ⛔ BLOQUÉ — ${eventName} dans ${Math.round(minutesDiff)} min`);
        return result;
      }
      // Proche mais pas encore bloqué
      if (minutesDiff > -90 && minutesDiff < 60) {
        result.news_status      = 'HIGH_RISK';
        result.news_event       = eventName;
        result.minutes_to_event = Math.round(minutesDiff);
        result.macro_risk       = 'HIGH';
      }
    }

    // Vérifie si c'est un événement IMPORTANT
    const isImportant = IMPORTANT_EVENTS.some(m => eventName.toLowerCase().includes(m.toLowerCase()));

    if (isImportant && !result.blocked) {
      // Fenêtre 15 min avant / 30 min après
      if (minutesDiff > -30 && minutesDiff < 15) {
        result.news_status        = 'HIGH_RISK';
        result.news_event         = eventName;
        result.minutes_to_event   = Math.round(minutesDiff);
        result.macro_risk         = 'MEDIUM';
        result.reduce_confidence  = true;
        console.log(`[News] ⚠️ RISQUE ÉLEVÉ — ${eventName} dans ${Math.round(minutesDiff)} min`);
      }
    }
  }

  if (result.news_status === 'CLEAR') {
    console.log('[News] ✅ Aucune news critique détectée');
  }

  return result;
}

module.exports = { checkNewsRisk };
