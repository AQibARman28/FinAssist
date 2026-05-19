const express = require('express');
const {
    createExpense, getExpenses, getExpenseById,
    updateExpense, deleteExpense, getMonthlySummary,
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const expense = require('../validators/expense');
const { idParams } = require('../validators/common');

const router = express.Router();

router.use(protect);

router.get('/',  validate({ query: expense.list }),  getExpenses);
router.post('/', validate({ body:  expense.create }), createExpense);

// Specific routes before /:id to prevent Express shadowing them
router.get('/summary/:year/:month', validate({ params: expense.summaryParams }), getMonthlySummary);

router.get('/:id',    validate({ params: idParams }),                              getExpenseById);
router.put('/:id',    validate({ params: idParams, body: expense.update }),        updateExpense);
router.delete('/:id', validate({ params: idParams }),                              deleteExpense);

module.exports = router;
