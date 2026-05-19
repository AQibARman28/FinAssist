/**
 * categoryGuard.assertCategoryOwnedAndTyped
 *
 * One call to validate, all at once, that a category referenced by an
 * incoming expense or (Part 5) income payload:
 *   (a) exists,
 *   (b) belongs to the requesting user (IDOR fence — cross-user lookups
 *       return 404 with the same "not found" message used elsewhere,
 *       which doesn't leak existence),
 *   (c) is not archived (no new records against a category the user has
 *       removed from their active list),
 *   (d) is compatible with the expected transaction type. An 'expense'
 *       category and a 'both' category are both acceptable for an
 *       expense; same for income on the income side.
 *
 * Return shape mirrors the totpGuard pattern from Phase 4: a single
 * object the controller maps directly to res.status/res.json. No throws
 * for the validation branches — those are user-correctable. Genuine
 * errors (bad ObjectId, Mongo connectivity) still propagate as exceptions.
 *
 *   { ok: true,  category }
 *   { ok: false, status: 404, message: 'Category not found' }
 *   { ok: false, status: 400, message: 'Category is archived' }
 *   { ok: false, status: 400, message: 'Category type mismatch' }
 */

const Category = require('../models/Category');

async function assertCategoryOwnedAndTyped(userId, categoryId, expectedType) {
    const cat = await Category.findOne({ _id: categoryId, user: userId });
    if (!cat) {
        return { ok: false, status: 404, message: 'Category not found' };
    }
    if (cat.isArchived) {
        return { ok: false, status: 400, message: 'Category is archived' };
    }
    if (cat.type !== expectedType && cat.type !== 'both') {
        return { ok: false, status: 400, message: 'Category type mismatch' };
    }
    return { ok: true, category: cat };
}

module.exports = { assertCategoryOwnedAndTyped };
