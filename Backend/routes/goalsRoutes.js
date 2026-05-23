const express = require('express');
const {
    createGoal, getGoals, getGoalById,
    updateGoal, deleteGoal,
    addContribution, getGoalProgress,
    getGoalReminders, getGoalsDashboard, getGoalPlan,
    getAllocationSuggestion, allocateContributions,
} = require('../controllers/goalController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const goal = require('../validators/goal');
const { idParams } = require('../validators/common');

const router = express.Router();

router.use(protect);

router.get('/',  validate({ query: goal.list }),  getGoals);
router.post('/', validate({ body:  goal.create }), createGoal);

router.get('/dashboard', getGoalsDashboard);
router.get('/reminders', getGoalReminders);
router.get('/plan',      getGoalPlan);
router.get('/allocation-suggestion', getAllocationSuggestion);
router.post('/allocate', validate({ body: goal.allocate }), allocateContributions);

router.get('/:id',    validate({ params: idParams }),                       getGoalById);
router.put('/:id',    validate({ params: idParams, body: goal.update }),    updateGoal);
router.delete('/:id', validate({ params: idParams }),                       deleteGoal);

router.post('/:id/contribute', validate({ params: idParams, body: goal.contribute }), addContribution);
router.get('/:id/progress',    validate({ params: idParams }),                        getGoalProgress);

module.exports = router;
