const Expense = require('../models/Expense');
const Budget = require('../models/Budget');

// Auto-categorization keywords
const categoryKeywords = {
    'Transport': ['uber', 'taxi', 'bus', 'train', 'metro', 'rickshaw', 'fuel', 'petrol', 'gas'],
    'Food': ['restaurant', 'food', 'meal', 'lunch', 'dinner', 'breakfast', 'cafe', 'pizza', 'burger'],
    'Entertainment': ['movie', 'cinema', 'game', 'concert', 'party', 'club', 'netflix', 'spotify'],
    'Shopping': ['shop', 'store', 'mall', 'amazon', 'flipkart', 'clothes', 'shoes'],
    'Bills': ['electricity', 'water', 'gas', 'internet', 'phone', 'rent', 'utility'],
    'Healthcare': ['doctor', 'hospital', 'medicine', 'pharmacy', 'clinic', 'health'],
    'Education': ['school', 'college', 'university', 'course', 'book', 'tuition']
};

const autoCategories = (description) => {
    const lowerDesc = description.toLowerCase();

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(keyword => lowerDesc.includes(keyword))) {
            return category;
        }
    }

    return 'Other';
};

// @desc    Create new expense
// @route   POST /api/expenses
// @access  Private
const createExpense = async (req, res) => {
    try {
        const { amount, category, description, date } = req.body;

        let finalCategory = category;
        let isAutoCategories = false;

        // Auto-categorize if no category provided
        if (!category) {
            finalCategory = autoCategories(description);
            isAutoCategories = true;
        }

        const expense = await Expense.create({
            user: req.user._id,
            amount,
            category: finalCategory,
            description,
            date: date || new Date(),
            isAutoCategories
        });

        // Update budget spent amount
        const expenseDate = new Date(expense.date);
        const month = expenseDate.getMonth() + 1;
        const year = expenseDate.getFullYear();

        await updateBudgetSpent(req.user._id, finalCategory, month, year);

        res.status(201).json({
            success: true,
            data: expense
        });
    } catch (error) {
        console.error('Create expense error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error creating expense'
        });
    }
};

// @desc    Get all expenses for user
// @route   GET /api/expenses
// @access  Private
const getExpenses = async (req, res) => {
    try {
        const { page = 1, limit = 10, category, startDate, endDate } = req.query;

        const query = { user: req.user._id };

        // Filter by category
        if (category) {
            query.category = category;
        }

        // Filter by date range
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const expenses = await Expense.find(query)
            .sort({ date: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Expense.countDocuments(query);

        res.json({
            success: true,
            data: expenses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching expenses'
        });
    }
};

// @desc    Get expense by ID
// @route   GET /api/expenses/:id
// @access  Private
const getExpenseById = async (req, res) => {
    try {
        const expense = await Expense.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!expense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }

        res.json({
            success: true,
            data: expense
        });
    } catch (error) {
        console.error('Get expense error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching expense'
        });
    }
};

// @desc    Update expense
// @route   PUT /api/expenses/:id
// @access  Private
const updateExpense = async (req, res) => {
    try {
        const expense = await Expense.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!expense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }

        const oldCategory = expense.category;
        const oldAmount = expense.amount;
        const oldDate = new Date(expense.date);

        // Update expense
        const updatedExpense = await Expense.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        // Update budget calculations
        const oldMonth = oldDate.getMonth() + 1;
        const oldYear = oldDate.getFullYear();

        const newDate = new Date(updatedExpense.date);
        const newMonth = newDate.getMonth() + 1;
        const newYear = newDate.getFullYear();

        // Recalculate budgets for affected months/categories
        await updateBudgetSpent(req.user._id, oldCategory, oldMonth, oldYear);
        await updateBudgetSpent(req.user._id, updatedExpense.category, newMonth, newYear);

        res.json({
            success: true,
            data: updatedExpense
        });
    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error updating expense'
        });
    }
};

// @desc    Delete expense
// @route   DELETE /api/expenses/:id
// @access  Private
const deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!expense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }

        const category = expense.category;
        const expenseDate = new Date(expense.date);
        const month = expenseDate.getMonth() + 1;
        const year = expenseDate.getFullYear();

        await Expense.findByIdAndDelete(req.params.id);

        // Update budget spent amount
        await updateBudgetSpent(req.user._id, category, month, year);

        res.json({
            success: true,
            message: 'Expense deleted successfully'
        });
    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error deleting expense'
        });
    }
};

// @desc    Get monthly expense summary
// @route   GET /api/expenses/summary/:year/:month
// @access  Private
const getMonthlySummary = async (req, res) => {
    try {
        const { year, month } = req.params;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const summary = await Expense.aggregate([
            {
                $match: {
                    user: req.user._id,
                    date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$category',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { totalAmount: -1 }
            }
        ]);

        const totalSpent = summary.reduce((sum, item) => sum + item.totalAmount, 0);

        res.json({
            success: true,
            data: {
                month: parseInt(month),
                year: parseInt(year),
                totalSpent,
                categoryBreakdown: summary,
                summary: summary.map(item => ({
                    category: item._id,
                    amount: item.totalAmount,
                    count: item.count,
                    percentage: totalSpent > 0 ? Math.round((item.totalAmount / totalSpent) * 100) : 0
                }))
            }
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching summary'
        });
    }
};

// Helper function to update budget spent amount
const updateBudgetSpent = async (userId, category, month, year) => {
    try {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const totalSpent = await Expense.aggregate([
            {
                $match: {
                    user: userId,
                    category: category,
                    date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        const spentAmount = totalSpent.length > 0 ? totalSpent[0].total : 0;

        await Budget.findOneAndUpdate(
            { user: userId, category, month, year },
            { spent: spentAmount },
            { upsert: false }
        );
    } catch (error) {
        console.error('Update budget spent error:', error);
    }
};

module.exports = {
    createExpense,
    getExpenses,
    getExpenseById,
    updateExpense,
    deleteExpense,
    getMonthlySummary
};
