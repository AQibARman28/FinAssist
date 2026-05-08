const Goal = require('../models/Goal');
const { encrypt, safeDecrypt, generateHMAC, verifyHMAC } = require('../utils/encryption');
const { signRecord, verifyRecord, encryptNote, decryptNote } = require('../utils/signing');

function decryptGoal(goal, user, dataKey) {
    const obj         = goal.toJSON ? goal.toJSON() : { ...goal };
    obj.title         = safeDecrypt(goal.title,       dataKey);
    obj.description   = safeDecrypt(goal.description, dataKey);
    obj.note          = goal.note ? decryptNote(goal.note, user, dataKey) : null;
    return obj;
}

function goalHmacPayload(title, targetAmount, goalType) {
    return { title, targetAmount, goalType };
}

// POST /api/goals
const createGoal = async (req, res) => {
    try {
        const { title, description, targetAmount, targetDate, goalType } = req.body;

        const hmac      = generateHMAC(goalHmacPayload(title, targetAmount, goalType), req.user._id);
        const signature = signRecord(goalHmacPayload(title, targetAmount, goalType), req.user, req.dataKey);
        const encTitle  = encrypt(title, req.dataKey);
        const encDesc   = description ? encrypt(description, req.dataKey) : undefined;
        const encNote   = req.body.note ? encryptNote(req.body.note, req.user) : undefined;

        const goal = await Goal.create({
            user: req.user._id,
            title: encTitle,
            description: encDesc,
            targetAmount,
            targetDate,
            goalType,
            hmac,
            signature,
            note: encNote
        });

        res.status(201).json({ success: true, data: decryptGoal(goal, req.user, req.dataKey) });
    } catch (error) {
        console.error('Create goal error:', error);
        res.status(500).json({ success: false, message: 'Server error creating goal' });
    }
};

// GET /api/goals
const getGoals = async (req, res) => {
    try {
        const { status, goalType } = req.query;

        const query = { user: req.user._id };
        if (status)   query.status   = status;
        if (goalType) query.goalType = goalType;

        const goals = await Goal.find(query).sort({ createdAt: -1 });

        const items = goals.map(g => {
            const plainTitle = safeDecrypt(g.title, req.dataKey);
            if (g.signature && !verifyRecord(goalHmacPayload(plainTitle, g.targetAmount, g.goalType), g.signature, req.user)) {
                console.warn(`Signature integrity failure on goal ${g._id} (user ${req.user._id})`);
            }
            return decryptGoal(g, req.user, req.dataKey);
        });

        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Get goals error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goals' });
    }
};

// GET /api/goals/:id
const getGoalById = async (req, res) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        const plainTitle = safeDecrypt(goal.title, req.dataKey);
        if (goal.hmac && !verifyHMAC(goalHmacPayload(plainTitle, goal.targetAmount, goal.goalType), goal.hmac, req.user._id)) {
            console.warn(`HMAC integrity failure on goal ${goal._id}`);
        }
        if (goal.signature && !verifyRecord(goalHmacPayload(plainTitle, goal.targetAmount, goal.goalType), goal.signature, req.user)) {
            console.warn(`Signature integrity failure on goal ${goal._id} (user ${req.user._id})`);
        }

        res.json({ success: true, data: decryptGoal(goal, req.user, req.dataKey) });
    } catch (error) {
        console.error('Get goal error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goal' });
    }
};

// PUT /api/goals/:id
const updateGoal = async (req, res) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        const updates = {};
        if (req.body.description  !== undefined) updates.description  = encrypt(req.body.description, req.dataKey);
        if (req.body.note         !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : encryptNote(req.body.note, req.user);
        }
        if (req.body.targetAmount !== undefined) updates.targetAmount = req.body.targetAmount;
        if (req.body.targetDate   !== undefined) updates.targetDate   = req.body.targetDate;
        if (req.body.goalType     !== undefined) updates.goalType     = req.body.goalType;
        if (req.body.status       !== undefined) updates.status       = req.body.status;

        let finalTitle = safeDecrypt(goal.title, req.dataKey);
        if (req.body.title !== undefined) {
            finalTitle       = req.body.title;
            updates.title    = encrypt(req.body.title, req.dataKey);
        }

        const finalTargetAmount = updates.targetAmount ?? goal.targetAmount;
        const finalGoalType     = updates.goalType     ?? goal.goalType;
        updates.hmac = generateHMAC(goalHmacPayload(finalTitle, finalTargetAmount, finalGoalType), req.user._id);

        const updatedGoal = await Goal.findByIdAndUpdate(
            req.params.id, updates, { new: true, runValidators: true }
        );

        res.json({ success: true, data: decryptGoal(updatedGoal, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update goal error:', error);
        res.status(500).json({ success: false, message: 'Server error updating goal' });
    }
};

// DELETE /api/goals/:id
const deleteGoal = async (req, res) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        await Goal.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Goal deleted successfully' });
    } catch (error) {
        console.error('Delete goal error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting goal' });
    }
};

