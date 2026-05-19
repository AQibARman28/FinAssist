/**
 * scripts/migrate-expense-categories.js — one-shot migration for Part 3.
 *
 * Why
 * ───
 * Before Part 3, Expense.category was a String enum (one of 8 fixed names).
 * Part 3 changed it to an ObjectId reference to the new user-owned Category
 * collection. Without this migration, existing expense rows still hold the
 * old enum string and Mongoose's schema cast on read fails (the string
 * "Food" is not a valid 24-hex ObjectId).
 *
 * Idempotency
 * ───────────
 * Reads and writes happen through the raw Mongo driver
 * (Model.collection.*) to see the actual stored types regardless of what
 * the current schema expects. Per row:
 *   - typeof category === 'string'                          → migrate
 *   - already an ObjectId (BSON type)                       → unchanged
 *   - anything else (null, number, missing)                 → skipped
 * Re-running after a successful run finds zero strings, so every row
 * counts as unchanged and the script reports updated=0.
 *
 * Per-user logic
 * ──────────────
 *   1. If user has zero Category rows, seed the 10 defaults (Part-2
 *      registration would normally seed these; this catches users
 *      created before Part 2).
 *   2. Walk this user's expenses. For each row whose category is still a
 *      String, find a matching Category by case-insensitive name + type ∈
 *      {'expense','both'}.
 *   3. If no matching Category exists, create one with
 *      { color: '#6B7280', icon: 'more', sortOrder: 50, type: 'expense' }.
 *   4. Rewrite the expense row so category points to the matched
 *      Category's _id.
 *
 * Usage
 * ─────
 *     node Backend/scripts/migrate-expense-categories.js --dry-run
 *     node Backend/scripts/migrate-expense-categories.js
 *
 * Deploy ordering
 * ───────────────
 * Roll the Part-3 build (which contains the new schema + categoryGuard)
 * BEFORE running this script. Old expenses become unreadable through
 * Mongoose between deploy and migration; new writes work fine because
 * they always carry a Category ObjectId from the validator.
 *
 * Failure semantics
 * ─────────────────
 * - Per-user errors are logged and the loop continues — one bad user
 *   shouldn't block the rest.
 * - Per-expense errors are logged, the row counts as skipped, and the
 *   loop continues.
 * - Exit code is non-zero if any row was skipped, so CI / deploy
 *   pipelines can decide whether to alert.
 */

const dotenv = require('dotenv');
const path = require('node:path');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (typeof process.env.MONGO_URI !== 'string' || !process.env.MONGO_URI) {
    console.error('migrate-expense-categories: MONGO_URI must be set in .env');
    process.exit(2);
}
if (typeof process.env.MASTER_ENCRYPTION_KEY !== 'string' || process.env.MASTER_ENCRYPTION_KEY.length !== 64) {
    console.error('migrate-expense-categories: MASTER_ENCRYPTION_KEY must be set to 64 hex chars in .env');
    process.exit(2);
}

const Category = require('../models/Category');
const Expense = require('../models/Expense');
const { seedDefaultCategoriesForUser } = require('../utils/defaultCategories');

const DRY_RUN = process.argv.includes('--dry-run');

// New Categories created by the migration get the brief-mandated styling.
const FALLBACK_CATEGORY_DEFAULTS = Object.freeze({
    color:     '#6B7280',
    icon:      'more',
    sortOrder: 50,
    type:      'expense',
});

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Identify the raw stored category type for one expense row. Returns
// 'string' (migrate), 'objectId' (already migrated), or 'other' (skip).
function categoryKind(value) {
    if (typeof value === 'string') return 'string';
    if (value && typeof value === 'object'
        && (value._bsontype === 'ObjectID' || typeof value.toHexString === 'function')) {
        return 'objectId';
    }
    return 'other';
}

