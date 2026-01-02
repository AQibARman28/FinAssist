const express = require('express');
const {
    createGoal,
    getGoals,
    getGoalById,
    updateGoal,
    deleteGoal,
    addContribution,
    getGoalProgress,
    getGoalReminders,
    getGoalsDashboard
} = require('../controllers/goalController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

router.route('/')
    .get(getGoals)
    .post(createGoal);


router.get('/dashboard', getGoalsDashboard);
router.get('/reminders', getGoalReminders);

router.route('/:id')
    .get(getGoalById)
    .put(updateGoal)
    .delete(deleteGoal);

router.post('/:id/contribute', addContribution);
router.get('/:id/progress', getGoalProgress);

module.exports = router;