// POST /api/goals/:id/contribute
const addContribution = async (req, res) => {
    try {
        const { amount, note } = req.body;

        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        if (goal.status === 'Completed') {
            return res.status(400).json({ success: false, message: 'Cannot add contribution to completed goal' });
        }

        goal.contributions.push({ amount, note, date: new Date() });
        await goal.save();

        res.json({ success: true, data: decryptGoal(goal, req.user, req.dataKey), message: 'Contribution added successfully' });
    } catch (error) {
        console.error('Add contribution error:', error);
        res.status(500).json({ success: false, message: 'Server error adding contribution' });
    }
};

// GET /api/goals/:id/progress
const getGoalProgress = async (req, res) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        const plainTitle = safeDecrypt(goal.title, req.dataKey);

        res.json({
            success: true,
            data: {
                goalId:            goal._id,
                title:             plainTitle,
                targetAmount:      goal.targetAmount,
                currentAmount:     goal.currentAmount,
                remainingAmount:   goal.remainingAmount,
                progressPercentage: goal.progressPercentage,
                daysRemaining:     goal.daysRemaining,
                isOverdue:         goal.isOverdue,
                status:            goal.status,
                contributions:     goal.contributions.sort((a, b) => new Date(b.date) - new Date(a.date)),
                monthlyTarget:     goal.daysRemaining > 0 ? Math.ceil(goal.remainingAmount / (goal.daysRemaining / 30)) : 0
            }
        });
    } catch (error) {
        console.error('Get goal progress error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goal progress' });
    }
};

// GET /api/goals/reminders
const getGoalReminders = async (req, res) => {
    try {
        const goals = await Goal.find({ user: req.user._id, status: 'Active' });

        const reminders = [];
        for (const goal of goals) {
            const title            = safeDecrypt(goal.title, req.dataKey);
            const daysRemaining    = goal.daysRemaining;
            const progressPct      = goal.progressPercentage;
            const remainingAmount  = goal.remainingAmount;

            if (goal.isOverdue) {
                reminders.push({
                    type: 'overdue', severity: 'high',
                    goalId: goal._id, title,
                    message: `Your goal "${title}" is overdue. Consider adjusting the target date or increasing contributions.`
                });
            } else if (daysRemaining > 0 && progressPct < 50 && daysRemaining < 90) {
                const suggestedWeekly = Math.ceil(remainingAmount / (daysRemaining / 7));
                reminders.push({
                    type: 'behind_schedule', severity: 'medium',
                    goalId: goal._id, title,
                    message: `You're behind on "${title}". Consider adding ${suggestedWeekly} ${req.user.currency} weekly to stay on track.`
                });
            } else if (
                goal.contributions.length === 0 ||
                new Date() - new Date(goal.contributions[goal.contributions.length - 1].date) > 7 * 24 * 60 * 60 * 1000
            ) {
                const suggestedAmount = Math.ceil(remainingAmount / Math.max(1, daysRemaining / 30));
                reminders.push({
                    type: 'contribution_reminder', severity: 'low',
                    goalId: goal._id, title,
                    message: `Add ${suggestedAmount} ${req.user.currency} to "${title}" this month to stay on track.`
                });
            }
        }

        res.json({ success: true, data: reminders });
    } catch (error) {
        console.error('Get goal reminders error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goal reminders' });
    }
};

// GET /api/goals/dashboard
const getGoalsDashboard = async (req, res) => {
    try {
        const goals = await Goal.find({ user: req.user._id });

        const sorted = [...goals].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const dashboard = {
            totalGoals:        goals.length,
            activeGoals:       goals.filter(g => g.status === 'Active').length,
            completedGoals:    goals.filter(g => g.status === 'Completed').length,
            pausedGoals:       goals.filter(g => g.status === 'Paused').length,
            totalTargetAmount: goals.reduce((sum, g) => sum + g.targetAmount, 0),
            totalSavedAmount:  goals.reduce((sum, g) => sum + g.currentAmount, 0),
            overallProgress:   0,
            recentGoals:       sorted.slice(0, 5).map(g => decryptGoal(g, req.user, req.dataKey)),
            urgentGoals:       goals
                .filter(g => g.status === 'Active' && g.daysRemaining < 30 && g.daysRemaining > 0)
                .map(g => decryptGoal(g, req.user, req.dataKey))
        };

        if (dashboard.totalTargetAmount > 0) {
            dashboard.overallProgress = Math.round((dashboard.totalSavedAmount / dashboard.totalTargetAmount) * 100);
        }

        res.json({ success: true, data: dashboard });
    } catch (error) {
        console.error('Get goals dashboard error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goals dashboard' });
    }
};

module.exports = {
    createGoal, getGoals, getGoalById, updateGoal, deleteGoal,
    addContribution, getGoalProgress, getGoalReminders, getGoalsDashboard
};
