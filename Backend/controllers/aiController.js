const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Goal = require('../models/Goal');
const Category = require('../models/Category');
const {
    expenseTotalForPeriod,
    incomeTotalForPeriod,
    monthlyEquivalentIncome,
} = require('../utils/finance');
const { computeHealthScore, HEALTH_WINDOW_DAYS } = require('../services/healthScore');

// Helper: current calendar month, UTC bounds. Matches the convention used
// by utils/recurring.js so monthly templates anchored at UTC midnight don't
// straddle two windows for any TZ east of UTC.
function _currentMonthRange() {
    const now = new Date();
    const y   = now.getUTCFullYear();
    const m   = now.getUTCMonth();
    return {
        start: new Date(Date.UTC(y, m,     1, 0, 0, 0, 0)),
        end:   new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
    };
}

// GET /api/ai/budget-optimization
//
// Part 7: returns per-category totals over the last 3 months WITH the
// category name (was returning just the ObjectId as `_id` since Part 3
// — useless to the frontend without a separate categories fetch). Adds
// monthlyAverage and the user's monthlyIncome so the frontend can show
// each line as a "$X/mo, Y% of income" stripe.
const budgetOptimization = async (req, res) => {
    try {
        const userId = req.user._id;
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const categories = await Expense.aggregate([
            { $match:  { user: userId, date: { $gte: threeMonthsAgo } } },
            { $group:  { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
            { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
            { $project: {
                _id:             1,
                category:        { $ifNull: ['$cat.name', 'Unknown'] },
                threeMonthTotal: '$total',
                monthlyAverage:  { $divide: ['$total', 3] },
                count:           1,
            } },
            { $sort: { threeMonthTotal: -1 } },
        ]);

        const monthlyIncome = await monthlyEquivalentIncome(userId);

        res.json({ success: true, data: { monthlyIncome, categories } });
    } catch (error) {
        console.error('Budget optimization error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/ai/smart-tips
//
// Part 7 rewrite: the previous version matched category strings ('Food',
// 'Entertainment') against `_id` from a $group on $category — but
// `$category` is an ObjectId now (Part 3), so the match never fired and
// the endpoint always returned []. Fixed via $lookup to resolve the name,
// then makes the thresholds INCOME-RELATIVE when the user has recurring
// income on file (the value the brief is asking us to wire). Falls back
// to absolute thresholds for users without recurring income so the tips
// degrade gracefully rather than going silent.
const smartTips = async (req, res) => {
    try {
        const userId = req.user._id;
        const { start, end } = _currentMonthRange();

        const categoryTotals = await Expense.aggregate([
            { $match:  { user: userId, date: { $gte: start, $lte: end } } },
            { $group:  { _id: '$category', total: { $sum: '$amount' } } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
            { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
            { $project: { _id: 1, total: 1, categoryName: { $ifNull: ['$cat.name', 'Unknown'] } } },
        ]);

        const monthlyIncome = await monthlyEquivalentIncome(userId);
        const tips = [];

        for (const e of categoryTotals) {
            // Income-relative tips when we have a baseline; absolute
            // fallback when we don't.
            if (monthlyIncome > 0) {
                const pct = e.total / monthlyIncome;
                if (e.categoryName === 'Food' && pct > 0.30) {
                    tips.push({ category: 'Food', message: `Food is ${Math.round(pct * 100)}% of your monthly income. Meal planning or cooking at home can shift this lower.` });
                }
                if (e.categoryName === 'Entertainment' && pct > 0.20) {
                    tips.push({ category: 'Entertainment', message: `Entertainment is ${Math.round(pct * 100)}% of your monthly income. Worth auditing subscriptions and outings.` });
                }
            } else {
                if (e.categoryName === 'Food' && e.total > 30_000) {
                    tips.push({ category: 'Food', message: 'Try cooking at home to save money.' });
                }
                if (e.categoryName === 'Entertainment' && e.total > 20_000) {
                    tips.push({ category: 'Entertainment', message: 'Reduce streaming subscriptions or outings.' });
                }
            }
        }

        // Savings-rate signal: only meaningful when we have an income baseline.
        if (monthlyIncome > 0) {
            const monthlyExpense = categoryTotals.reduce((s, c) => s + c.total, 0);
            const savingsRate = (monthlyIncome - monthlyExpense) / monthlyIncome;
            if (savingsRate > 0.5) {
                tips.push({
                    category: 'Savings',
                    message:  `You're saving about ${Math.round(savingsRate * 100)}% of your income this month — consider channeling the surplus into a goal.`,
                });
            } else if (savingsRate < 0) {
                tips.push({
                    category: 'Budget',
                    message:  'Expenses exceeded income this month. Top categories above are the place to start.',
                });
            }
        }

        res.json({ success: true, data: tips });
    } catch (error) {
        console.error('Smart tips error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /api/ai/financial-health-score
//
// Part 7 rewrite. Earlier versions used the sum of Budget.limit as
// "income" — that's the user's budget envelope, not actual income.
// The new formula uses ANNUALIZED recurring income divided down to a
// monthly equivalent vs. the current month's expense total:
//
//     annualIncome  = Σ (template.amount × annualMultiplier) for each
//                     recurring template the user owns
//                     where annualMultiplier ∈ {weekly:52, biweekly:26,
//                     monthly:12, yearly:1}
//     monthlyIncome = annualIncome / 12
//     monthlyExp    = sum of Expense.amount in current calendar month
//     ratio         = monthlyExp / monthlyIncome
//
// Score mapping (unchanged from the legacy thresholds — we kept the
// same ramp so the dashboard's gauge stays calibrated):
//     ratio > 1     → 20   (over-spending)
//     ratio > 0.8   → 50
//     ratio > 0.6   → 70
//     ratio > 0.4   → 85
//     else          → 100  (healthy)
//
// Zero-data edge cases:
//     monthlyIncome === 0 AND monthlyExp === 0 → 100 (no signal, neutral
//                                                     positive)
//     monthlyIncome === 0 AND monthlyExp  > 0  → 20  (spending without
//                                                     any income on
//                                                     file — worst case)
//
// One-off Income entries are deliberately NOT included in the income
// number — the score reflects the user's recurring baseline rather than
// spiky one-off receipts. Switching to "trailing-12-month actual" is a
// future iteration.
// GET /api/ai/financial-health-score
//
// Multi-factor health score over a trailing 90-day window (HS-1). The math
// lives in services/healthScore.js; this handler just sources the inputs.
// Income is sourced via incomeTotalForPeriod (one-off + recurring) — the old
// endpoint used monthlyEquivalentIncome (recurring-only), so any user without
// a recurring template scored a misleading 20. See docs/sprints/HS-1-plan.md.
const financialHealthScore = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        const windowStart = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 86_400_000);

        // Income + expense over the window.
        const [income, expense] = await Promise.all([
            incomeTotalForPeriod(userId, windowStart, now),
            expenseTotalForPeriod(userId, windowStart, now),
        ]);

        // Budget adherence inputs: resolve each budget's String-enum category
        // name to the user's Category ObjectId, then match window expenses by
        // that id + the budget's month. The stale Budget.spent is ignored.
        const [allBudgets, expenseCats, perCatMonth, weekAgg, goalDocs] = await Promise.all([
            Budget.find({ user: userId, isActive: true }).lean(),
            Category.find({ user: userId, type: { $in: ['expense', 'both'] } }).select('name').lean(),
            Expense.aggregate([
                { $match: { user: userId, date: { $gte: windowStart, $lte: now } } },
                { $group: {
                    _id:   { cat: '$category', y: { $year: { date: '$date', timezone: 'UTC' } }, m: { $month: { date: '$date', timezone: 'UTC' } } },
                    total: { $sum: '$amount' },
                } },
            ]),
            Expense.aggregate([
                { $match: { user: userId, date: { $gte: windowStart, $lte: now } } },
                { $group: { _id: { $dateTrunc: { date: '$date', unit: 'week', startOfWeek: 'monday', timezone: 'UTC' } }, total: { $sum: '$amount' } } },
                { $sort: { _id: 1 } },
            ]),
            Goal.find({ user: userId, status: 'Active' }).select('currentAmount targetAmount targetDate createdAt').lean(),
        ]);

        const nameToId = new Map(expenseCats.map((c) => [c.name, c._id.toString()]));
        const spendKey = (cat, y, m) => `${cat}-${y}-${m}`;
        const spendMap = new Map(perCatMonth.map((r) => [spendKey(r._id.cat?.toString(), r._id.y, r._id.m), r.total]));

        const budgets = [];
        for (const b of allBudgets) {
            // window overlap by month
            const mStart = new Date(Date.UTC(b.year, b.month - 1, 1, 0, 0, 0, 0));
            const mEnd   = new Date(Date.UTC(b.year, b.month, 0, 23, 59, 59, 999));
            if (mEnd < windowStart || mStart > now) continue;
            const catId = nameToId.get(b.category);
            if (!catId || b.limit <= 0) continue; // unattributable / zero-limit → exclude
            const spent = spendMap.get(spendKey(catId, b.year, b.month)) || 0;
            budgets.push({ limit: b.limit, spent });
        }

        const goals = goalDocs.map((g) => ({
            currentAmount: g.currentAmount,
            targetAmount:  g.targetAmount,
            targetDate:    g.targetDate,
            createdAt:     g.createdAt,
        }));
        const weeklySpends = weekAgg.map((w) => w.total);

        const result = computeHealthScore({ income, expense, budgets, goals, weeklySpends, now: now.getTime() });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Financial health score error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    budgetOptimization,
    smartTips,
    financialHealthScore,
};
