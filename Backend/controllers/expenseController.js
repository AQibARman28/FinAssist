const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const { encrypt, safeDecrypt, generateHMAC, verifyHMAC } = require('../utils/encryption');
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

function decryptExpense(expense, user, dataKey) {
    const obj = expense.toObject ? expense.toObject({ virtuals: true }) : { ...expense };
    obj.description = safeDecrypt(expense.description, dataKey);
    obj.note = expense.note ? decryptNote(expense.note, user, dataKey) : null;
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

        const expDate   = date ? new Date(date) : new Date();
        const encDesc   = description ? encrypt(description, req.dataKey) : undefined;
        const hmac      = generateHMAC({ amount, category: finalCategory }, req.user._id);
        const signature = signRecord({ amount, category: finalCategory }, req.user, req.dataKey);
        const encNote   = req.body.note ? encryptNote(req.body.note, req.user) : undefined;

        const expense = await Expense.create({
            user: req.user._id,
            amount,
            category: finalCategory,
            description: encDesc,
            date: expDate,
            isAutoCategories,
            hmac,
            signature,
            note: encNote
        });

        await updateBudgetSpent(req.user._id, finalCategory, expDate.getMonth() + 1, expDate.getFullYear());

        res.status(201).json({ success: true, data: decryptExpense(expense, req.user, req.dataKey) });
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

        const items = expenses.map(e => {
            if (e.signature && !verifyRecord({ amount: e.amount, category: e.category }, e.signature, req.user)) {
                console.warn(`Signature integrity failure on expense ${e._id} (user ${req.user._id})`);
            }
            return decryptExpense(e, req.user, req.dataKey);
        });

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

        if (expense.hmac && !verifyHMAC({ amount: expense.amount, category: expense.category }, expense.hmac, req.user._id)) {
            console.warn(`HMAC integrity failure on expense ${expense._id}`);
        }
        if (expense.signature && !verifyRecord({ amount: expense.amount, category: expense.category }, expense.signature, req.user)) {
            console.warn(`Signature integrity failure on expense ${expense._id} (user ${req.user._id})`);
        }

        res.json({ success: true, data: decryptExpense(expense, req.user, req.dataKey) });
    } catch (error) {
        console.error('Get expense error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching expense' });
    }
};

// PUT /api/expenses/:id
const updateExpense = async (req, res) => {
    try {
        const expense = await Expense.findOne({ _id: req.params.id, user: req.user._id });
        if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

        const oldCategory = expense.category;
        const oldDate     = new Date(expense.date);

        const updates = {};
        if (req.body.amount      !== undefined) updates.amount      = req.body.amount;
        if (req.body.category    !== undefined) updates.category    = req.body.category;
        if (req.body.description !== undefined) updates.description = encrypt(req.body.description, req.dataKey);
        if (req.body.date        !== undefined) updates.date        = req.body.date;
        if (req.body.note        !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : encryptNote(req.body.note, req.user);
        }

        const finalAmount   = updates.amount   ?? expense.amount;
        const finalCategory = updates.category ?? expense.category;
        updates.hmac = generateHMAC({ amount: finalAmount, category: finalCategory }, req.user._id);

        const updatedExpense = await Expense.findByIdAndUpdate(
            req.params.id, updates, { new: true, runValidators: true }
        );

        const newDate = new Date(updatedExpense.date);
        await updateBudgetSpent(req.user._id, oldCategory,             oldDate.getMonth() + 1, oldDate.getFullYear());
        await updateBudgetSpent(req.user._id, updatedExpense.category, newDate.getMonth() + 1, newDate.getFullYear());

        res.json({ success: true, data: decryptExpense(updatedExpense, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ success: false, message: 'Server error updating expense' });
    }
};

// DELETE /api/expenses/:id
const deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findOne({ _id: req.params.id, user: req.user._id });
        if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

        const expenseDate = new Date(expense.date);
        await Expense.findByIdAndDelete(req.params.id);
        await updateBudgetSpent(req.user._id, expense.category, expenseDate.getMonth() + 1, expenseDate.getFullYear());

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
