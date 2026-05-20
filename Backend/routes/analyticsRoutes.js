const express = require('express');
const {
    monthlyAnalytics,
    recurringExpenses,
    recurringIncome,
    highSpendingCategories,
    expenseIncomeRatio,
    savingsRate,
    dashboardStats,
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/monthly-analytics',    monthlyAnalytics);
router.get('/recurring-expenses',   recurringExpenses);     // deprecated, returns []
router.get('/recurring-income',     recurringIncome);
router.get('/high-spending',        highSpendingCategories);
router.get('/expense-income-ratio', expenseIncomeRatio);
router.get('/savings-rate',         savingsRate);
router.get('/dashboard-stats',      dashboardStats);

module.exports = router;
