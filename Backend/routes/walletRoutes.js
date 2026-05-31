const express = require('express');
const { rolloverStatus, rollover } = require('../controllers/savingsController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const savings = require('../validators/savings');

const router = express.Router();
router.use(protect);

router.get('/rollover-status', rolloverStatus);
router.post('/rollover', validate({ body: savings.rollover }), rollover);

module.exports = router;
