const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const User = require('../models/User');

// Helper: get first and last day of a month
const getMonthDateRange = (year, month) => {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    return { start, end };
};

// 4.1 Monthly spending analytics dashboard
const monthlyAnalytics = async (req, res) => {
    try {
        const { year, month } = req.query;
        const userId = req.user._id;

        const { start: currentStart, end: currentEnd } = getMonthDateRange(year, month);

        // Current month expenses
        const currentExpenses = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: currentStart, $lte: currentEnd } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        // Previous month
        const prevMonth = month - 1 === 0 ? 12 : month - 1;
        const prevYear = month - 1 === 0 ? year - 1 : year;
        const { start: prevStart, end: prevEnd } = getMonthDateRange(prevYear, prevMonth);

        const previousExpenses = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: prevStart, $lte: prevEnd } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        res.json({
            success: true,
            data: { currentExpenses, previousExpenses }
        });
    } catch (error) {
        console.error('Monthly analytics error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// 4.2 Detect recurring expenses
const recurringExpenses = async (req, res) => {
    try {
        const userId = req.user._id;

        // Aggregate expenses by description and count occurrences
        const recurring = await Expense.aggregate([
            { $match: { user: userId } },
            { $group: { _id: '$description', count: { $sum: 1 }, total: { $sum: '$amount' } } },
            { $match: { count: { $gte: 2 } } }, // appeared 2+ times
            { $sort: { count: -1 } }
        ]);

        res.json({ success: true, data: recurring });
    } catch (error) {
        console.error('Recurring expenses error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// 4.3 High-spending category highlight
const highSpendingCategories = async (req, res) => {
    try {
        const userId = req.user._id;

        // Get last 3 months total per category
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const categories = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: threeMonthsAgo } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } },
            { $sort: { total: -1 } }
        ]);

        // Highlight categories with unusually high spending
        const avg = categories.reduce((sum, c) => sum + c.total, 0) / categories.length;
        const highSpending = categories.filter(c => c.total > avg * 1.5); // 50% above average

        res.json({ success: true, data: highSpending });
    } catch (error) {
        console.error('High-spending error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// 4.4 Expense-to-income ratio
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

module.exports = {
    monthlyAnalytics,
    recurringExpenses,
    highSpendingCategories,
    expenseIncomeRatio
};
