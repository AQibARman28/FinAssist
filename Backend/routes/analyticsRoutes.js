const express = require('express');
const {
    monthlyAnalytics,
    recurringExpenses,
    recurringIncome,
    highSpendingCategories,
    expenseIncomeRatio,
    savingsRate,
    dashboardStats,
    spendingTimeline,
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { spendingTimeline: spendingTimelineQuery } = require('../validators/analytics');

const router = express.Router();

router.use(protect);

router.get('/monthly-analytics',    monthlyAnalytics);
router.get('/recurring-expenses',   recurringExpenses);     // deprecated, returns []
router.get('/recurring-income',     recurringIncome);
router.get('/high-spending',        highSpendingCategories);
router.get('/expense-income-ratio', expenseIncomeRatio);
router.get('/savings-rate',         savingsRate);
router.get('/dashboard-stats',      dashboardStats);
router.get('/spending-timeline',    validate({ query: spendingTimelineQuery }), spendingTimeline);

module.exports = router;
