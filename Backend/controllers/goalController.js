const Goal = require('../models/Goal');
const { FIELDS, sealField, openField } = require('../utils/encryption');
const { signRecord, encryptNote, decryptNote } = require('../utils/signing');
const { checkRecords, flag } = require('../utils/integrity');
const { getCashFlow } = require('../services/cashFlow');
const { planGoals, allocateSurplus } = require('../services/goalPlanning');
const { getBalance, releasableAmount } = require('../services/balance');
const { withWalletLock, WalletBusyError } = require('../services/walletLock');
const SavingsEntry = require('../models/SavingsEntry');
const { logAudit } = require('../utils/audit');

// G3: deleted goals are archived (deletedAt set), never removed, so the
// balance history stays intact. Every goal VIEW / mutation is scoped to live
// goals; only the balance computations (getBalance) see archived ones.
const LIVE = { deletedAt: null };

// G4: contributions/allocations are capped at the wallet balance; the check
// and the write run inside the user's wallet lock.
const busy = (res, err) => res.status(409).json({ success: false, code: err.code, message: err.message });

async function availableBalance(userId) {
    const [allGoals, savingsEntries] = await Promise.all([
        Goal.find({ user: userId }),            // incl. archived — their history counts
        SavingsEntry.find({ user: userId }),
    ]);
    return (await getBalance(userId, allGoals, savingsEntries)).available;
}

// End-of-period date used as a display/forecast targetDate when the user
// doesn't supply one (the period-based UI doesn't ask for a deadline).
function endOfPeriod(period, now = new Date()) {
    return period === 'yearly'
        ? new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
}

const openTitle = (goal, user, dataKey) => openField(goal.title, dataKey, FIELDS.goalTitle, user._id);

async function decryptGoal(goal, user, dataKey) {
    const obj         = goal.toJSON ? goal.toJSON() : { ...goal };
    obj.title         = await openTitle(goal, user, dataKey);
    obj.description   = await openField(goal.description, dataKey, FIELDS.goalDescription, user._id);
    obj.note          = goal.note ? await decryptNote(goal.note, user, dataKey, FIELDS.goalNote) : null;
    return obj;
}

const { goal: goalAttestationPayload } = require('../utils/attestationPayloads');

// The attestation covers the decrypted title, so decrypt titles once and
// check every goal against them.
async function checkGoals(req, goals) {
    const titles = new Map();
    for (const g of goals) titles.set(String(g._id), await openTitle(g, req.user, req.dataKey));
    return checkRecords(req, 'goal', goals, (g) => goalAttestationPayload(titles.get(String(g._id)), g.targetAmount, g.goalType));
}

// POST /api/goals
const createGoal = async (req, res) => {
    try {
        const { title, description, targetAmount, targetDate, goalType } = req.body;
        const period      = req.body.period || 'monthly';
        const resolvedType = goalType || 'Other';

        const serverAttestation = await signRecord(goalAttestationPayload(title, targetAmount, resolvedType), req.user, req.dataKey);
        const encTitle          = await sealField(title, req.dataKey, FIELDS.goalTitle, req.user._id);
        const encDesc           = description ? (await sealField(description, req.dataKey, FIELDS.goalDescription, req.user._id)) : undefined;
        const encNote           = req.body.note ? (await encryptNote(req.body.note, req.user, req.dataKey, FIELDS.goalNote)) : undefined;

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

        logAudit(req, 'goal.create', req.user._id, { goalId: goal._id.toString(), targetAmount });
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

        const query = { user: req.user._id, ...LIVE };
        if (status)   query.status   = status;
        if (goalType) query.goalType = goalType;

        let goals = await Goal.find(query).sort({ createdAt: -1 });
        // Split by period in JS so pre-existing goals (no `period`) count as
        // 'monthly'. Volumes are tiny (personal finance), so no index needed.
        if (period) goals = goals.filter((g) => (g.period || 'monthly') === period);

        const issues = await checkGoals(req, goals);
        const items = [];
        for (const g of goals) items.push(flag(await decryptGoal(g, req.user, req.dataKey), issues));

        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Get goals error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goals' });
    }
};

// GET /api/goals/:id
const getGoalById = async (req, res) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id, ...LIVE });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        const issues = await checkGoals(req, [goal]);
        res.json({ success: true, data: flag(await decryptGoal(goal, req.user, req.dataKey), issues) });
    } catch (error) {
        console.error('Get goal error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching goal' });
    }
};

