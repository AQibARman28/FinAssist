/**
 * budgetSpend.js — budget "spent" computed on read (G1).
 *
 * Budget.category and Expense.category are both ObjectIds into the user's
 * Category collection, so a budget's spend is simply the sum of that user's
 * expenses in that category during the budget's calendar month. Nothing is
 * stored on the Budget row, so it cannot drift when an expense is created,
 * edited (amount / category / date) or deleted.
 *
 * Months are UTC calendar months — the same convention as the analytics and
 * health-score code. Expenses entered from the date picker are stored at UTC
 * midnight, so the UTC month is exactly the calendar month the user picked.
 */

const Expense = require('../models/Expense');
const Category = require('../models/Category');

const FALLBACK_CATEGORY = Object.freeze({ name: 'Unknown category', color: '#6B7280', icon: 'more', isArchived: false });

// A real ObjectId value (not a legacy enum string left over from before the
// migration — those can never match an expense).
function isObjectIdValue(v) {
    return v != null && typeof v === 'object' && typeof v.toHexString === 'function';
}

function monthRangeUTC(year, month) {
    return {
        start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
        end:   new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
}

const spendKey = (categoryId, year, month) => `${categoryId}-${year}-${month}`;

// One aggregation for any set of budgets: Map spendKey → total.
async function spentByCategoryMonth(userId, budgets) {
    const withIds = budgets.filter((b) => isObjectIdValue(b.category));
    if (withIds.length === 0) return new Map();

    const catIds = [...new Map(withIds.map((b) => [b.category.toHexString(), b.category])).values()];
    let from = null;
    let to = null;
    for (const b of withIds) {
        const { start, end } = monthRangeUTC(b.year, b.month);
        if (!from || start < from) from = start;
        if (!to || end > to) to = end;
    }

    const rows = await Expense.aggregate([
        { $match: { user: userId, category: { $in: catIds }, date: { $gte: from, $lte: to } } },
        { $group: {
            _id: {
                cat: '$category',
                y:   { $year:  { date: '$date', timezone: 'UTC' } },
                m:   { $month: { date: '$date', timezone: 'UTC' } },
            },
            total: { $sum: '$amount' },
        } },
    ]);
    return new Map(rows.map((r) => [spendKey(r._id.cat.toHexString(), r._id.y, r._id.m), r.total]));
}

// Pure: the derived figures for one budget given its spend.
function budgetFigures({ limit, alertThreshold }, spent) {
    const threshold = alertThreshold ?? 80;
    const ratioPct = limit > 0 ? (spent / limit) * 100 : (spent > 0 ? Infinity : 0);
    return {
        spent,
        remaining:       Math.max(0, limit - spent),
        usagePercentage: Number.isFinite(ratioPct) ? Math.round(ratioPct) : 100,
        isOverLimit:     spent > limit,
        isNearLimit:     ratioPct >= threshold && spent > 0,
    };
}

/**
 * Decorate budgets (Mongoose docs or lean objects) with live spend and the
 * category's display fields. Returns plain objects, same order as input.
 */
async function withSpent(userId, budgets) {
    if (!budgets || budgets.length === 0) return [];
    const [spend, cats] = await Promise.all([
        spentByCategoryMonth(userId, budgets),
        Category.find({
            user: userId,
            _id: { $in: budgets.filter((b) => isObjectIdValue(b.category)).map((b) => b.category) },
        }).select('name color icon isArchived').lean(),
    ]);
    const catById = new Map(cats.map((c) => [c._id.toHexString(), c]));

    return budgets.map((b) => {
        const obj = typeof b.toObject === 'function' ? b.toObject() : { ...b };
        const catId = isObjectIdValue(obj.category) ? obj.category.toHexString() : null;
        const cat = (catId && catById.get(catId)) || FALLBACK_CATEGORY;
        const spent = catId ? (spend.get(spendKey(catId, obj.year, obj.month)) || 0) : 0;
        return {
            ...obj,
            categoryName:     cat.name,
            categoryColor:    cat.color,
            categoryIcon:     cat.icon,
            categoryArchived: !!cat.isArchived,
            ...budgetFigures(obj, spent),
        };
    });
}

module.exports = { isObjectIdValue, monthRangeUTC, spentByCategoryMonth, budgetFigures, withSpent };
