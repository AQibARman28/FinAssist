const express = require('express');
const {
    createBudget, getBudgets, getBudgetById,
    updateBudget, deleteBudget,
    getBudgetTracking, getBudgetAlerts, resetBudgets,
} = require('../controllers/budgetController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const budget = require('../validators/budget');
const { idParams } = require('../validators/common');

const router = express.Router();

router.use(protect);

router.get('/',  validate({ query: budget.list }),  getBudgets);
router.post('/', validate({ body:  budget.create }), createBudget);

// Specific routes MUST come before /:id
router.get('/tracking/:year/:month', validate({ params: budget.trackingParams }), getBudgetTracking);
router.get('/alerts',                getBudgetAlerts);
router.post('/reset',                validate({ body: budget.reset }), resetBudgets);

router.get('/:id',    validate({ params: idParams }),                          getBudgetById);
router.put('/:id',    validate({ params: idParams, body: budget.update }),     updateBudget);
router.delete('/:id', validate({ params: idParams }),                          deleteBudget);

module.exports = router;
