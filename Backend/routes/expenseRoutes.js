const express = require('express');
const {
    createExpense,
    getExpenses,
    getExpenseById,
    updateExpense,
    deleteExpense,
    getMonthlySummary
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

router.route('/')
    .get(getExpenses)
    .post(createExpense);

// Specific routes before /:id to prevent Express shadowing them
router.get('/summary/:year/:month', getMonthlySummary);

router.route('/:id')
    .get(getExpenseById)
    .put(updateExpense)
    .delete(deleteExpense);

module.exports = router;
