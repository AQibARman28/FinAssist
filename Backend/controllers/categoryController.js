const Category = require('../models/Category');
const Expense = require('../models/Expense');
const Income = require('../models/Income');
const { logAudit } = require('../utils/audit');

// POST /api/categories
const createCategory = async (req, res) => {
    try {
        const cat = await Category.create({
            user: req.user._id,
            ...req.body,
        });
        logAudit(req, 'category.create', req.user._id, {
            categoryId: cat._id.toString(),
            type:       cat.type,
        });
        res.status(201).json({ success: true, data: cat });
    } catch (error) {
        // Mongo dup-key on the {user, name, type} compound index.
        if (error?.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'A category with that name and type already exists',
            });
        }
        if (error.name === 'ValidationError') {
            const msg = Object.values(error.errors).map((e) => e.message).join(', ');
            return res.status(400).json({ success: false, message: msg });
        }
        console.error('Create category error:', error);
        res.status(500).json({ success: false, message: 'Server error creating category' });
    }
};

// GET /api/categories
const getCategories = async (req, res) => {
    try {
        const { type, includeArchived } = req.query;

        const query = { user: req.user._id };
        if (type) query.type = type;
        if (includeArchived !== 'true') query.isArchived = false;

        const items = await Category.find(query).sort({ sortOrder: 1, name: 1 });
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching categories' });
    }
};

// GET /api/categories/:id
const getCategoryById = async (req, res) => {
    try {
        const cat = await Category.findOne({ _id: req.params.id, user: req.user._id });
        if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
        res.json({ success: true, data: cat });
    } catch (error) {
        console.error('Get category error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching category' });
    }
};

// PUT /api/categories/:id
const updateCategory = async (req, res) => {
    try {
        // `type` is intentionally not in the update validator's schema —
        // .strict() rejects it at the boundary. Defense in depth: even if a
        // future refactor ever forwarded `type` here, we never spread
        // anything onto the update beyond what zod returned.
        const updated = await Category.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            req.body,
            { new: true, runValidators: true }
        );
        if (!updated) return res.status(404).json({ success: false, message: 'Category not found' });

        logAudit(req, 'category.update', req.user._id, {
            categoryId: updated._id.toString(),
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'A category with that name and type already exists',
            });
        }
        if (error.name === 'ValidationError') {
            const msg = Object.values(error.errors).map((e) => e.message).join(', ');
            return res.status(400).json({ success: false, message: msg });
        }
        console.error('Update category error:', error);
        res.status(500).json({ success: false, message: 'Server error updating category' });
    }
};

// DELETE /api/categories/:id
// Soft-deletes by default (sets isArchived: true). With ?force=true,
// hard-deletes ONLY if no Expense (or, in Part 5, Income) references the
// category. Returns 409 if force-delete is blocked by existing references.
const deleteCategory = async (req, res) => {
    try {
        const force = req.query?.force === 'true';

        // Owner-scoped lookup so cross-user delete attempts return 404 (not 403,
        // not "exists but forbidden" — same as our other IDOR sites).
        const cat = await Category.findOne({ _id: req.params.id, user: req.user._id });
        if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });

        if (!force) {
            // Soft delete is the default. Idempotent: archiving an already-
            // archived category is a no-op success.
            if (!cat.isArchived) {
                cat.isArchived = true;
                await cat.save();
                logAudit(req, 'category.archive', req.user._id, {
                    categoryId: cat._id.toString(),
                });
            }
            return res.json({ success: true, data: cat, message: 'Category archived' });
        }

        // Force-delete: only allowed when nothing references the category.
        // Both ref counts run in parallel since they're independent reads.
        const [expenseRefs, incomeRefs] = await Promise.all([
            Expense.countDocuments({ user: req.user._id, category: cat._id }),
            Income.countDocuments({ user: req.user._id, category: cat._id }),
        ]);
        if (expenseRefs > 0 || incomeRefs > 0) {
            return res.status(409).json({
                success: false,
                message: 'Cannot hard-delete: category is referenced by existing records. Archive instead, or detach references first.',
                refs:    { expenses: expenseRefs, incomes: incomeRefs },
            });
        }

        await Category.deleteOne({ _id: cat._id, user: req.user._id });
        logAudit(req, 'category.delete', req.user._id, {
            categoryId: cat._id.toString(),
        });
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting category' });
    }
};

module.exports = {
    createCategory,
    getCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
};
