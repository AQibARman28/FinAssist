const express = require('express');
const { budgetOptimization, smartTips, financialHealthScore } = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/budget-optimization', budgetOptimization);
router.get('/smart-tips', smartTips);
router.get('/financial-health-score', financialHealthScore);

module.exports = router;
