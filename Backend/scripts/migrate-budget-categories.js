/**
 * scripts/migrate-budget-categories.js — one-shot migration for G1.
 *
 * Why
 * ───
 * Budget.category used to be a String enum of 8 names ("Food", "Bills", …)
 * while Expense.category is an ObjectId into the user's Category collection,
 * so budget spend never matched an expense. Budget.category is now an
 * ObjectId ref to Category. This script rewrites each legacy row's category
 * NAME into that user's Category _id.
 *
 * Per legacy row (category stored as a string)
 * ────────────────────────────────────────────
 *   1. Find the user's Category whose name matches case-insensitively and
 *      whose type is 'expense' or 'both' (income-only never matches;
 *      un-archived preferred over archived).
 *   2. If none exists, create it (type 'expense'; styled like the seeded
 *      default of the same name when there is one, grey/"more" otherwise).
 *   3. $set category to that id, keep the original string in
 *      `legacyCategory` (the row's serverAttestation was signed over the name;
 *      the controller verifies against it), and $unset the old stored `spent`
 *      (spend is computed on read now).
 *
 *   If the user already has a budget for the same (category, month, year)
 *   slot, the legacy row is NOT merged — it is reported as a conflict and
 *   left untouched for a human to resolve (exit code 1).
 *
 * Rows whose category is already an ObjectId are counted as unchanged (any
 * stale `spent` field on them is removed on --apply). Re-running after a
 * successful --apply reports updated=0.
 *
 * Usage
 * ─────
 *     npm run migrate:budget-categories               # dry run (default)
 *     npm run migrate:budget-categories -- --apply    # write
 *
 * Reads/writes go through the raw driver (Budget.collection) so legacy string
 * values are seen as stored, regardless of the current schema.
 */

const path = require('node:path');
const mongoose = require('mongoose');

const Budget = require('../models/Budget');
const Category = require('../models/Category');
const { DEFAULT_CATEGORIES } = require('../utils/defaultCategories');

const FALLBACK_STYLE = Object.freeze({ color: '#6B7280', icon: 'more' });
const DEFAULT_STYLE_BY_NAME = new Map(
    DEFAULT_CATEGORIES.filter((c) => c.type === 'expense')
        .map((c) => [c.name.toLowerCase(), { color: c.color, icon: c.icon }]),
);

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isObjectIdValue(v) {
    return v != null && typeof v === 'object' && typeof v.toHexString === 'function';
}

function findExpenseCategoryByName(userId, name) {
    return Category.findOne({
        user: userId,
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
        type: { $in: ['expense', 'both'] },
    }).sort({ isArchived: 1, createdAt: 1 }).lean();
}