async function migrateOneUser(userId) {
    const r = { scanned: 0, updated: 0, unchanged: 0, skipped: 0, categoriesCreated: 0 };

    // (1) Seed defaults if the user has none yet. In dry-run we don't
    // write; we just predict the 10 inserts in the categoriesCreated total.
    const catCount = await Category.countDocuments({ user: userId });
    if (catCount === 0) {
        if (DRY_RUN) {
            r.categoriesCreated += 10;
        } else {
            try {
                await seedDefaultCategoriesForUser(userId);
                r.categoriesCreated += 10;
            } catch (err) {
                console.error(`migrate: user ${userId} — failed to seed defaults: ${err.message}`);
                // Continue anyway; the per-expense step may still find or
                // create individual categories.
            }
        }
    }

    // (2) Walk this user's expenses raw — Mongoose would fail to cast the
    // legacy String category against the new ObjectId schema.
    const cursor = Expense.collection.find({ user: userId });

    // Per-user cache: lowercase name → Category._id. Lets multiple expense
    // rows with the same legacy String name reuse one Category lookup /
    // creation.
    const categoryByName = new Map();

    for await (const expense of cursor) {
        r.scanned++;
        const kind = categoryKind(expense.category);

        if (kind === 'objectId') {
            r.unchanged++;
            continue;
        }
        if (kind === 'other') {
            console.warn(`migrate: expense ${expense._id} has unexpected category type (${typeof expense.category}); skipping`);
            r.skipped++;
            continue;
        }

        const stringValue = expense.category;
        const key = stringValue.toLowerCase().trim();
        if (!key) {
            // Empty string — nothing to match against. Skip.
            r.skipped++;
            continue;
        }

        let mappedId = categoryByName.get(key);

        if (!mappedId) {
            // Look for an existing Category on this user that matches the
            // legacy name case-insensitively, accepting type 'expense' or
            // 'both'. (Income-only categories don't match — the legacy
            // values were all expense-side enums.)
            const existing = await Category.findOne({
                user: userId,
                name: { $regex: `^${escapeRegex(stringValue)}$`, $options: 'i' },
                type: { $in: ['expense', 'both'] },
            });

            if (existing) {
                mappedId = existing._id;
            } else if (DRY_RUN) {
                mappedId = `WOULD-CREATE:${stringValue}`;     // placeholder; sentinel only
                r.categoriesCreated++;
            } else {
                try {
                    const created = await Category.create({
                        user: userId,
                        name: stringValue,                    // preserve original casing
                        ...FALLBACK_CATEGORY_DEFAULTS,
                    });
                    mappedId = created._id;
                    r.categoriesCreated++;
                } catch (err) {
                    // Could be a unique-index collision if two distinct
                    // strings collapse to the same case-insensitive name
                    // (e.g. "Food" and "food"). Re-fetch in that case so
                    // subsequent expenses with the same key still resolve.
                    if (err?.code === 11000) {
                        const reread = await Category.findOne({
                            user: userId,
                            name: { $regex: `^${escapeRegex(stringValue)}$`, $options: 'i' },
                            type: { $in: ['expense', 'both'] },
                        });
                        if (reread) mappedId = reread._id;
                    }
                    if (!mappedId) {
                        console.error(`migrate: user ${userId} — failed to create category "${stringValue}": ${err.message}`);
                        r.skipped++;
                        continue;
                    }
                }
            }

            categoryByName.set(key, mappedId);
        }

        if (DRY_RUN) {
            r.updated++;
            continue;
        }

        try {
            await Expense.collection.updateOne(
                { _id: expense._id },
                { $set: { category: mappedId } },
            );
            r.updated++;
        } catch (err) {
            console.error(`migrate: failed to update expense ${expense._id}: ${err.message}`);
            r.skipped++;
        }
    }

    return r;
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`migrate-expense-categories: connected (dry-run=${DRY_RUN})`);

    // Distinct user ids straight from the expenses collection — users with
    // no expenses don't need migration. This also handles orphan-userId
    // expense rows (rare; would have been broken even before Part 3).
    const userIds = await Expense.collection.distinct('user', {});
    console.log(`migrate-expense-categories: ${userIds.length} user(s) have expenses`);

    const aggregate = { scanned: 0, updated: 0, unchanged: 0, skipped: 0, categoriesCreated: 0 };

    for (const userId of userIds) {
        try {
            const result = await migrateOneUser(userId);
            for (const k of Object.keys(aggregate)) aggregate[k] += result[k];

            // Only echo per-user lines when something interesting happened.
            // Idempotent re-runs would otherwise spam one no-op line per user.
            if (result.updated || result.categoriesCreated || result.skipped) {
                console.log(`  user ${userId.toString().slice(-6)}  scanned=${result.scanned} updated=${result.updated} unchanged=${result.unchanged} skipped=${result.skipped} categoriesCreated=${result.categoriesCreated}`);
            }
        } catch (err) {
            console.error(`migrate: user ${userId} — failed: ${err.message}`);
        }
    }

    await mongoose.disconnect();

    console.log(
        `migrate-expense-categories: scanned=${aggregate.scanned} ` +
        `updated=${aggregate.updated} unchanged=${aggregate.unchanged} ` +
        `skipped=${aggregate.skipped} categoriesCreated=${aggregate.categoriesCreated}` +
        (DRY_RUN ? ' (dry-run, no writes)' : '')
    );

    if (aggregate.skipped > 0) process.exit(1);
}

main().catch((err) => {
    console.error('migrate-expense-categories: fatal error:', err);
    process.exit(3);
});
