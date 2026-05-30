const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const Income = require('../models/Income');
const Category = require('../models/Category');
const Goal = require('../models/Goal');
const { getBalance } = require('../services/balance');
const { safeDecrypt } = require('../utils/encryption');
const {
    expenseTotalForPeriod,
    incomeTotalForPeriod,
    monthlyEquivalentIncome,
    FREQ_MULTIPLIER,
} = require('../utils/finance');

// UTC bounds. recurring.js's date arithmetic uses UTC throughout, and Mongo
// stores Dates as UTC milliseconds — using local time here was producing a
// half-day skew on either edge.
const getMonthDateRange = (year, month) => {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const end   = new Date(Date.UTC(year, month,     0, 23, 59, 59, 999));
    return { start, end };
};

// Common $lookup stages for "join Expense.category → categories collection
// and project the name/color/icon". Keep the shape consistent across every
// analytics endpoint so the frontend doesn't have to special-case anything.
const CATEGORY_LOOKUP_STAGES = [
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
    { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
    { $project: {
        _id:           1,
        total:         1,
        count:         1,
        category:      { $ifNull: ['$cat.name',  'Uncategorized'] },
        categoryColor: { $ifNull: ['$cat.color', '#6B7280']        },
        categoryIcon:  { $ifNull: ['$cat.icon',  'more']           },
    } },
];

// GET /api/analytics/monthly-analytics?year=&month=
//
// Compares current vs. previous month, grouped by category. Each row now
// carries the category NAME / color / icon — earlier the chart's X-axis
// rendered Category ObjectIds as 24-hex hashes.
const monthlyAnalytics = async (req, res) => {
    try {
        const year   = parseInt(req.query.year);
        const month  = parseInt(req.query.month);
        const userId = req.user._id;

        if (!year || !month || isNaN(year) || isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ success: false, message: 'Valid year and month are required' });
        }

        const { start: currentStart, end: currentEnd } = getMonthDateRange(year, month);
        const prevMonth = month - 1 === 0 ? 12 : month - 1;
        const prevYear  = month - 1 === 0 ? year - 1 : year;
        const { start: prevStart, end: prevEnd } = getMonthDateRange(prevYear, prevMonth);

        const [currentExpenses, previousExpenses] = await Promise.all([
            Expense.aggregate([
                { $match: { user: userId, date: { $gte: currentStart, $lte: currentEnd } } },
                { $group: { _id: '$category', total: { $sum: '$amount' } } },
                ...CATEGORY_LOOKUP_STAGES,
                { $sort: { total: -1 } },
            ]),
            Expense.aggregate([
                { $match: { user: userId, date: { $gte: prevStart, $lte: prevEnd } } },
                { $group: { _id: '$category', total: { $sum: '$amount' } } },
                ...CATEGORY_LOOKUP_STAGES,
                { $sort: { total: -1 } },
            ]),
        ]);

        const totalCurrent  = currentExpenses.reduce((s, x) => s + x.total, 0);
        const totalPrevious = previousExpenses.reduce((s, x) => s + x.total, 0);
        const monthOverMonthDelta = totalCurrent - totalPrevious;
        const monthOverMonthPct   = totalPrevious === 0 ? null : (monthOverMonthDelta / totalPrevious);

        res.json({
            success: true,
            data: {
                currentExpenses,
                previousExpenses,
                totalCurrent,
                totalPrevious,
                monthOverMonthDelta,
                monthOverMonthPct,
            },
        });
    } catch (error) {
        console.error('Monthly analytics error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/analytics/high-spending
//
// Categories whose 3-month total exceeds 1.5× the cross-category mean.
// Same $lookup fix so labels read "Food" / "Transport" instead of an
// ObjectId.
const highSpendingCategories = async (req, res) => {
    try {
        const userId = req.user._id;
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const rows = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: threeMonthsAgo } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } },
            ...CATEGORY_LOOKUP_STAGES,
            { $sort: { total: -1 } },
        ]);

        if (rows.length === 0) return res.json({ success: true, data: [] });

        const avg = rows.reduce((s, r) => s + r.total, 0) / rows.length;
        const highSpending = rows.filter((r) => r.total > avg * 1.5);
        res.json({ success: true, data: highSpending });
    } catch (error) {
        console.error('High-spending error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/analytics/recurring-expenses (deprecated, kept for back-compat)
//
// Originally grouped Expense by `description` to surface duplicates. Since
// SEC-1 Phase 2 the description field is AES-GCM encrypted with a fresh
// IV per row, so two semantically-identical expenses have different
// ciphertexts and never $group together. The endpoint is left in place
// returning an empty array so old clients don't break; the new
// /api/analytics/recurring-income endpoint is what the dashboard should
// consume.
const recurringExpenses = async (_req, res) => {
    res.json({
        success: true,
        data: [],
        deprecated: true,
        replacedBy: '/api/analytics/recurring-income',
    });
};

// GET /api/analytics/recurring-income
//
// Lists the user's recurring income templates (the rows that materialize
// instances on every list call — see utils/recurring.js). Each row carries
// the cadence and a projected MONTHLY contribution to make the dashboard
// math obvious.
const recurringIncome = async (req, res) => {
    try {
        const userId = req.user._id;

        const templates = await Income.aggregate([
            { $match: { user: userId, isRecurring: true, parentRecurringId: null } },
            { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'cat' } },
            { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
            { $sort: { amount: -1 } },
        ]);

        const items = templates.map((t) => {
            const m = FREQ_MULTIPLIER[t.recurringFrequency] || 0;
            const monthlyEquivalent = (t.amount * m) / 12;
            return {
                _id:                 t._id.toString(),
                amount:              t.amount,
                frequency:           t.recurringFrequency,
                isPostTax:           t.isPostTax,
                category:            t.cat?.name  ?? 'Uncategorized',
                categoryColor:       t.cat?.color ?? '#6B7280',
                categoryIcon:        t.cat?.icon  ?? 'more',
                date:                t.date,
                monthlyEquivalent,
                annualEquivalent:    t.amount * m,
            };
        });

        const monthlyTotal = items.reduce((s, x) => s + x.monthlyEquivalent, 0);
        res.json({ success: true, data: { items, monthlyTotal } });
    } catch (error) {
        console.error('Recurring income error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/analytics/expense-income-ratio (unchanged from Part 7)
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

// GET /api/analytics/savings-rate
//
// Current month. savingsRate = (income − expense) / income, with the
// usual null-on-zero-income guard. Bundles the daily-average too because
// the frontend tile renders both side by side.
const savingsRate = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        const { start, end } = getMonthDateRange(now.getUTCFullYear(), now.getUTCMonth() + 1);

        const [totalIncome, totalExpense] = await Promise.all([
            incomeTotalForPeriod(userId, start, end),
            expenseTotalForPeriod(userId, start, end),
        ]);

        const savingsRateValue = totalIncome === 0 ? null : (totalIncome - totalExpense) / totalIncome;
        const dayOfMonth       = Math.max(1, now.getUTCDate());
        const dailyAverage     = totalExpense / dayOfMonth;

        res.json({
            success: true,
            data: {
                totalIncome,
                totalExpense,
                savingsRate: savingsRateValue,
                dailyAverage,
                dayOfMonth,
            },
        });
    } catch (error) {
        console.error('Savings-rate error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/analytics/dashboard-stats
//
// Single round-trip aggregation for the analytics page header strip:
// returns monthlyIncome + monthlyExpense + savingsRate + dailyAverage +
// monthOverMonth + topCategories. Frontend can fan-out from one fetch
// instead of N.
const dashboardStats = async (req, res) => {
    try {
        const userId = req.user._id;
        const now    = new Date();
        const { start, end } = getMonthDateRange(now.getUTCFullYear(), now.getUTCMonth() + 1);
        const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
        const prevYear  = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
        const { start: prevStart, end: prevEnd } = getMonthDateRange(prevYear, prevMonth);

        const [
            totalIncome, totalExpense, totalPrevious, monthlyRecurringIncome, topCategories,
        ] = await Promise.all([
            incomeTotalForPeriod(userId, start, end),
            expenseTotalForPeriod(userId, start, end),
            expenseTotalForPeriod(userId, prevStart, prevEnd),
            monthlyEquivalentIncome(userId),
            Expense.aggregate([
                { $match: { user: userId, date: { $gte: start, $lte: end } } },
                { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
                ...CATEGORY_LOOKUP_STAGES,
                { $sort: { total: -1 } },
                { $limit: 5 },
            ]),
        ]);

        const savingsRateValue = totalIncome === 0 ? null : (totalIncome - totalExpense) / totalIncome;
        const dayOfMonth       = Math.max(1, now.getUTCDate());
        const dailyAverage     = totalExpense / dayOfMonth;
        const momDelta         = totalExpense - totalPrevious;
        const momPct           = totalPrevious === 0 ? null : (momDelta / totalPrevious);

        res.json({
            success: true,
            data: {
                totalIncome,
                totalExpense,
                totalPrevious,
                monthlyRecurringIncome,
                savingsRate:        savingsRateValue,
                dailyAverage,
                monthOverMonthDelta: momDelta,
                monthOverMonthPct:   momPct,
                topCategories: topCategories.map((c) => ({
                    categoryId:    c._id?.toString() ?? null,
                    category:      c.category,
                    categoryColor: c.categoryColor,
                    categoryIcon:  c.categoryIcon,
                    total:         c.total,
                    count:         c.count,
                    percentage:    totalExpense > 0 ? Math.round((c.total / totalExpense) * 100) : 0,
                })),
            },
        });
    } catch (error) {
        console.error('Dashboard-stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/analytics/spending-timeline?granularity=&from=&to=&category=&previewLimit=
//
// Time-bucketed spending — the SHARED primitive for the DASH-1 spending curve
// and EXP-1 Phase 5 (history). Pure: no outlier math (that's client-side, over
// the visible window). Query is zod-validated in the route, so values arrive
// clean (previewLimit coerced to a number).
//
// Per bucket: total + count over ALL expenses, plus up to `previewLimit`
// top-spender preview rows (amount-desc, descriptions decrypted) and the single
// largest expense's id so the client can flag it without re-sorting. Uses
// $dateTrunc (Mongo 5.0+) and $topN (5.2+).
const TRUNC_UNIT  = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const MONTH_ABBR  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS      = 86_400_000;

function _defaultRange(granularity, now) {
    if (granularity === 'daily')   return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
    if (granularity === 'weekly')  return { from: new Date(now.getTime() - 12 * 7 * DAY_MS), to: now };
    if (granularity === 'monthly') return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1, 0, 0, 0, 0)), to: now };
    return { from: null, to: now }; // yearly → all years with data
}

function _bucketLabel(granularity, d) {
    const dt = new Date(d);
    const y = dt.getUTCFullYear();
    if (granularity === 'monthly') return `${MONTH_ABBR[dt.getUTCMonth()]} ${y}`;
    if (granularity === 'yearly')  return `${y}`;
    return `${MONTH_ABBR[dt.getUTCMonth()]} ${dt.getUTCDate()}`; // daily + weekly (week-start)
}

const spendingTimeline = async (req, res) => {
    try {
        const userId       = req.user._id;
        const granularity  = req.query.granularity;
        const previewLimit = req.query.previewLimit ? parseInt(req.query.previewLimit, 10) : 8;

        const now = new Date();
        const def = _defaultRange(granularity, now);
        const from = req.query.from ? new Date(req.query.from) : def.from;
        const to   = req.query.to   ? new Date(req.query.to)   : def.to;

        const match = { user: userId };
        if (from || to) {
            match.date = {};
            if (from) match.date.$gte = from;
            if (to)   match.date.$lte = to;
        }
        if (req.query.category) match.category = new mongoose.Types.ObjectId(req.query.category);

        const truncSpec = { date: '$date', unit: TRUNC_UNIT[granularity], timezone: 'UTC' };
        if (granularity === 'weekly') truncSpec.startOfWeek = 'monday';

        const grouped = await Expense.aggregate([
            { $match: match },
            { $group: {
                _id:   { $dateTrunc: truncSpec },
                total: { $sum: '$amount' },
                count: { $sum: 1 },
                top:   { $topN: {
                    n: previewLimit,
                    sortBy: { amount: -1 },
                    output: { _id: '$_id', amount: '$amount', categoryId: '$category', date: '$date', description: '$description' },
                } },
            } },
            { $sort: { _id: 1 } }, // chronological x-axis
        ]);

        // One batched category lookup for every preview row across all buckets.
        const catIds = new Set();
        for (const b of grouped) for (const e of b.top) if (e.categoryId) catIds.add(e.categoryId.toString());
        const cats = catIds.size
            ? await Category.find({ _id: { $in: [...catIds] }, user: userId }).select('name color icon').lean()
            : [];
        const catMap = new Map(cats.map((c) => [c._id.toString(), c]));

        let grandTotal = 0;
        let grandCount = 0;
        const buckets = [];
        for (const b of grouped) {
            grandTotal += b.total;
            grandCount += b.count;
            const topExpenses = await Promise.all(b.top.map(async (e) => {
                const cat = e.categoryId ? catMap.get(e.categoryId.toString()) : null;
                return {
                    _id:           e._id.toString(),
                    amount:        e.amount,
                    description:   await safeDecrypt(e.description, req.dataKey),
                    categoryId:    e.categoryId ? e.categoryId.toString() : null,
                    categoryName:  cat?.name  ?? 'Uncategorized',
                    categoryColor: cat?.color ?? '#6B7280',
                    categoryIcon:  cat?.icon  ?? 'more',
                    date:          e.date,
                };
            }));
            buckets.push({
                period:       new Date(b._id).toISOString().slice(0, 10),
                label:        _bucketLabel(granularity, b._id),
                total:        b.total,
                count:        b.count,
                maxExpenseId: b.top[0] ? b.top[0]._id.toString() : null, // top is amount-desc
                hasMore:      b.count > previewLimit,
                topExpenses,
            });
        }

        res.json({
            success: true,
            data: {
                granularity,
                from: from ? from.toISOString().slice(0, 10) : (buckets[0]?.period ?? null),
                to:   to.toISOString().slice(0, 10),
                buckets,
                grandTotal,
                grandCount,
            },
        });
    } catch (error) {
        console.error('Spending-timeline error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/analytics/balance
//
// The single continuous pocket balance + its monthly/yearly classification.
// Used by the Goals, Income, and Expenses pages. Read-only. Goal contribution
// amounts/dates are plaintext, so no dataKey is needed here.
const balance = async (req, res) => {
    try {
        const goals = await Goal.find({ user: req.user._id });
        const data = await getBalance(req.user._id, goals);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Balance error:', error);
        res.status(500).json({ success: false, message: 'Server error computing balance' });
    }
};

module.exports = {
    monthlyAnalytics,
    recurringExpenses,
    recurringIncome,
    highSpendingCategories,
    expenseIncomeRatio,
    savingsRate,
    dashboardStats,
    spendingTimeline,
    balance,
};
