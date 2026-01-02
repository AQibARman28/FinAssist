const Expense = require('../models/Expense');
const Budget = require('../models/Budget');

const budgetOptimization = async (req, res) => {
    try {
        const userId = req.user._id;

        // Calculate average spending per category last 3 months
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const categoryAvg = await Expense.aggregate([
            { $match: { user: userId, date: { $gte: threeMonthsAgo } } },
            { $group: { _id: '$category', avgSpent: { $avg: '$amount' } } }
        ]);

        res.json({ success: true, data: categoryAvg });
    } catch (error) {
        console.error('Budget optimization error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Smart tips
const smartTips = async (req, res) => {
    try {
        const userId = req.user._id;

        // Example rule: If spending on Food > 30% of income, suggest cooking at home
        const expenses = await Expense.aggregate([
            { $match: { user: userId } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        const tips = [];
        expenses.forEach(e => {
            if (e._id === 'Food' && e.total > 30000) tips.push({ category: 'Food', message: 'Try cooking at home to save money' });
            if (e._id === 'Entertainment' && e.total > 20000) tips.push({ category: 'Entertainment', message: 'Reduce streaming subscriptions or outings' });
        });

        res.json({ success: true, data: tips });
    } catch (error) {
        console.error('Smart tips error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Financial health score
const financialHealthScore = async (req, res) => {
    try {
        const userId = req.user._id;

        const totalExpenses = await Expense.aggregate([
            { $match: { user: userId } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalBudget = await Budget.aggregate([
            { $match: { user: userId } },
            { $group: { _id: null, total: { $sum: '$limit' } } }
        ]);

        const expense = totalExpenses.length ? totalExpenses[0].total : 0;
        const income = totalBudget.length ? totalBudget[0].total : 0;

        let score = 100;
        if (income > 0) {
            const ratio = expense / income;
            if (ratio > 1) score = 20;
            else if (ratio > 0.8) score = 50;
            else if (ratio > 0.6) score = 70;
            else if (ratio > 0.4) score = 85;
        }

        res.json({ success: true, data: { financialHealthScore: score } });
    } catch (error) {
        console.error('Financial health score error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    budgetOptimization,
    smartTips,
    financialHealthScore
};
