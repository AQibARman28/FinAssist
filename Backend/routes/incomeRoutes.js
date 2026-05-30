const express = require('express');
const {
    createIncome,
    getIncomes,
    getIncomeTimeline,
    getIncomeById,
    updateIncome,
    deleteIncome,
} = require('../controllers/incomeController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const income = require('../validators/income');
const { idParams } = require('../validators/common');

const router = express.Router();

router.use(protect);

router.get('/',  validate({ query: income.list }),   getIncomes);
router.post('/', validate({ body:  income.create }), createIncome);

// Specific route — must stay above '/:id' so 'timeline' isn't treated as an id.
router.get('/timeline', validate({ query: income.timeline }), getIncomeTimeline);

router.get('/:id',    validate({ params: idParams }),                       getIncomeById);
router.put('/:id',    validate({ params: idParams, body: income.update }),  updateIncome);
router.delete('/:id', validate({ params: idParams }),                       deleteIncome);

module.exports = router;
