const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const { signRecord, verifyRecord } = require('../utils/signing');

function attestationPayload(b) {
    return { category: b.category, limit: b.limit, month: b.month, year: b.year };
}

// POST /api/budgets
const createBudget = async (req, res) => {
    try {
        const { category, limit, month, year, alertThreshold } = req.body;

        let budget = await Budget.findOne({ user: req.user._id, category, month, year });

        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0, 23, 59, 59);
        const spentResult = await Expense.aggregate([
            { $match: { user: req.user._id, category, date: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const spent = spentResult.length > 0 ? spentResult[0].total : 0;

        let isNew = false;
        if (budget) {
            budget.limit = limit;
            budget.spent = spent;
            if (alertThreshold) budget.alertThreshold = alertThreshold;
            // serverAttestation is not regenerated on update — see
            // docs/decisions/SEC-1-ecdsa.md
            await budget.save();
        } else {
            isNew = true;
            const serverAttestation = await signRecord(
                attestationPayload({ category, limit, month, year }), req.user, req.dataKey
            );
            budget = await Budget.create({
                user: req.user._id,
                category,
                limit,
                spent,
                month,
                year,
                alertThreshold: alertThreshold || 80,
                serverAttestation
            });
        }

        res.status(isNew ? 201 : 200).json({
            success: true,
            data: budget,
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

        const budgets = await Budget.find(query).sort({ category: 1 });

        for (const b of budgets) {
            if (b.serverAttestation && !(await verifyRecord(attestationPayload(b), b.serverAttestation, req.user))) {
                console.warn(`serverAttestation failed verification on budget ${b._id} (user ${req.user._id})`);
            }
        }

        res.json({ success: true, data: budgets });
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

        if (budget.serverAttestation && !(await verifyRecord(attestationPayload(budget), budget.serverAttestation, req.user))) {
            console.warn(`serverAttestation failed verification on budget ${budget._id} (user ${req.user._id})`);
        }

        res.json({ success: true, data: budget });
    } catch (error) {
        console.error('Get budget error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching budget' });
    }
};

// PUT /api/budgets/:id
const updateBudget = async (req, res) => {
    try {
        const updates = {};
        if (req.body.limit          !== undefined) updates.limit          = req.body.limit;
        if (req.body.alertThreshold !== undefined) updates.alertThreshold = req.body.alertThreshold;
        if (req.body.isActive       !== undefined) updates.isActive       = req.body.isActive;

        // serverAttestation is set on creation and NOT regenerated on update —
        // see docs/decisions/SEC-1-ecdsa.md.

        // Compound filter on the mutation prevents IDOR.
        const updatedBudget = await Budget.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new: true, runValidators: true }
        );
        if (!updatedBudget) return res.status(404).json({ success: false, message: 'Budget not found' });

        res.json({ success: true, data: updatedBudget });
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

        const trackingData = budgets.map(budget => ({
            _id:             budget._id,
            category:        budget.category,
            limit:           budget.limit,
            spent:           budget.spent,
            remaining:       budget.remainingAmount,
            usagePercentage: budget.usagePercentage,
            isOverLimit:     budget.isOverLimit,
            isNearLimit:     budget.isNearLimit,
            alertThreshold:  budget.alertThreshold
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

// GET /api/budgets/alerts
const getBudgetAlerts = async (req, res) => {
    try {
        const now          = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear  = now.getFullYear();

        const budgets = await Budget.find({
            user: req.user._id,
            month: currentMonth,
            year: currentYear,
            isActive: true
        });

        const alerts = [];
        budgets.forEach(budget => {
            if (budget.isOverLimit) {
                alerts.push({
                    type: 'over_limit', severity: 'high',
                    category: budget.category,
                    message: `You have exceeded your ${budget.category} budget by ${budget.spent - budget.limit}`,
                    budget
                });
            } else if (budget.isNearLimit) {
                alerts.push({
                    type: 'near_limit', severity: 'medium',
                    category: budget.category,
                    message: `You have used ${budget.usagePercentage}% of your ${budget.category} budget`,
                    budget
                });
            }
        });

        res.json({ success: true, data: alerts });
    } catch (error) {
        console.error('Get budget alerts error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching budget alerts' });
    }
};

// POST /api/budgets/reset
const resetBudgets = async (req, res) => {
    try {
        const { fromMonth, fromYear, toMonth, toYear } = req.body;

        const previousBudgets = await Budget.find({
            user: req.user._id, month: fromMonth, year: fromYear, isActive: true
        });

        const newBudgets = [];
        for (const budget of previousBudgets) {
            const existing = await Budget.findOne({
                user: req.user._id, category: budget.category, month: toMonth, year: toYear
            });
            if (!existing) {
                const payload           = attestationPayload({ category: budget.category, limit: budget.limit, month: toMonth, year: toYear });
                const serverAttestation = await signRecord(payload, req.user, req.dataKey);
                const newBudget = await Budget.create({
                    user: req.user._id,
                    category: budget.category,
                    limit: budget.limit,
                    spent: 0,
                    month: toMonth,
                    year: toYear,
                    alertThreshold: budget.alertThreshold,
                    serverAttestation
                });
                newBudgets.push(newBudget);
            }
        }

        res.json({
            success: true,
            data: newBudgets,
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
