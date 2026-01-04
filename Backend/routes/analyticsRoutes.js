const express = require('express');
const {
    monthlyAnalytics,
    recurringExpenses,
    highSpendingCategories,
    expenseIncomeRatio
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes protected
router.use(protect);

router.get('/monthly-analytics', monthlyAnalytics);
router.get('/recurring-expenses', recurringExpenses);
router.get('/high-spending', highSpendingCategories);
router.get('/expense-income-ratio', expenseIncomeRatio);

module.exports = router;