async function migrateOneUser(userId, { apply, log }) {
    const r = { scanned: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, categoriesCreated: 0, spentRemoved: 0 };

    const rows = await Budget.collection.find({ user: userId }).toArray();

    // Slots already occupied by ObjectId budgets (+ ones this run fills).
    const slotKey = (catId, b) => `${catId}|${b.month}|${b.year}`;
    const taken = new Set(rows.filter((b) => isObjectIdValue(b.category)).map((b) => slotKey(b.category.toHexString(), b)));

    // lowercase legacy name → category id (string) or a dry-run placeholder.
    const resolved = new Map();

    for (const b of rows) {
        r.scanned++;

        if (isObjectIdValue(b.category)) {
            r.unchanged++;
            if ('spent' in b) {
                r.spentRemoved++;
                if (apply) await Budget.collection.updateOne({ _id: b._id }, { $unset: { spent: '' } });
            }
            continue;
        }
        if (typeof b.category !== 'string' || !b.category.trim()) {
            log(`  budget ${b._id}: unexpected category value (${JSON.stringify(b.category)}); skipping`);
            r.skipped++;
            continue;
        }

        const name = b.category.trim();
        const key = name.toLowerCase();
        let catId = resolved.get(key);

        if (!catId) {
            const existing = await findExpenseCategoryByName(userId, name);
            if (existing) {
                catId = existing._id.toHexString();
            } else if (!apply) {
                catId = `would-create:${key}`;
                r.categoriesCreated++;
            } else {
                const style = DEFAULT_STYLE_BY_NAME.get(key) || FALLBACK_STYLE;
                try {
                    const created = await Category.create({ user: userId, name, type: 'expense', sortOrder: 50, ...style });
                    catId = created._id.toHexString();
                    r.categoriesCreated++;
                } catch (err) {
                    // Lost a race / unique {user,name,type} collision — re-read.
                    const reread = err?.code === 11000 ? await findExpenseCategoryByName(userId, name) : null;
                    if (!reread) {
                        log(`  budget ${b._id}: could not create category "${name}": ${err.message}`);
                        r.skipped++;
                        continue;
                    }
                    catId = reread._id.toHexString();
                }
            }
            resolved.set(key, catId);
        }

        const slot = slotKey(catId, b);
        if (taken.has(slot)) {
            log(`  budget ${b._id}: user already has a "${name}" budget for ${b.month}/${b.year}; left as-is (conflict)`);
            r.conflicts++;
            continue;
        }

        if (!apply) {
            taken.add(slot);
            r.updated++;
            continue;
        }

        try {
            await Budget.collection.updateOne(
                { _id: b._id, category: b.category },
                {
                    $set:   { category: new mongoose.Types.ObjectId(catId), legacyCategory: b.category },
                    $unset: { spent: '' },
                },
            );
            taken.add(slot);
            r.updated++;
        } catch (err) {
            if (err?.code === 11000) {
                log(`  budget ${b._id}: slot ${name} ${b.month}/${b.year} already taken; left as-is (conflict)`);
                r.conflicts++;
            } else {
                log(`  budget ${b._id}: update failed: ${err.message}`);
                r.skipped++;
            }
        }
    }
    return r;
}

/**
 * Migrate every user's budgets. Returns aggregate counts.
 * @param {{ apply?: boolean, log?: (msg: string) => void }} opts
 */
async function migrateBudgetCategories({ apply = false, log = console.log } = {}) {
    const totals = { users: 0, scanned: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, categoriesCreated: 0, spentRemoved: 0 };
    const userIds = await Budget.collection.distinct('user', {});

    for (const userId of userIds) {
        try {
            const r = await migrateOneUser(userId, { apply, log });
            totals.users++;
            for (const k of Object.keys(r)) totals[k] += r[k];
            if (r.updated || r.categoriesCreated || r.skipped || r.conflicts) {
                log(`  user …${String(userId).slice(-6)} scanned=${r.scanned} updated=${r.updated} unchanged=${r.unchanged} ` +
                    `conflicts=${r.conflicts} skipped=${r.skipped} categoriesCreated=${r.categoriesCreated}`);
            }
        } catch (err) {
            log(`  user ${userId}: failed: ${err.message}`);
            totals.skipped++;
        }
    }
    return totals;
}

async function main() {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    if (typeof process.env.MONGO_URI !== 'string' || !process.env.MONGO_URI) {
        console.error('migrate-budget-categories: MONGO_URI must be set in .env');
        process.exit(2);
    }
    const apply = process.argv.includes('--apply');

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`migrate-budget-categories: connected (${apply ? 'APPLY — writing' : 'dry run — no writes; pass --apply to write'})`);

    const t = await migrateBudgetCategories({ apply, log: console.log });
    await mongoose.disconnect();

    console.log(
        `migrate-budget-categories: users=${t.users} scanned=${t.scanned} updated=${t.updated} ` +
        `unchanged=${t.unchanged} conflicts=${t.conflicts} skipped=${t.skipped} ` +
        `categoriesCreated=${t.categoriesCreated} staleSpentRemoved=${t.spentRemoved}` +
        (apply ? '' : ' (dry run)'),
    );
    if (t.skipped > 0 || t.conflicts > 0) process.exit(1);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('migrate-budget-categories: fatal error:', err);
        process.exit(3);
    });
}

module.exports = { migrateBudgetCategories, migrateOneUser };
