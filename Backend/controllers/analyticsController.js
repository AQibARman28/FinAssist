const Expense = require('../models/Expense');
const Budget = require('../models/Budget');

const getMonthDateRange = (year, month) => {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    return { start, end };
};

const monthlyAnalytics = async (req, res) => {
    try {
        const year = parseInt(req.query.year);
        const month = parseInt(req.query.month);
        const userId = req.user._id;

        if (!year || !month || isNaN(year) || isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ success: false, message: 'Valid year and month are required' });
        }

        const { start: currentStart, end: currentEnd } = getMonthDateRange(year, month);

        const currentExpenses = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: currentStart, $lte: currentEnd } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        const prevMonth = month - 1 === 0 ? 12 : month - 1;
        const prevYear = month - 1 === 0 ? year - 1 : year;
        const { start: prevStart, end: prevEnd } = getMonthDateRange(prevYear, prevMonth);

        const previousExpenses = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: prevStart, $lte: prevEnd } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        res.json({ success: true, data: { currentExpenses, previousExpenses } });
    } catch (error) {
        console.error('Monthly analytics error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const recurringExpenses = async (req, res) => {
    try {
        const userId = req.user._id;

        const recurring = await Expense.aggregate([
            { $match: { user: userId } },
            { $group: { _id: '$description', count: { $sum: 1 }, total: { $sum: '$amount' } } },
            { $match: { count: { $gte: 2 } } },
            { $sort: { count: -1 } }
        ]);

        res.json({ success: true, data: recurring });
    } catch (error) {
        console.error('Recurring expenses error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const highSpendingCategories = async (req, res) => {
    try {
        const userId = req.user._id;

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const categories = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: threeMonthsAgo } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } },
            { $sort: { total: -1 } }
        ]);

        if (categories.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const avg = categories.reduce((sum, c) => sum + c.total, 0) / categories.length;
        const highSpending = categories.filter(c => c.total > avg * 1.5);

        res.json({ success: true, data: highSpending });
    } catch (error) {
        console.error('High-spending error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const expenseIncomeRatio = async (req, res) => {
    try {
        const userId = req.user._id;

        const { start, end } = getMonthDateRange(new Date().getFullYear(), new Date().getMonth() + 1);

        const expenses = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: start, $lte: end } } },
            { $group: { _id: null, totalExpense: { $sum: '$amount' } } }
        ]);

        const budgets = await Budget.aggregate([
            { $match: { user: userId, month: start.getMonth() + 1, year: start.getFullYear() } },
            { $group: { _id: null, totalIncome: { $sum: '$limit' } } }
        ]);

        const totalExpense = expenses.length ? expenses[0].totalExpense : 0;
        const totalIncome = budgets.length ? budgets[0].totalIncome : 0;
        const ratio = totalIncome ? ((totalExpense / totalIncome) * 100).toFixed(2) : 0;

        res.json({ success: true, data: { totalExpense, totalIncome, expenseIncomeRatio: ratio } });
    } catch (error) {
        console.error('Expense-to-income ratio error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = { monthlyAnalytics, recurringExpenses, highSpendingCategories, expenseIncomeRatio };