// PUT /api/goals/:id
const updateGoal = async (req, res) => {
    try {
        // Compound filter prevents IDOR.
        const current = await Goal.findOne({ _id: req.params.id, user: req.user._id, ...LIVE });
        if (!current) return res.status(404).json({ success: false, message: 'Goal not found' });

        const updates = {};
        if (req.body.description  !== undefined) updates.description  = await sealField(req.body.description, req.dataKey, FIELDS.goalDescription, req.user._id);
        if (req.body.note         !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : (await encryptNote(req.body.note, req.user, req.dataKey, FIELDS.goalNote));
        }
        if (req.body.targetAmount !== undefined) updates.targetAmount = req.body.targetAmount;
        if (req.body.targetDate   !== undefined) updates.targetDate   = req.body.targetDate;
        if (req.body.goalType     !== undefined) updates.goalType     = req.body.goalType;
        if (req.body.status       !== undefined) updates.status       = req.body.status;
        if (req.body.priority     !== undefined) updates.priority     = req.body.priority;
        if (req.body.title        !== undefined) updates.title        = await sealField(req.body.title, req.dataKey, FIELDS.goalTitle, req.user._id);

        // Re-sign over the values the goal will hold after this update
        // (supersedes the create-only rule in docs/decisions/SEC-1-ecdsa.md).
        const title = req.body.title !== undefined ? req.body.title : await openTitle(current, req.user, req.dataKey);
        updates.serverAttestation = await signRecord(
            goalAttestationPayload(title, updates.targetAmount ?? current.targetAmount, updates.goalType ?? current.goalType),
            req.user, req.dataKey,
        );

        const updatedGoal = await Goal.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, ...LIVE },
            updates,
            { new: true, runValidators: true }
        );
        if (!updatedGoal) return res.status(404).json({ success: false, message: 'Goal not found' });

        logAudit(req, 'goal.update', req.user._id, { goalId: updatedGoal._id.toString(), fields: Object.keys(updates).filter((k) => k !== 'serverAttestation') });
        res.json({ success: true, data: await decryptGoal(updatedGoal, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update goal error:', error);
        res.status(500).json({ success: false, message: 'Server error updating goal' });
    }
};

// DELETE /api/goals/:id
//
// G3: archive, don't remove. The contributions stay so every past month's
// closing balance is unchanged; the money still set aside (releasedAmount)
// returns to the wallet as of now. Runs under the wallet lock so a
// concurrent contribution can't land on the goal after the release is fixed.
const deleteGoal = async (req, res) => {
    try {
        const userId = req.user._id;
        const released = await withWalletLock(userId, async () => {
            const goal = await Goal.findOne({ _id: req.params.id, user: userId, ...LIVE });
            if (!goal) return null;
            const at = new Date();
            const amount = releasableAmount(goal, at);
            const archived = await Goal.findOneAndUpdate(
                { _id: goal._id, user: userId, ...LIVE },
                { $set: { deletedAt: at, releasedAmount: amount } },
            );
            return archived ? amount : null;
        });
        if (released === null) return res.status(404).json({ success: false, message: 'Goal not found' });

        logAudit(req, 'goal.delete', userId, { goalId: req.params.id, released });
        res.json({
            success: true,
            data: { released },
            message: released > 0 ? 'Goal deleted — its saved amount is back in your wallet' : 'Goal deleted successfully',
        });
    } catch (error) {
        if (error instanceof WalletBusyError) return busy(res, error);
        console.error('Delete goal error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting goal' });
    }
};

// POST /api/goals/:id/contribute
const addContribution = async (req, res) => {
    try {
        const { amount, note } = req.body;
        const userId = req.user._id;

        const outcome = await withWalletLock(userId, async () => {
            const goal = await Goal.findOne({ _id: req.params.id, user: userId, ...LIVE });
            if (!goal) return { status: 404, message: 'Goal not found' };

            if (goal.status === 'Completed') {
                return { status: 400, message: 'Cannot add contribution to completed goal' };
            }

            // Hard cap: you can't save more than your available wallet (cumulative
            // income − expenses − goal contributions − standalone savings).
            const available = await availableBalance(userId);
            if (amount > available) {
                return { status: 400, message: `Only ${Math.max(0, Math.round(available))} ${req.user.currency} is available to save right now.` };
            }

            goal.contributions.push({ amount, note, date: new Date() });
            await goal.save();
            return { goal };
        });
        if (!outcome.goal) return res.status(outcome.status).json({ success: false, message: outcome.message });

        logAudit(req, 'goal.contribute', userId, { goalId: outcome.goal._id.toString(), amount });
        res.json({ success: true, data: await decryptGoal(outcome.goal, req.user, req.dataKey), message: 'Contribution added successfully' });
    } catch (error) {
        if (error instanceof WalletBusyError) return busy(res, error);
        console.error('Add contribution error:', error);
        res.status(500).json({ success: false, message: 'Server error adding contribution' });
    }
};

