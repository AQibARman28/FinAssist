const express = require('express');
const { getSavings, depositSavings, withdrawSavings } = require('../controllers/savingsController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const savings = require('../validators/savings');

const router = express.Router();
router.use(protect);

router.get('/', getSavings);
router.post('/deposit',  validate({ body: savings.deposit }),  depositSavings);
router.post('/withdraw', validate({ body: savings.withdraw }), withdrawSavings);

module.exports = router;
