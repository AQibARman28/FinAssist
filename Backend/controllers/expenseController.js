const Expense = require('../models/Expense');
const { FIELDS, sealField, openField } = require('../utils/encryption');
const { signRecord, encryptNote, decryptNote } = require('../utils/signing');
const { checkRecords, flag } = require('../utils/integrity');
const { logAudit } = require('../utils/audit');
const { assertCategoryOwnedAndTyped } = require('../utils/categoryGuard');
const { materializeRecurring } = require('../utils/recurring');

// The plaintext fields the ECDSA attestation covers.
const { expense: attestationPayload } = require('../utils/attestationPayloads');

// Default materialization window when the client doesn't pass a date filter.
function _defaultWindow() {
    const now = new Date();
    const y   = now.getUTCFullYear();
    const m   = now.getUTCMonth();
    return {
        from: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        to:   new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
    };
}

// Part 3 removed the auto-categorization keyword dictionary and the
// `isAutoCategories` Expense field. Categorization is now an explicit user
// choice — the client picks a Category by id, and categoryGuard verifies
// the row exists, belongs to the user, isn't archived, and has type
// 'expense' or 'both' before insert.

async function decryptExpense(expense, user, dataKey) {
    const obj = expense.toObject ? expense.toObject({ virtuals: true }) : { ...expense };
    obj.description = await openField(expense.description, dataKey, FIELDS.expenseDescription, user._id);
    obj.note = expense.note ? await decryptNote(expense.note, user, dataKey, FIELDS.expenseNote) : null;
    return obj;
}

// POST /api/expenses
const createExpense = async (req, res) => {
    try {
        const { amount, category, description, date } = req.body;

        const guard = await assertCategoryOwnedAndTyped(req.user._id, category, 'expense');
        if (!guard.ok) {
            return res.status(guard.status).json({ success: false, message: guard.message });
        }

        const expDate           = date ? new Date(date) : new Date();
        const encDesc           = description ? (await sealField(description, req.dataKey, FIELDS.expenseDescription, req.user._id)) : undefined;
        const serverAttestation = await signRecord({ amount, category }, req.user, req.dataKey);
        const encNote           = req.body.note ? (await encryptNote(req.body.note, req.user, req.dataKey, FIELDS.expenseNote)) : undefined;

        const expense = await Expense.create({
            user:        req.user._id,
            amount,
            category,
            description: encDesc,
            date:        expDate,
            serverAttestation,
            note:        encNote,
        });

        // Budget spend is computed on read (services/budgetSpend.js) — no
        // stored Budget.spent to keep in sync here.

        logAudit(req, 'expense.create', req.user._id, { expenseId: expense._id.toString(), amount });
        res.status(201).json({ success: true, data: await decryptExpense(expense, req.user, req.dataKey) });
    } catch (error) {
        console.error('Create expense error:', error);
        res.status(500).json({ success: false, message: 'Server error creating expense' });
    }
};

