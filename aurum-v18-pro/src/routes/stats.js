const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    stats: {
      total: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: 0,
      message: 'Statistiques disponibles apres les premiers trades'
    }
  });
});

module.exports = router;