// GET /api/goals/:id/progress
const getGoalProgress = async (req, res) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.id, user: req.user._id, ...LIVE });
        if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

        const plainTitle = await openTitle(goal, req.user, req.dataKey);

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
        const goals = await Goal.find({ user: req.user._id, status: 'Active', ...LIVE });

        const reminders = [];
        for (const goal of goals) {
            const title            = await openTitle(goal, req.user, req.dataKey);
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
        const goals = await Goal.find({ user: req.user._id, ...LIVE });

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
        const goals = await Goal.find({ user: userId, status: 'Active', ...LIVE });

        const inputs = [];
        const titles = {};
        for (const g of goals) {
            const id = g._id.toString();
            titles[id] = await openTitle(g, req.user, req.dataKey);
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
        const goals = await Goal.find({ user: userId, status: 'Active', ...LIVE });

        const inputs = [];
        const meta = {};
        for (const g of goals) {
            const id = g._id.toString();
            meta[id] = { title: await openTitle(g, req.user, req.dataKey), goalType: g.goalType, targetAmount: g.targetAmount, currentAmount: g.currentAmount, targetDate: g.targetDate, priority: g.priority ?? 0 };
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
// recomputes currentAmount). IDOR-checked per goal; hard-capped at the wallet
// balance. Tracked intentions only. The whole validate → cap → record runs
// inside the user's wallet lock (G4).
const allocateContributions = async (req, res) => {
    try {
        const userId = req.user._id;
        const { allocations, note } = req.body;

        // The same goal listed twice is one contribution of the summed amount
        // (two saves of separately-loaded copies would corrupt currentAmount).
        const perGoal = new Map();
        for (const a of allocations) perGoal.set(a.goalId, (perGoal.get(a.goalId) || 0) + a.amount);

        const outcome = await withWalletLock(userId, async () => {
            // Validate ALL goals up front so we record nothing on a bad request.
            const targets = [];
            for (const [goalId, amount] of perGoal) {
                const goal = await Goal.findOne({ _id: goalId, user: userId, ...LIVE });
                if (!goal) return { status: 404, message: `Goal ${goalId} not found` };
                if (goal.status === 'Completed') {
                    return { status: 400, message: 'Cannot allocate to a completed goal' };
                }
                targets.push({ goal, amount });
            }

            // Hard cap: the total saved can't exceed the available balance (the
            // single continuous pocket = cumulative income − expenses − saved).
            const available = await availableBalance(userId);
            const requestedTotal = targets.reduce((s, t) => s + t.amount, 0);
            if (requestedTotal > available) {
                return { status: 400, message: `Allocation exceeds your available balance (${Math.max(0, Math.round(available))} ${req.user.currency}).` };
            }

            const when = new Date();   // never client-chosen: no backdating into closed months
            for (const { goal, amount } of targets) {
                goal.contributions.push({ amount, note: note || 'Surplus allocation', date: when });
                await goal.save();
            }
            return { goals: targets.map((t) => t.goal) };
        });
        if (!outcome.goals) return res.status(outcome.status).json({ success: false, message: outcome.message });

        const updated = [];
        for (const goal of outcome.goals) updated.push(await decryptGoal(goal, req.user, req.dataKey));

        const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
        logAudit(req, 'goal.allocate', userId, { goals: perGoal.size, total: totalAllocated });

        res.json({ success: true, data: updated, message: 'Allocation recorded' });
    } catch (error) {
        if (error instanceof WalletBusyError) return busy(res, error);
        console.error('Allocate error:', error);
        res.status(500).json({ success: false, message: 'Server error recording allocation' });
    }
};

module.exports = {
    createGoal, getGoals, getGoalById, updateGoal, deleteGoal,
    addContribution, getGoalProgress, getGoalReminders, getGoalsDashboard,
    getGoalPlan, getAllocationSuggestion, allocateContributions,
};
