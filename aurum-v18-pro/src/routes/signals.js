const express = require('express');
const router = express.Router();

let signalHistory = [];

router.get('/', (req, res) => {
  res.json({ success: true, signals: signalHistory.slice(-50).reverse() });
});

router.post('/save', (req, res) => {
  const signal = req.body;
  signalHistory.push({ ...signal, timestamp: new Date().toISOString() });
  if (signalHistory.length > 200) signalHistory.shift();
  res.json({ success: true });
});

module.exports = router;
