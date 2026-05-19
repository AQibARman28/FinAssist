/**
 * defaultCategories.js — the 10 categories every new account starts with.
 *
 * Six expense + four income. "Other" appears once on each side; the
 * { user, name, type } compound unique index makes those two distinct rows.
 *
 * sortOrder is assigned by position so the UI displays them in the order
 * listed here, regardless of the alphabetical secondary sort.
 *
 * seedDefaultCategoriesForUser(userId, { session? }) inserts the 10 rows
 * for one user. Uses insertMany with ordered:true (default), so the call
 * either succeeds in full or surfaces the first failure (typically a
 * dup-key on the unique index when called twice for the same user — which
 * is the documented Part-2 behavior, not a bug). The optional `session`
 * parameter is forwarded as-is so the caller can wrap the seed in a
 * transaction alongside the user's own save() once the deploy environment
 * supports replica-set transactions.
 */

const Category = require('../models/Category');

const DEFAULT_CATEGORIES = Object.freeze([
    // Expense (6)
    { name: 'Food',       type: 'expense', color: '#F97316', icon: 'utensils',  sortOrder: 0 },
    { name: 'Transport',  type: 'expense', color: '#3B82F6', icon: 'car',       sortOrder: 1 },
    { name: 'Bills',      type: 'expense', color: '#EF4444', icon: 'home',      sortOrder: 2 },
    { name: 'Shopping',   type: 'expense', color: '#A855F7', icon: 'cart',      sortOrder: 3 },
    { name: 'Healthcare', type: 'expense', color: '#10B981', icon: 'heart',     sortOrder: 4 },
    { name: 'Other',      type: 'expense', color: '#6B7280', icon: 'more',      sortOrder: 5 },

    // Income (4)
    { name: 'Salary',     type: 'income',  color: '#10B981', icon: 'briefcase', sortOrder: 0 },
    { name: 'Freelance',  type: 'income',  color: '#3B82F6', icon: 'wallet',    sortOrder: 1 },
    { name: 'Gift',       type: 'income',  color: '#A855F7', icon: 'gift',      sortOrder: 2 },
    { name: 'Other',      type: 'income',  color: '#6B7280', icon: 'more',      sortOrder: 3 },
]);

async function seedDefaultCategoriesForUser(userId, options = {}) {
    if (!userId) {
        throw new TypeError('seedDefaultCategoriesForUser: userId is required');
    }
    const docs = DEFAULT_CATEGORIES.map((c) => ({ ...c, user: userId }));
    const insertOpts = {};
    if (options.session) insertOpts.session = options.session;
    return Category.insertMany(docs, insertOpts);
}

module.exports = { DEFAULT_CATEGORIES, seedDefaultCategoriesForUser };
