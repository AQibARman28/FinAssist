const express = require('express');
const {
    createIncome,
    getIncomes,
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

router.get('/:id',    validate({ params: idParams }),                       getIncomeById);
router.put('/:id',    validate({ params: idParams, body: income.update }),  updateIncome);
router.delete('/:id', validate({ params: idParams }),                       deleteIncome);

module.exports = router;
