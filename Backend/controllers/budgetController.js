const Budget = require('../models/Budget');
const Expense = require('../models/Expense');

// @desc    Create new budget
// @route   POST /api/budgets
// @access  Private
// @desc    Create or Update budget
// @route   POST /api/budgets
// @access  Private
const createBudget = async (req, res) => {
    try {
        const { category, limit, month, year, alertThreshold } = req.body;

        // Check if budget already exists for this category/month/year
        let budget = await Budget.findOne({
            user: req.user._id,
            category,
            month,
            year
        });

        // Calculate current spent amount for this category/month if creating new or updating logic requires it
        // Note: For simple limit update, we might not strictly need to recalculate spent if it's already coherent,
        // but best practice is to ensure it's up to date.
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const spentResult = await Expense.aggregate([
            {
                $match: {
                    user: req.user._id,
                    category,
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

        const spent = spentResult.length > 0 ? spentResult[0].total : 0;

        if (budget) {
            // Update existing budget
            budget.limit = limit;
            budget.spent = spent; // Refresh spent just in case
            if (alertThreshold) budget.alertThreshold = alertThreshold;
            await budget.save();
        } else {
            // Create new budget
            budget = await Budget.create({
                user: req.user._id,
                category,
                limit,
                spent,
                month,
                year,
                alertThreshold: alertThreshold || 80
            });
        }

        res.status(200).json({
            success: true,
            data: budget,
            message: budget.isNew ? 'Budget created' : 'Budget updated'
        });
    } catch (error) {
        console.error('Create budget error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error creating budget'
        });
    }
};

// @desc    Get all budgets for user
// @route   GET /api/budgets
// @access  Private
const getBudgets = async (req, res) => {
    try {
        const { month, year, category } = req.query;

        const query = { user: req.user._id };

        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (category) query.category = category;

        const budgets = await Budget.find(query).sort({ category: 1 });

        res.json({
            success: true,
            data: budgets
        });
    } catch (error) {
        console.error('Get budgets error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching budgets'
        });
    }
};

// @desc    Get budget by ID
// @route   GET /api/budgets/:id
// @access  Private
const getBudgetById = async (req, res) => {
    try {
        const budget = await Budget.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!budget) {
            return res.status(404).json({
                success: false,
                message: 'Budget not found'
            });
        }

        res.json({
            success: true,
            data: budget
        });
    } catch (error) {
        console.error('Get budget error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching budget'
        });
    }
};

// @desc    Update budget
// @route   PUT /api/budgets/:id
// @access  Private
const updateBudget = async (req, res) => {
    try {
        const budget = await Budget.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!budget) {
            return res.status(404).json({
                success: false,
                message: 'Budget not found'
            });
        }

        const updatedBudget = await Budget.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            data: updatedBudget
        });
    } catch (error) {
        console.error('Update budget error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error updating budget'
        });
    }
};

// @desc    Delete budget
// @route   DELETE /api/budgets/:id
// @access  Private
const deleteBudget = async (req, res) => {
    try {
        const budget = await Budget.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!budget) {
            return res.status(404).json({
                success: false,
                message: 'Budget not found'
            });
        }

        await Budget.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Budget deleted successfully'
        });
    } catch (error) {
        console.error('Delete budget error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error deleting budget'
        });
    }
};

// @desc    Get budget usage tracking
// @route   GET /api/budgets/tracking/:year/:month
// @access  Private
const getBudgetTracking = async (req, res) => {
    try {
        const { year, month } = req.params;

        const budgets = await Budget.find({
            user: req.user._id,
            month: parseInt(month),
            year: parseInt(year),
            isActive: true
        });

        const trackingData = budgets.map(budget => ({
            _id: budget._id,
            category: budget.category,
            limit: budget.limit,
            spent: budget.spent,
            remaining: budget.remainingAmount,
            usagePercentage: budget.usagePercentage,
            isOverLimit: budget.isOverLimit,
            isNearLimit: budget.isNearLimit,
            alertThreshold: budget.alertThreshold
        }));

        res.json({
            success: true,
            data: {
                month: parseInt(month),
                year: parseInt(year),
                budgets: trackingData,
                alerts: trackingData.filter(b => b.isNearLimit || b.isOverLimit)
            }
        });
    } catch (error) {
        console.error('Get budget tracking error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching budget tracking'
        });
    }
};

// @desc    Get budget alerts
// @route   GET /api/budgets/alerts
// @access  Private
const getBudgetAlerts = async (req, res) => {
    try {
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        const budgets = await Budget.find({
            user: req.user._id,
            month: currentMonth,
            year: currentYear,
            isActive: true
        });

        const alerts = [];

        budgets.forEach(budget => {
            if (budget.isOverLimit) {
                alerts.push({
                    type: 'over_limit',
                    severity: 'high',
                    category: budget.category,
                    message: `You have exceeded your ${budget.category} budget by ${budget.spent - budget.limit}`,
                    budget: budget
                });
            } else if (budget.isNearLimit) {
                alerts.push({
                    type: 'near_limit',
                    severity: 'medium',
                    category: budget.category,
                    message: `You have used ${budget.usagePercentage}% of your ${budget.category} budget`,
                    budget: budget
                });
            }
        });

        res.json({
            success: true,
            data: alerts
        });
    } catch (error) {
        console.error('Get budget alerts error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error fetching budget alerts'
        });
    }
};

// @desc    Reset budget for new month
// @route   POST /api/budgets/reset
// @access  Private
const resetBudgets = async (req, res) => {
    try {
        const { fromMonth, fromYear, toMonth, toYear } = req.body;

        // Get budgets from previous month
        const previousBudgets = await Budget.find({
            user: req.user._id,
            month: fromMonth,
            year: fromYear,
            isActive: true
        });

        const newBudgets = [];

        for (const budget of previousBudgets) {
            // Check if budget already exists for new month
            const existingBudget = await Budget.findOne({
                user: req.user._id,
                category: budget.category,
                month: toMonth,
                year: toYear
            });

            if (!existingBudget) {
                const newBudget = await Budget.create({
                    user: req.user._id,
                    category: budget.category,
                    limit: budget.limit,
                    spent: 0,
                    month: toMonth,
                    year: toYear,
                    alertThreshold: budget.alertThreshold
                });
                newBudgets.push(newBudget);
            }
        }

        res.json({
            success: true,
            data: newBudgets,
            message: `Created ${newBudgets.length} budgets for ${toMonth}/${toYear}`
        });
    } catch (error) {
        console.error('Reset budgets error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error resetting budgets'
        });
    }
};

module.exports = {
    createBudget,
    getBudgets,
    getBudgetById,
    updateBudget,
    deleteBudget,
    getBudgetTracking,
    getBudgetAlerts,
    resetBudgets
};
