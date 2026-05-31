const Goal = require('../models/Goal');
const { encrypt, safeDecrypt } = require('../utils/encryption');
const { signRecord, verifyRecord, encryptNote, decryptNote } = require('../utils/signing');
const { getCashFlow } = require('../services/cashFlow');
const { planGoals, allocateSurplus } = require('../services/goalPlanning');
const { getBalance } = require('../services/balance');
const SavingsEntry = require('../models/SavingsEntry');
const { logAudit } = require('../utils/audit');

// End-of-period date used as a display/forecast targetDate when the user
// doesn't supply one (the period-based UI doesn't ask for a deadline).
function endOfPeriod(period, now = new Date()) {
    return period === 'yearly'
        ? new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
}

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
        const period      = req.body.period || 'monthly';
        const resolvedType = goalType || 'Other';

        const serverAttestation = await signRecord(goalAttestationPayload(title, targetAmount, resolvedType), req.user, req.dataKey);
        const encTitle          = await encrypt(title, req.dataKey);
        const encDesc           = description ? (await encrypt(description, req.dataKey)) : undefined;
        const encNote           = req.body.note ? (await encryptNote(req.body.note, req.user)) : undefined;

        const goal = await Goal.create({
            user: req.user._id,
            title: encTitle,
            description: encDesc,
            targetAmount,
            period,
            targetDate: targetDate || endOfPeriod(period),
            goalType: resolvedType,
            priority: req.body.priority ?? 0,
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
        const { status, goalType, period } = req.query;

        const query = { user: req.user._id };
        if (status)   query.status   = status;
        if (goalType) query.goalType = goalType;

        let goals = await Goal.find(query).sort({ createdAt: -1 });
        // Split by period in JS so pre-existing goals (no `period`) count as
        // 'monthly'. Volumes are tiny (personal finance), so no index needed.
        if (period) goals = goals.filter((g) => (g.period || 'monthly') === period);

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
        if (req.body.priority     !== undefined) updates.priority     = req.body.priority;
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

        // Hard cap: you can't save more than your available wallet (cumulative
        // income − expenses − goal contributions − standalone savings).
        const allGoals = await Goal.find({ user: req.user._id });
        const savingsEntries = await SavingsEntry.find({ user: req.user._id });
        const { available } = await getBalance(req.user._id, allGoals, savingsEntries);
        if (amount > available) {
            return res.status(400).json({
                success: false,
                message: `Only ${Math.max(0, Math.round(available))} ${req.user.currency} is available to save right now.`,
            });
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

// GET /api/goals/plan
//
// Cash-flow-aware feasibility + forecast across active goals (GOAL-1). Surplus
// comes from the shared cash-flow service; the per-goal/portfolio math is the
// pure goalPlanning service. Read-only — records nothing.
const getGoalPlan = async (req, res) => {
    try {
        const userId = req.user._id;
        const cash = await getCashFlow(userId, 90);
        const goals = await Goal.find({ user: userId, status: 'Active' });

        const inputs = [];
        const titles = {};
        for (const g of goals) {
            const id = g._id.toString();
            titles[id] = await safeDecrypt(g.title, req.dataKey);
            inputs.push({
                id,
                targetAmount:  g.targetAmount,
                currentAmount: g.currentAmount,
                targetDate:    g.targetDate,
                contributions: g.contributions.map((c) => ({ amount: c.amount, date: c.date })),
            });
        }

        const plan = planGoals({ goals: inputs, monthlySurplus: cash.monthlySurplus, now: Date.now(), windowDays: 90 });
        const byId = new Map(goals.map((g) => [g._id.toString(), g]));
        const goalsOut = plan.goals.map((p) => {
            const g = byId.get(p.goalId);
            return {
                ...p,
                title:         titles[p.goalId],
                goalType:      g.goalType,
                priority:      g.priority ?? 0,
                targetAmount:  g.targetAmount,
                currentAmount: g.currentAmount,
                targetDate:    g.targetDate,
            };
        });

        res.json({ success: true, data: { cashFlow: cash, goals: goalsOut, portfolio: plan.portfolio } });
    } catch (error) {
        console.error('Goal plan error:', error);
        res.status(500).json({ success: false, message: 'Server error computing goal plan' });
    }
};

// GET /api/goals/allocation-suggestion
//
// Recommend-and-confirm: proposes how to deploy this period's surplus across
// active goals. READ-ONLY — records nothing. Allocations are tracked
// intentions, not bank transfers.
const getAllocationSuggestion = async (req, res) => {
    try {
        const userId = req.user._id;
        const cash = await getCashFlow(userId, 90);
        const goals = await Goal.find({ user: userId, status: 'Active' });

        const inputs = [];
        const meta = {};
        for (const g of goals) {
            const id = g._id.toString();
            meta[id] = { title: await safeDecrypt(g.title, req.dataKey), goalType: g.goalType, targetAmount: g.targetAmount, currentAmount: g.currentAmount, targetDate: g.targetDate, priority: g.priority ?? 0 };
            inputs.push({ id, targetAmount: g.targetAmount, currentAmount: g.currentAmount, targetDate: g.targetDate, goalType: g.goalType, priority: g.priority ?? 0 });
        }

        const result = allocateSurplus({
            goals: inputs,
            monthlySurplus: cash.monthlySurplus,
            monthlyAvgExpenses: cash.monthlyAvgExpenses,
            now: Date.now(),
        });

        const suggestedById = new Map(result.allocations.map((a) => [a.goalId, a.suggested]));
        const goalsOut = inputs.map((g) => ({ goalId: g.id, ...meta[g.id], suggested: suggestedById.get(g.id) ?? 0 }));

        res.json({
            success: true,
            data: {
                cashFlow: cash,
                emergencyBaseline: result.emergencyBaseline,
                freeSurplus: result.freeSurplus,
                overcommitted: result.overcommitted,
                tradeoffs: result.tradeoffs,
                goals: goalsOut,
            },
        });
    } catch (error) {
        console.error('Allocation suggestion error:', error);
        res.status(500).json({ success: false, message: 'Server error computing allocation suggestion' });
    }
};

// POST /api/goals/allocate
//
// Records the user's CONFIRMED allocation as a contribution per goal — same
// path as addContribution (find → reject Completed → push → save; pre-save
// recomputes currentAmount). IDOR-checked per goal; over-surplus warns, never
// blocks (user may fund from existing savings). Tracked intentions only.
const allocateContributions = async (req, res) => {
    try {
        const userId = req.user._id;
        const { allocations, date, note } = req.body;

        // Validate ALL goals up front so we record nothing on a bad request.
        const targets = [];
        for (const a of allocations) {
            const goal = await Goal.findOne({ _id: a.goalId, user: userId });
            if (!goal) return res.status(404).json({ success: false, message: `Goal ${a.goalId} not found` });
            if (goal.status === 'Completed') {
                return res.status(400).json({ success: false, message: 'Cannot allocate to a completed goal' });
            }
            targets.push({ goal, amount: a.amount });
        }

        // Hard cap: the total saved can't exceed the available balance (the
        // single continuous pocket = cumulative income − expenses − saved).
        const allGoals = await Goal.find({ user: userId });
        const savingsEntries = await SavingsEntry.find({ user: userId });
        const { available } = await getBalance(userId, allGoals, savingsEntries);
        const requestedTotal = targets.reduce((s, t) => s + t.amount, 0);
        if (requestedTotal > available) {
            return res.status(400).json({
                success: false,
                message: `Allocation exceeds your available balance (${Math.max(0, Math.round(available))} ${req.user.currency}).`,
            });
        }

        const when = date ? new Date(date) : new Date();
        const updated = [];
        for (const { goal, amount } of targets) {
            goal.contributions.push({ amount, note: note || 'Surplus allocation', date: when });
            await goal.save();
            updated.push(await decryptGoal(goal, req.user, req.dataKey));
        }

        const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
        logAudit(req, 'goal.allocate', userId, { goals: allocations.length, total: totalAllocated });

        res.json({ success: true, data: updated, message: 'Allocation recorded' });
    } catch (error) {
        console.error('Allocate error:', error);
        res.status(500).json({ success: false, message: 'Server error recording allocation' });
    }
};

module.exports = {
    createGoal, getGoals, getGoalById, updateGoal, deleteGoal,
    addContribution, getGoalProgress, getGoalReminders, getGoalsDashboard,
    getGoalPlan, getAllocationSuggestion, allocateContributions,
};
