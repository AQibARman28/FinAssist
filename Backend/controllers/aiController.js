const Expense = require('../models/Expense');
const {
    expenseTotalForPeriod,
    monthlyEquivalentIncome,
} = require('../utils/finance');

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
const financialHealthScore = async (req, res) => {
    try {
        const userId = req.user._id;
        const { start, end } = _currentMonthRange();

        const [monthlyIncome, monthlyExpense] = await Promise.all([
            monthlyEquivalentIncome(userId),
            expenseTotalForPeriod(userId, start, end),
        ]);

        let score;
        if (monthlyIncome === 0 && monthlyExpense === 0) {
            score = 100;
        } else if (monthlyIncome === 0) {
            score = 20;
        } else {
            const ratio = monthlyExpense / monthlyIncome;
            if      (ratio > 1)   score = 20;
            else if (ratio > 0.8) score = 50;
            else if (ratio > 0.6) score = 70;
            else if (ratio > 0.4) score = 85;
            else                  score = 100;
        }

        res.json({
            success: true,
            data: {
                financialHealthScore: score,
                monthlyIncome,
                monthlyExpense,
            },
        });
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
