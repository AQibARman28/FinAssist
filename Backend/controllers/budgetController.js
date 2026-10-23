const Budget = require('../models/Budget');
const Category = require('../models/Category');
const { signRecord } = require('../utils/signing');
const { checkRecords, flag } = require('../utils/integrity');
const { logAudit } = require('../utils/audit');
const { assertCategoryOwnedAndTyped } = require('../utils/categoryGuard');
const { withSpent, isObjectIdValue } = require('../services/budgetSpend');

// G1: Budget.category is the user's Category ObjectId (same id as
// Expense.category). `spent` and the derived figures (remaining,
// usagePercentage, isOverLimit, isNearLimit) are computed on read by
// services/budgetSpend.withSpent — nothing is stored, so nothing drifts.

// Payload shapes (including the legacy name-signed fallback for rows migrated
// from the String-enum era) live in utils/attestationPayloads.js.
const { budget: attestationPayload, budgetCandidates } = require('../utils/attestationPayloads');

const checkBudgets = (req, budgets) => checkRecords(req, 'budget', budgets, budgetCandidates);

const signBudget = (b, req) => signRecord(attestationPayload(b), req.user, req.dataKey);

const byPeriodThenName = (a, b) =>
    (b.year - a.year) || (b.month - a.month) || a.categoryName.localeCompare(b.categoryName);

// POST /api/budgets — create, or update the existing (category, month, year) slot.
const createBudget = async (req, res) => {
    try {
        const { category, limit, month, year, alertThreshold } = req.body;

        const guard = await assertCategoryOwnedAndTyped(req.user._id, category, 'expense');
        if (!guard.ok) {
            return res.status(guard.status).json({ success: false, message: guard.message });
        }
        const categoryId = guard.category._id;
        const slot = { user: req.user._id, category: categoryId, month, year };

        let budget = await Budget.findOne(slot);
        let isNew = false;
        if (!budget) {
            try {
                const serverAttestation = await signRecord(
                    attestationPayload({ category: categoryId, limit, month, year }), req.user, req.dataKey
                );
                budget = await Budget.create({ ...slot, limit, alertThreshold: alertThreshold ?? 80, serverAttestation });
                isNew = true;
            } catch (err) {
                // A parallel create won the unique {user, category, month, year}
                // slot — fall through and update that row instead.
                if (err?.code !== 11000) throw err;
                budget = await Budget.findOne(slot);
            }
        }
        if (!isNew) {
            budget.limit = limit;
            if (alertThreshold !== undefined) budget.alertThreshold = alertThreshold;
            budget.isActive = true;
            // Re-signed so an edit made in the app never reads as tampering.
            budget.serverAttestation = await signBudget(budget, req);
            budget.legacyCategory = undefined;
            await budget.save();
        }

        logAudit(req, isNew ? 'budget.create' : 'budget.update', req.user._id, { budgetId: budget._id.toString(), limit });
        const [row] = await withSpent(req.user._id, [budget]);
        res.status(isNew ? 201 : 200).json({
            success: true,
            data: row,
            message: isNew ? 'Budget created' : 'Budget updated'
        });
    } catch (error) {
        console.error('Create budget error:', error);
        res.status(500).json({ success: false, message: 'Server error creating budget' });
    }
};

// GET /api/budgets
const getBudgets = async (req, res) => {
    try {
        const { month, year, category } = req.query;

        const query = { user: req.user._id };
        if (month)    query.month    = parseInt(month);
        if (year)     query.year     = parseInt(year);
        if (category) query.category = category;

        const budgets = await Budget.find(query);
        const issues = await checkBudgets(req, budgets);

        const rows = (await withSpent(req.user._id, budgets)).sort(byPeriodThenName).map((r) => flag(r, issues));
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Get budgets error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching budgets' });
    }
};

// GET /api/budgets/:id
const getBudgetById = async (req, res) => {
    try {
        const budget = await Budget.findOne({ _id: req.params.id, user: req.user._id });
        if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });

        const issues = await checkBudgets(req, [budget]);

        const [row] = await withSpent(req.user._id, [budget]);
        res.json({ success: true, data: flag(row, issues) });
    } catch (error) {
        console.error('Get budget error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching budget' });
    }
};

// PUT /api/budgets/:id
const updateBudget = async (req, res) => {
    try {
        // Compound filter prevents IDOR.
        const current = await Budget.findOne({ _id: req.params.id, user: req.user._id });
        if (!current) return res.status(404).json({ success: false, message: 'Budget not found' });

        const updates = {};
        if (req.body.limit          !== undefined) updates.limit          = req.body.limit;
        if (req.body.alertThreshold !== undefined) updates.alertThreshold = req.body.alertThreshold;
        if (req.body.isActive       !== undefined) updates.isActive       = req.body.isActive;

        // Re-sign over the values the budget will hold after this update
        // (supersedes the create-only rule in docs/decisions/SEC-1-ecdsa.md).
        updates.serverAttestation = await signBudget({ category: current.category, limit: updates.limit ?? current.limit, month: current.month, year: current.year }, req);

        const updatedBudget = await Budget.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { $set: updates, $unset: { legacyCategory: 1 } },
            { new: true, runValidators: true }
        );
        if (!updatedBudget) return res.status(404).json({ success: false, message: 'Budget not found' });

        logAudit(req, 'budget.update', req.user._id, { budgetId: updatedBudget._id.toString(), fields: Object.keys(updates).filter((k) => k !== 'serverAttestation') });
        const [row] = await withSpent(req.user._id, [updatedBudget]);
        res.json({ success: true, data: row });
    } catch (error) {
        console.error('Update budget error:', error);
        res.status(500).json({ success: false, message: 'Server error updating budget' });
    }
};

