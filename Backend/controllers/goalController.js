const Goal = require('../models/Goal');
const { encrypt, safeDecrypt } = require('../utils/encryption');
const { signRecord, verifyRecord, encryptNote, decryptNote } = require('../utils/signing');

async function decryptGoal(goal, user, dataKey) {
    const obj         = goal.toJSON ? goal.toJSON() : { ...goal };
    obj.title         = await safeDecrypt(goal.title,       dataKey);
    obj.description   = await safeDecrypt(goal.description, dataKey);
    obj.note          = goal.note ? await decryptNote(goal.note, user, dataKey) : null;
    return obj;
}

function goalAttestationPayload(title, targetAmount, goalType) {
    return { title, targetAmount, goalType };
}

// POST /api/goals
const createGoal = async (req, res) => {
    try {
        const { title, description, targetAmount, targetDate, goalType } = req.body;

        const serverAttestation = await signRecord(goalAttestationPayload(title, targetAmount, goalType), req.user, req.dataKey);
        const encTitle          = await encrypt(title, req.dataKey);
        const encDesc           = description ? (await encrypt(description, req.dataKey)) : undefined;
        const encNote           = req.body.note ? (await encryptNote(req.body.note, req.user)) : undefined;

        const goal = await Goal.create({
            user: req.user._id,
            title: encTitle,
            description: encDesc,
            targetAmount,
            targetDate,
            goalType,
            serverAttestation,
            note: encNote
        });

        res.status(201).json({ success: true, data: await decryptGoal(goal, req.user, req.dataKey) });
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

        const items = [];
        for (const g of goals) {
            const plainTitle = await safeDecrypt(g.title, req.dataKey);
            if (g.serverAttestation && !(await verifyRecord(goalAttestationPayload(plainTitle, g.targetAmount, g.goalType), g.serverAttestation, req.user))) {
                console.warn(`serverAttestation failed verification on goal ${g._id} (user ${req.user._id})`);
            }
            items.push(await decryptGoal(g, req.user, req.dataKey));
        }

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

        const plainTitle = await safeDecrypt(goal.title, req.dataKey);
        if (goal.serverAttestation && !(await verifyRecord(goalAttestationPayload(plainTitle, goal.targetAmount, goal.goalType), goal.serverAttestation, req.user))) {
            console.warn(`serverAttestation failed verification on goal ${goal._id} (user ${req.user._id})`);
        }

        res.json({ success: true, data: await decryptGoal(goal, req.user, req.dataKey) });
    } catch (error) {
        console.error('Get goal error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goal' });
    }
};

// PUT /api/goals/:id
const updateGoal = async (req, res) => {
    try {
        const updates = {};
        if (req.body.description  !== undefined) updates.description  = await encrypt(req.body.description, req.dataKey);
        if (req.body.note         !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : (await encryptNote(req.body.note, req.user));
        }
        if (req.body.targetAmount !== undefined) updates.targetAmount = req.body.targetAmount;
        if (req.body.targetDate   !== undefined) updates.targetDate   = req.body.targetDate;
        if (req.body.goalType     !== undefined) updates.goalType     = req.body.goalType;
        if (req.body.status       !== undefined) updates.status       = req.body.status;
        if (req.body.title        !== undefined) updates.title        = await encrypt(req.body.title, req.dataKey);

        // serverAttestation is set on creation and NOT regenerated on update —
        // see docs/decisions/SEC-1-ecdsa.md.

        // Compound filter on the mutation prevents IDOR.
        const updatedGoal = await Goal.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new: true, runValidators: true }
        );
        if (!updatedGoal) return res.status(404).json({ success: false, message: 'Goal not found' });

        res.json({ success: true, data: await decryptGoal(updatedGoal, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update goal error:', error);
        res.status(500).json({ success: false, message: 'Server error updating goal' });
    }
};

// DELETE /api/goals/:id
const deleteGoal = async (req, res) => {
    try {
        const deleted = await Goal.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Goal not found' });

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

        res.json({ success: true, data: await decryptGoal(goal, req.user, req.dataKey), message: 'Contribution added successfully' });
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

        const plainTitle = await safeDecrypt(goal.title, req.dataKey);

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
            const title            = await safeDecrypt(goal.title, req.dataKey);
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

        const recentGoals = [];
        for (const g of sorted.slice(0, 5)) {
            recentGoals.push(await decryptGoal(g, req.user, req.dataKey));
        }

        const urgentGoalsRaw = goals.filter(g => g.status === 'Active' && g.daysRemaining < 30 && g.daysRemaining > 0);
        const urgentGoals = [];
        for (const g of urgentGoalsRaw) {
            urgentGoals.push(await decryptGoal(g, req.user, req.dataKey));
        }

        const dashboard = {
            totalGoals:        goals.length,
            activeGoals:       goals.filter(g => g.status === 'Active').length,
            completedGoals:    goals.filter(g => g.status === 'Completed').length,
            pausedGoals:       goals.filter(g => g.status === 'Paused').length,
            totalTargetAmount: goals.reduce((sum, g) => sum + g.targetAmount, 0),
            totalSavedAmount:  goals.reduce((sum, g) => sum + g.currentAmount, 0),
            overallProgress:   0,
            recentGoals,
            urgentGoals
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
