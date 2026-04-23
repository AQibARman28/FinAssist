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

// Specific routes MUST come before /:id to avoid being captured as an id param
router.get('/tracking/:year/:month', getBudgetTracking);
router.get('/alerts', getBudgetAlerts);
router.post('/reset', resetBudgets);

router.route('/:id')
    .get(getBudgetById)
    .put(updateBudget)
    .delete(deleteBudget);

module.exports = router;
