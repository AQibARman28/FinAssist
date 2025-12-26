const express = require('express');
const {
    createBudget,
    getBudgets,
    getBudgetById,
    updateBudget,
    deleteBudget,
    getBudgetTracking,
    getBudgetAlerts,
    resetBudgets
} = require('../controllers/budgetController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

router.route('/')
    .get(getBudgets)
    .post(createBudget);

router.route('/:id')
    .get(getBudgetById)
    .put(updateBudget)
    .delete(deleteBudget);

router.get('/tracking/:year/:month', getBudgetTracking);
router.get('/alerts', getBudgetAlerts);
router.post('/reset', resetBudgets);

module.exports = router;
