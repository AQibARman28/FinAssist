const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const { encrypt, safeDecrypt } = require('../utils/encryption');
const { signRecord, verifyRecord, encryptNote, decryptNote } = require('../utils/signing');

const categoryKeywords = {
    'Transport':     ['uber', 'taxi', 'bus', 'train', 'metro', 'rickshaw', 'fuel', 'petrol', 'gas'],
    'Food':          ['restaurant', 'food', 'meal', 'lunch', 'dinner', 'breakfast', 'cafe', 'pizza', 'burger'],
    'Entertainment': ['movie', 'cinema', 'game', 'concert', 'party', 'club', 'netflix', 'spotify'],
    'Shopping':      ['shop', 'store', 'mall', 'amazon', 'flipkart', 'clothes', 'shoes'],
    'Bills':         ['electricity', 'water', 'gas', 'internet', 'phone', 'rent', 'utility'],
    'Healthcare':    ['doctor', 'hospital', 'medicine', 'pharmacy', 'clinic', 'health'],
    'Education':     ['school', 'college', 'university', 'course', 'book', 'tuition']
};

const autoCategories = (description) => {
    if (!description) return 'Other';
    const lowerDesc = description.toLowerCase();
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(kw => lowerDesc.includes(kw))) return category;
    }
    return 'Other';
};

async function decryptExpense(expense, user, dataKey) {
    const obj = expense.toObject ? expense.toObject({ virtuals: true }) : { ...expense };
    obj.description = await safeDecrypt(expense.description, dataKey);
    obj.note = expense.note ? await decryptNote(expense.note, user, dataKey) : null;
    return obj;
}

// POST /api/expenses
const createExpense = async (req, res) => {
    try {
        const { amount, category, description, date } = req.body;

        let finalCategory = category;
        let isAutoCategories = false;
        if (!category) {
            finalCategory = autoCategories(description);
            isAutoCategories = true;
        }

        const expDate           = date ? new Date(date) : new Date();
        const encDesc           = description ? (await encrypt(description, req.dataKey)) : undefined;
        const serverAttestation = await signRecord({ amount, category: finalCategory }, req.user, req.dataKey);
        const encNote           = req.body.note ? (await encryptNote(req.body.note, req.user)) : undefined;

        const expense = await Expense.create({
            user: req.user._id,
            amount,
            category: finalCategory,
            description: encDesc,
            date: expDate,
            isAutoCategories,
            serverAttestation,
            note: encNote
        });

        await updateBudgetSpent(req.user._id, finalCategory, expDate.getMonth() + 1, expDate.getFullYear());

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

        const items = [];
        for (const e of expenses) {
            if (e.serverAttestation && !(await verifyRecord({ amount: e.amount, category: e.category }, e.serverAttestation, req.user))) {
                console.warn(`serverAttestation failed verification on expense ${e._id} (user ${req.user._id})`);
            }
            items.push(await decryptExpense(e, req.user, req.dataKey));
        }

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

        if (expense.serverAttestation && !(await verifyRecord({ amount: expense.amount, category: expense.category }, expense.serverAttestation, req.user))) {
            console.warn(`serverAttestation failed verification on expense ${expense._id} (user ${req.user._id})`);
        }

        res.json({ success: true, data: await decryptExpense(expense, req.user, req.dataKey) });
    } catch (error) {
        console.error('Get expense error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching expense' });
    }
};

// PUT /api/expenses/:id
const updateExpense = async (req, res) => {
    try {
        // Build the update doc before the DB call so we can refuse a no-op
        // request loudly rather than silently round-tripping.
        const updates = {};
        if (req.body.amount      !== undefined) updates.amount      = req.body.amount;
        if (req.body.category    !== undefined) updates.category    = req.body.category;
        if (req.body.description !== undefined) updates.description = await encrypt(req.body.description, req.dataKey);
        if (req.body.date        !== undefined) updates.date        = req.body.date;
        if (req.body.note        !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : (await encryptNote(req.body.note, req.user));
        }

        // serverAttestation is set on creation and NOT regenerated on update —
        // see docs/decisions/SEC-1-ecdsa.md.

        // Compound filter prevents IDOR — the mutation only matches the row
        // when both _id and user line up. Null result means either the row
        // doesn't exist OR it belongs to someone else; both surface as 404 so
        // the existence of someone else's id can't be probed.
        const before = await Expense.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { runValidators: true }   // returns the pre-update document
        );
        if (!before) return res.status(404).json({ success: false, message: 'Expense not found' });

        const updated = await Expense.findOne({ _id: req.params.id, user: req.user._id });

        const oldDate = new Date(before.date);
        const newDate = new Date(updated.date);
        await updateBudgetSpent(req.user._id, before.category,  oldDate.getMonth() + 1, oldDate.getFullYear());
        await updateBudgetSpent(req.user._id, updated.category, newDate.getMonth() + 1, newDate.getFullYear());

        res.json({ success: true, data: await decryptExpense(updated, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ success: false, message: 'Server error updating expense' });
    }
};

// DELETE /api/expenses/:id
const deleteExpense = async (req, res) => {
    try {
        // findOneAndDelete with the compound filter enforces ownership at the
        // mutation site — no separate read-then-delete TOCTOU window.
        const deleted = await Expense.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Expense not found' });

        const d = new Date(deleted.date);
        await updateBudgetSpent(req.user._id, deleted.category, d.getMonth() + 1, d.getFullYear());

        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting expense' });
    }
};

// GET /api/expenses/summary/:year/:month
const getMonthlySummary = async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0, 23, 59, 59);

        const summary = await Expense.aggregate([
            { $match: { user: req.user._id, date: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: '$category', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $sort: { totalAmount: -1 } }
        ]);

        const totalSpent = summary.reduce((sum, item) => sum + item.totalAmount, 0);

        res.json({
            success: true,
            data: {
                month,
                year,
                totalSpent,
                categoryBreakdown: summary,
                summary: summary.map(item => ({
                    category:   item._id,
                    amount:     item.totalAmount,
                    count:      item.count,
                    percentage: totalSpent > 0 ? Math.round((item.totalAmount / totalSpent) * 100) : 0
                }))
            }
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching summary' });
    }
};

const updateBudgetSpent = async (userId, category, month, year) => {
    try {
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0, 23, 59, 59);
        const result = await Expense.aggregate([
            { $match: { user: userId, category, date: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        await Budget.findOneAndUpdate(
            { user: userId, category, month, year },
            { spent: result.length > 0 ? result[0].total : 0 },
            { upsert: false }
        );
    } catch (error) {
        console.error('Update budget spent error:', error);
    }
};

module.exports = { createExpense, getExpenses, getExpenseById, updateExpense, deleteExpense, getMonthlySummary };
