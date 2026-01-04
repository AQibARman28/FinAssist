const Goal = require('../models/Goal');

// @desc    Create new goal
// @route   POST /api/goals
// @access  Private
const createGoal = async (req, res) => {
    try {
        const { title, description, targetAmount, targetDate, goalType } = req.body;

        const goal = await Goal.create({
            user: req.user._id,
            title,
            description,
            targetAmount,
            targetDate,
            goalType
        });

        res.status(201).json({
            success: true,
            data: goal
        });
    } catch (error) {
        console.error('Create goal error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error creating goal'
        });
    }
};

// @desc    Get all goals for user
// @route   GET /api/goals
// @access  Private
const getGoals = async (req, res) => {
    try {
        const { status, goalType } = req.query;

        const query = { user: req.user._id };

        if (status) query.status = status;
        if (goalType) query.goalType = goalType;

        const goals = await Goal.find(query).sort({ createdAt: -1 });

        res.json({
            success: true,
            data: goals
        });
    } catch (error) {
        console.error('Get goals error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching goals'
        });
    }
};

// @desc    Get goal by ID
// @route   GET /api/goals/:id
// @access  Private
const getGoalById = async (req, res) => {
    try {
        const goal = await Goal.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        res.json({
            success: true,
            data: goal
        });
    } catch (error) {
        console.error('Get goal error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching goal'
        });
    }
};

// @desc    Update goal
// @route   PUT /api/goals/:id
// @access  Private
const updateGoal = async (req, res) => {
    try {
        const goal = await Goal.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        const updatedGoal = await Goal.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            data: updatedGoal
        });
    } catch (error) {
        console.error('Update goal error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error updating goal'
        });
    }
};

// @desc    Delete goal
// @route   DELETE /api/goals/:id
// @access  Private
const deleteGoal = async (req, res) => {
    try {
        const goal = await Goal.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        await Goal.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Goal deleted successfully'
        });
    } catch (error) {
        console.error('Delete goal error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error deleting goal'
        });
    }
};

// @desc    Add contribution to goal
// @route   POST /api/goals/:id/contribute
// @access  Private
const addContribution = async (req, res) => {
    try {
        const { amount, note } = req.body;

        const goal = await Goal.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        if (goal.status === 'Completed') {
            return res.status(400).json({
                success: false,
                message: 'Cannot add contribution to completed goal'
            });
        }

        goal.contributions.push({
            amount,
            note,
            date: new Date()
        });

        await goal.save();

        res.json({
            success: true,
            data: goal,
            message: 'Contribution added successfully'
        });
    } catch (error) {
        console.error('Add contribution error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error adding contribution'
        });
    }
};

// @desc    Get goal progress
// @route   GET /api/goals/:id/progress
// @access  Private
const getGoalProgress = async (req, res) => {
    try {
        const goal = await Goal.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        const progressData = {
            goalId: goal._id,
            title: goal.title,
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            remainingAmount: goal.remainingAmount,
            progressPercentage: goal.progressPercentage,
            daysRemaining: goal.daysRemaining,
            isOverdue: goal.isOverdue,
            status: goal.status,
            contributions: goal.contributions.sort((a, b) => new Date(b.date) - new Date(a.date)),
            monthlyTarget: goal.daysRemaining > 0 ? Math.ceil(goal.remainingAmount / (goal.daysRemaining / 30)) : 0
        };

        res.json({
            success: true,
            data: progressData
        });
    } catch (error) {
        console.error('Get goal progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching goal progress'
        });
    }
};

// @desc    Get goal reminders/nudges
// @route   GET /api/goals/reminders
// @access  Private
const getGoalReminders = async (req, res) => {
    try {
        const goals = await Goal.find({
            user: req.user._id,
            status: 'Active'
        });

        const reminders = [];

        goals.forEach(goal => {
            const daysRemaining = goal.daysRemaining;
            const progressPercentage = goal.progressPercentage;
            const remainingAmount = goal.remainingAmount;

            // Goal is overdue
            if (goal.isOverdue) {
                reminders.push({
                    type: 'overdue',
                    severity: 'high',
                    goalId: goal._id,
                    title: goal.title,
                    message: `Your goal "${goal.title}" is overdue. Consider adjusting the target date or increasing contributions.`
                });
            }
            // Goal is behind schedule
            else if (daysRemaining > 0 && progressPercentage < 50 && daysRemaining < 90) {
                const suggestedWeeklyAmount = Math.ceil(remainingAmount / (daysRemaining / 7));
                reminders.push({
                    type: 'behind_schedule',
                    severity: 'medium',
                    goalId: goal._id,
                    title: goal.title,
                    message: `You're behind on "${goal.title}". Consider adding ${suggestedWeeklyAmount} BDT weekly to stay on track.`
                });
            }
            // Encourage regular contributions
            else if (goal.contributions.length === 0 ||
                (goal.contributions.length > 0 &&
                    new Date() - new Date(goal.contributions[goal.contributions.length - 1].date) > 7 * 24 * 60 * 60 * 1000)) {
                const suggestedAmount = Math.ceil(remainingAmount / Math.max(1, daysRemaining / 30));
                reminders.push({
                    type: 'contribution_reminder',
                    severity: 'low',
                    goalId: goal._id,
                    title: goal.title,
                    message: `Add ${suggestedAmount} BDT to "${goal.title}" this month to stay on track.`
                });
            }
        });

        res.json({
            success: true,
            data: reminders
        });
    } catch (error) {
        console.error('Get goal reminders error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching goal reminders'
        });
    }
};

// @desc    Get goals dashboard
// @route   GET /api/goals/dashboard
// @access  Private
const getGoalsDashboard = async (req, res) => {
    try {
        const goals = await Goal.find({ user: req.user._id });

        const dashboard = {
            totalGoals: goals.length,
            activeGoals: goals.filter(g => g.status === 'Active').length,
            completedGoals: goals.filter(g => g.status === 'Completed').length,
            pausedGoals: goals.filter(g => g.status === 'Paused').length,
            totalTargetAmount: goals.reduce((sum, g) => sum + g.targetAmount, 0),
            totalSavedAmount: goals.reduce((sum, g) => sum + g.currentAmount, 0),
            overallProgress: 0,
            recentGoals: goals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5),
            urgentGoals: goals.filter(g => g.status === 'Active' && g.daysRemaining < 30 && g.daysRemaining > 0)
        };

        if (dashboard.totalTargetAmount > 0) {
            dashboard.overallProgress = Math.round((dashboard.totalSavedAmount / dashboard.totalTargetAmount) * 100);
        }

        res.json({
            success: true,
            data: dashboard
        });
    } catch (error) {
        console.error('Get goals dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching goals dashboard'
        });
    }
};

module.exports = {
    createGoal,
    getGoals,
    getGoalById,
    updateGoal,
    deleteGoal,
    addContribution,
    getGoalProgress,
    getGoalReminders,
    getGoalsDashboard
};
