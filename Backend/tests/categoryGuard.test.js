/**
 * Tests for utils/categoryGuard.assertCategoryOwnedAndTyped.
 *
 * Covers the four return shapes documented in the helper:
 *   - ok: true               — category exists, owned, active, type compatible
 *   - 404 'Category not found' — wrong id OR cross-user (existence not leaked)
 *   - 400 'Category is archived'
 *   - 400 'Category type mismatch'
 *
 * Plus the 'both'-type compatibility shortcut and a few sanity edges
 * (non-existent id, bogus id string).
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
});

let mongo;
let Category;
let assertCategoryOwnedAndTyped;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category = require('../models/Category');
    ({ assertCategoryOwnedAndTyped } = require('../utils/categoryGuard'));
}, 60_000);

afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});

beforeEach(async () => {
    if (!mongoose.connection.db) return;
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
});

function userId() { return new mongoose.Types.ObjectId(); }

const baseCategory = {
    name: 'Food', color: '#aabbcc', icon: 'utensils',
};

describe('assertCategoryOwnedAndTyped — happy paths', () => {
    test('matching type → ok: true with the category attached', async () => {
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'expense' });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'expense');
        expect(r.ok).toBe(true);
        expect(r.category._id.toString()).toBe(cat._id.toString());
    });

    test("type 'both' is acceptable for an expense expectation", async () => {
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'both' });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'expense');
        expect(r.ok).toBe(true);
    });

    test("type 'both' is acceptable for an income expectation", async () => {
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'both' });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'income');
        expect(r.ok).toBe(true);
    });
});

describe('assertCategoryOwnedAndTyped — failure paths', () => {
    test('category does not exist → 404 not found', async () => {
        const r = await assertCategoryOwnedAndTyped(userId(), new mongoose.Types.ObjectId(), 'expense');
        expect(r).toEqual({ ok: false, status: 404, message: 'Category not found' });
    });

    test('category exists but belongs to ANOTHER user → 404 (existence not leaked)', async () => {
        const owner    = userId();
        const attacker = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'expense' });
        const r = await assertCategoryOwnedAndTyped(attacker, cat._id, 'expense');
        expect(r).toEqual({ ok: false, status: 404, message: 'Category not found' });
    });

    test('archived category → 400 archived', async () => {
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'expense', isArchived: true });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'expense');
        expect(r).toEqual({ ok: false, status: 400, message: 'Category is archived' });
    });

    test('income-only category used for an expense → 400 type mismatch', async () => {
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'income' });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'expense');
        expect(r).toEqual({ ok: false, status: 400, message: 'Category type mismatch' });
    });

    test('expense-only category used for income → 400 type mismatch', async () => {
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'expense' });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'income');
        expect(r).toEqual({ ok: false, status: 400, message: 'Category type mismatch' });
    });

    test('archived AND type-mismatched → archive check wins (deterministic order)', async () => {
        // If a category is both archived and wrong-type, callers should see
        // the archived error first. Pinning this so future refactors of the
        // helper don't accidentally swap the order.
        const owner = userId();
        const cat = await Category.create({ ...baseCategory, user: owner, type: 'income', isArchived: true });
        const r = await assertCategoryOwnedAndTyped(owner, cat._id, 'expense');
        expect(r.message).toBe('Category is archived');
    });
});
