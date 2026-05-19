const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const { expenseTotalForPeriod, incomeTotalForPeriod } = require('../utils/finance');

// UTC bounds. recurring.js's date arithmetic uses UTC throughout, and Mongo
// stores Dates as UTC milliseconds — using local time here was producing a
// half-day skew on either edge (a local-time anchor at month-start landed
// in the previous UTC month for any TZ east of UTC), which let
// computeRecurringDates project two occurrences into one local month for
// monthly templates anchored at local midnight.
const getMonthDateRange = (year, month) => {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const end   = new Date(Date.UTC(year, month,     0, 23, 59, 59, 999));
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

// GET /api/analytics/expense-income-ratio
//
// Part 7 rewrite: sources totals from the real Income and Expense
// collections for the current calendar month. Earlier versions used
// Budget.limit as "income" — that's the budget envelope, not the user's
// actual income, and produced a 100% ratio for anyone who set a budget
// without recording income. The new shape is { totalIncome, totalExpense,
// ratio } per the Part-7 brief; ratio is `null` (not 0, not Infinity)
// when totalIncome is 0 so the frontend can render "no income on file"
// without doing math on undefined.
const expenseIncomeRatio = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        const { start, end } = getMonthDateRange(now.getUTCFullYear(), now.getUTCMonth() + 1);

        const [totalIncome, totalExpense] = await Promise.all([
            incomeTotalForPeriod(userId, start, end),
            expenseTotalForPeriod(userId, start, end),
        ]);

        const ratio = totalIncome === 0 ? null : totalExpense / totalIncome;

        res.json({ success: true, data: { totalIncome, totalExpense, ratio } });
    } catch (error) {
        console.error('Expense-to-income ratio error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = { monthlyAnalytics, recurringExpenses, highSpendingCategories, expenseIncomeRatio };