// DELETE /api/budgets/:id
const deleteBudget = async (req, res) => {
    try {
        const deleted = await Budget.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Budget not found' });

        logAudit(req, 'budget.delete', req.user._id, { budgetId: deleted._id.toString() });
        res.json({ success: true, message: 'Budget deleted successfully' });
    } catch (error) {
        console.error('Delete budget error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting budget' });
    }
};

// GET /api/budgets/tracking/:year/:month
const getBudgetTracking = async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        const budgets = await Budget.find({ user: req.user._id, month, year, isActive: true });
        const trackingData = (await withSpent(req.user._id, budgets))
            .sort(byPeriodThenName)
            .map((b) => ({
                _id:              b._id,
                category:         b.category,
                categoryName:     b.categoryName,
                categoryColor:    b.categoryColor,
                categoryIcon:     b.categoryIcon,
                categoryArchived: b.categoryArchived,
                limit:            b.limit,
                spent:            b.spent,
                remaining:        b.remaining,
                usagePercentage:  b.usagePercentage,
                isOverLimit:      b.isOverLimit,
                isNearLimit:      b.isNearLimit,
                alertThreshold:   b.alertThreshold,
                month:            b.month,
                year:             b.year,
                isActive:         b.isActive,
            }));

        res.json({
            success: true,
            data: {
                month,
                year,
                budgets: trackingData,
                alerts: trackingData.filter(b => b.isNearLimit || b.isOverLimit)
            }
        });
    } catch (error) {
        console.error('Get budget tracking error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching budget tracking' });
    }
};

// GET /api/budgets/alerts — the current (UTC) month, live spend.
const getBudgetAlerts = async (req, res) => {
    try {
        const now          = new Date();
        const currentMonth = now.getUTCMonth() + 1;
        const currentYear  = now.getUTCFullYear();

        const budgets = await Budget.find({
            user: req.user._id,
            month: currentMonth,
            year: currentYear,
            isActive: true
        });

        const alerts = [];
        for (const budget of await withSpent(req.user._id, budgets)) {
            const name = budget.categoryName;
            if (budget.isOverLimit) {
                alerts.push({
                    type: 'over_limit', severity: 'high',
                    category: name, categoryId: budget.category,
                    message: `You have exceeded your ${name} budget by ${budget.spent - budget.limit}`,
                    budget
                });
            } else if (budget.isNearLimit) {
                alerts.push({
                    type: 'near_limit', severity: 'medium',
                    category: name, categoryId: budget.category,
                    message: `You have used ${budget.usagePercentage}% of your ${name} budget`,
                    budget
                });
            }
        }

        res.json({ success: true, data: alerts });
    } catch (error) {
        console.error('Get budget alerts error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching budget alerts' });
    }
};

// POST /api/budgets/reset — copy one month's active budgets into another.
// Skips slots that already exist and categories that are gone or archived.
const resetBudgets = async (req, res) => {
    try {
        const { fromMonth, fromYear, toMonth, toYear } = req.body;

        const previousBudgets = (await Budget.find({
            user: req.user._id, month: fromMonth, year: fromYear, isActive: true
        })).filter((b) => isObjectIdValue(b.category));

        const liveCats = await Category.find({
            user: req.user._id,
            _id: { $in: previousBudgets.map((b) => b.category) },
            isArchived: { $ne: true },
            type: { $in: ['expense', 'both'] },
        }).select('_id').lean();
        const live = new Set(liveCats.map((c) => c._id.toHexString()));

        const newBudgets = [];
        for (const budget of previousBudgets) {
            if (!live.has(budget.category.toHexString())) continue;
            const slot = { user: req.user._id, category: budget.category, month: toMonth, year: toYear };
            if (await Budget.exists(slot)) continue;

            const payload           = attestationPayload({ category: budget.category, limit: budget.limit, month: toMonth, year: toYear });
            const serverAttestation = await signRecord(payload, req.user, req.dataKey);
            try {
                newBudgets.push(await Budget.create({
                    ...slot,
                    limit: budget.limit,
                    alertThreshold: budget.alertThreshold,
                    serverAttestation
                }));
            } catch (err) {
                if (err?.code !== 11000) throw err; // created concurrently — fine
            }
        }

        logAudit(req, 'budget.reset', req.user._id, { fromMonth, fromYear, toMonth, toYear, created: newBudgets.length });
        res.json({
            success: true,
            data: await withSpent(req.user._id, newBudgets),
            message: `Created ${newBudgets.length} budgets for ${toMonth}/${toYear}`
        });
    } catch (error) {
        console.error('Reset budgets error:', error);
        res.status(500).json({ success: false, message: 'Server error resetting budgets' });
    }
};

module.exports = {
    createBudget, getBudgets, getBudgetById, updateBudget, deleteBudget,
    getBudgetTracking, getBudgetAlerts, resetBudgets
};
