const axios = require('axios');

const TD_KEY = process.env.TWELVEDATA_KEY;

const ASSETS = {
  'XAU/USD': { td: 'XAU/USD', yahoo: 'GC=F', type: 'forex' },
  'EUR/USD': { td: 'EUR/USD', yahoo: 'EURUSD=X', type: 'forex' },
  'BTC/USD': { td: 'BTC/USD', yahoo: 'BTC-USD', type: 'crypto' }
};

async function getPrice(asset) {
  const cfg = ASSETS[asset] || ASSETS['XAU/USD'];

  // Source 1: TwelveData
  try {
    const r = await axios.get(`https://api.twelvedata.com/price`, {
      params: { symbol: cfg.td, apikey: TD_KEY },
      timeout: 5000
    });
    if (r.data && r.data.price && parseFloat(r.data.price) > 0) {
      return parseFloat(r.data.price);
    }
  } catch (e) {}

  // Source 2: Metals Live pour or
  if (asset === 'XAU/USD') {
    try {
      const r = await axios.get('https://api.metals.live/v1/spot/gold', { timeout: 5000 });
      if (r.data && r.data[0] && r.data[0].gold > 3000) {
        return r.data[0].gold;
      }
    } catch (e) {}
  }

  // Source 3: Yahoo Finance
  try {
    const r = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${cfg.yahoo}?interval=1m&range=1d`,
      { timeout: 8000 }
    );
    const price = r.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price && price > 0) return price;
  } catch (e) {}

  throw new Error(`Prix indisponible pour ${asset}`);
}

async function getCandles(asset, interval = '15min', outputsize = 50) {
  const cfg = ASSETS[asset] || ASSETS['XAU/USD'];
  try {
    const r = await axios.get('https://api.twelvedata.com/time_series', {
      params: {
        symbol: cfg.td,
        interval,
        outputsize,
        apikey: TD_KEY
      },
      timeout: 10000
    });
    if (r.data && r.data.values) {
      return r.data.values.map(c => ({
        time: c.datetime,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume || 0)
      }));
    }
  } catch (e) {
    console.error('[Market] Erreur candles:', e.message);
  }
  return [];
}

module.exports = { getPrice, getCandles, ASSETS };