// GET /api/expenses
const getExpenses = async (req, res) => {
    try {
        const { page = 1, limit = 10, category, startDate, endDate } = req.query;

        // Materialize recurring instances for the requested window. Today
        // Expense has no isRecurring flag so this is a no-op for that
        // model; the call site is in place for the day a future part
        // brings recurring expenses online (Part 6 declared
        // parentRecurringId on the schema for exactly this reason).
        const fallback = _defaultWindow();
        const matFrom = startDate ? new Date(startDate) : fallback.from;
        const matTo   = endDate   ? new Date(endDate)   : fallback.to;
        try {
            await materializeRecurring(Expense, req.user._id, matFrom, matTo);
        } catch (matErr) {
            console.error('materializeRecurring (expense) failed:', matErr.message);
        }

        const query = { user: req.user._id };
        if (category) query.category = category;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate)   query.date.$lte = new Date(endDate);
        }

        const expenses = await Expense.find(query)
            .sort({ date: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const issues = await checkRecords(req, 'expense', expenses, attestationPayload);
        const items = [];
        for (const e of expenses) items.push(flag(await decryptExpense(e, req.user, req.dataKey), issues));

        const total = await Expense.countDocuments(query);

        res.json({
            success: true,
            data: items,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching expenses' });
    }
};

// GET /api/expenses/:id
const getExpenseById = async (req, res) => {
    try {
        const expense = await Expense.findOne({ _id: req.params.id, user: req.user._id });
        if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

        const issues = await checkRecords(req, 'expense', [expense], attestationPayload);
        res.json({ success: true, data: flag(await decryptExpense(expense, req.user, req.dataKey), issues) });
    } catch (error) {
        console.error('Get expense error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching expense' });
    }
};

// PUT /api/expenses/:id
const updateExpense = async (req, res) => {
    try {
        // If the caller wants to change the category, re-run the guard for
        // the NEW category before touching the DB. Owner / archive / type
        // semantics are identical to create.
        if (req.body.category !== undefined) {
            const guard = await assertCategoryOwnedAndTyped(req.user._id, req.body.category, 'expense');
            if (!guard.ok) {
                return res.status(guard.status).json({ success: false, message: guard.message });
            }
        }

        // Compound filter prevents IDOR.
        const current = await Expense.findOne({ _id: req.params.id, user: req.user._id });
        if (!current) return res.status(404).json({ success: false, message: 'Expense not found' });

        const updates = {};
        if (req.body.amount      !== undefined) updates.amount      = req.body.amount;
        if (req.body.category    !== undefined) updates.category    = req.body.category;
        if (req.body.description !== undefined) updates.description = await sealField(req.body.description, req.dataKey, FIELDS.expenseDescription, req.user._id);
        if (req.body.date        !== undefined) updates.date        = req.body.date;
        if (req.body.note        !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : (await encryptNote(req.body.note, req.user, req.dataKey, FIELDS.expenseNote));
        }
        // Re-sign over the values the record will hold after this update, so
        // an edit made through the app never reads as tampering and one made
        // behind its back always does (supersedes the create-only rule in
        // docs/decisions/SEC-1-ecdsa.md).
        updates.serverAttestation = await signRecord(
            attestationPayload({ amount: updates.amount ?? current.amount, category: updates.category ?? current.category }),
            req.user, req.dataKey,
        );

        const updated = await Expense.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { runValidators: true, new: true },
        );
        if (!updated) return res.status(404).json({ success: false, message: 'Expense not found' });

        // Budget spend is computed on read — moving an expense between
        // categories or months is reflected automatically.

        logAudit(req, 'expense.update', req.user._id, { expenseId: updated._id.toString(), fields: Object.keys(updates).filter((k) => k !== 'serverAttestation') });
        res.json({ success: true, data: await decryptExpense(updated, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ success: false, message: 'Server error updating expense' });
    }
};

// DELETE /api/expenses/:id
const deleteExpense = async (req, res) => {
    try {
        const deleted = await Expense.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Expense not found' });

        logAudit(req, 'expense.delete', req.user._id, { expenseId: deleted._id.toString(), amount: deleted.amount });
        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting expense' });
    }
};

// GET /api/expenses/summary/:year/:month
//
// Returns one row per category for the month with the category NAME (via
// $lookup) — earlier versions returned the raw Category ObjectId in the
// `category` field, which made every dashboard chart label render as a
// 24-hex hash. Now also includes the category's display color + icon so
// dashboard widgets can match the rest of the UI without a second fetch.
const getMonthlySummary = async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0, 23, 59, 59);

        const rows = await Expense.aggregate([
            { $match:  { user: req.user._id, date: { $gte: startDate, $lte: endDate } } },
            { $group:  { _id: '$category', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
            { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
            { $project: {
                _id:           1,
                totalAmount:   1,
                count:         1,
                categoryName:  { $ifNull: ['$cat.name',  'Unknown'] },
                categoryColor: { $ifNull: ['$cat.color', '#6B7280']  },
                categoryIcon:  { $ifNull: ['$cat.icon',  'more']     },
            } },
            { $sort: { totalAmount: -1 } },
        ]);

        const totalSpent = rows.reduce((sum, item) => sum + item.totalAmount, 0);

        res.json({
            success: true,
            data: {
                month,
                year,
                totalSpent,
                summary: rows.map((item) => ({
                    categoryId:    item._id ? item._id.toString() : null,
                    category:      item.categoryName,         // string name, not ObjectId
                    categoryColor: item.categoryColor,
                    categoryIcon:  item.categoryIcon,
                    amount:        item.totalAmount,
                    count:         item.count,
                    percentage:    totalSpent > 0 ? Math.round((item.totalAmount / totalSpent) * 100) : 0,
                })),
            },
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching summary' });
    }
};

// G1: the old updateBudgetSpent (a stored Budget.spent recomputed after each
// expense write) is gone. Budget.category is now the same Category ObjectId
// as Expense.category and spend is computed on read in
// services/budgetSpend.js, so it can't drift from the expenses.

module.exports = { createExpense, getExpenses, getExpenseById, updateExpense, deleteExpense, getMonthlySummary };
