/**
 * G1 — scripts/migrate-budget-categories.js converts legacy Budget rows whose
 * `category` is an enum NAME ("Food") into the user's Category ObjectId.
 * Dry-run by default; `apply: true` writes. Idempotent.
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
});

let mongo, Budget, Category, Expense, migrate, budgetCtl;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Budget    = require('../models/Budget');
    Category  = require('../models/Category');
    Expense   = require('../models/Expense');
    budgetCtl = require('../controllers/budgetController');
    ({ migrateBudgetCategories: migrate } = require('../scripts/migrate-budget-categories'));
    await Promise.all([Budget.init(), Category.init(), Expense.init()]);
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

const quiet = () => {};
const oid = () => new mongoose.Types.ObjectId();
const legacy = (user, category, extra = {}) => Budget.collection.insertOne({
    user, category, limit: 100, spent: 42, month: 10, year: 2026, alertThreshold: 80, isActive: true, ...extra,
});
const cat = (user, name, type = 'expense', extra = {}) =>
    Category.create({ user, name, type, color: '#123456', icon: 'star', ...extra });

describe('migrate-budget-categories', () => {
    test('dry-run reports what it would do and writes nothing', async () => {
        const u = oid();
        await cat(u, 'food');
        await legacy(u, 'Food');
        await legacy(u, 'Education');

        const r = await migrate({ apply: false, log: quiet });
        expect(r.updated).toBe(2);
        expect(r.categoriesCreated).toBe(1);   // Education
        expect(r.skipped).toBe(0);

        const rows = await Budget.collection.find({ user: u }).toArray();
        expect(rows.every((b) => typeof b.category === 'string')).toBe(true);
        expect(await Category.countDocuments({ user: u })).toBe(1);
    });

    test('--apply maps names case-insensitively to expense|both categories, creating missing ones', async () => {
        const u = oid();
        const other = oid();
        const food = await cat(u, 'food');                    // case differs
        const transport = await cat(u, 'Transport', 'both');  // 'both' is acceptable
        await cat(u, 'Bills', 'income');                      // income-only must NOT match
        await cat(other, 'Education');                        // another user's must NOT match

        await legacy(u, 'Food');
        await legacy(u, 'Transport');
        await legacy(u, 'Bills');
        await legacy(u, 'Education');

        const r = await migrate({ apply: true, log: quiet });
        expect(r.updated).toBe(4);
        expect(r.categoriesCreated).toBe(2); // Bills (expense) + Education
        expect(r.skipped).toBe(0);

        const rows = await Budget.collection.find({ user: u }).toArray();
        const byLegacy = Object.fromEntries(rows.map((b) => [b.legacyCategory, b]));
        expect(rows.every((b) => b.category instanceof mongoose.Types.ObjectId)).toBe(true);
        expect(rows.every((b) => !('spent' in b))).toBe(true); // stale stored spend dropped
        expect(byLegacy.Food.category.toString()).toBe(food._id.toString());
        expect(byLegacy.Transport.category.toString()).toBe(transport._id.toString());

        const bills = await Category.findById(byLegacy.Bills.category).lean();
        expect(bills.type).toBe('expense');
        expect(bills.user.toString()).toBe(u.toString());
        expect(bills.icon).toBe('home');          // styled like the seeded default
        const edu = await Category.findById(byLegacy.Education.category).lean();
        expect(edu.user.toString()).toBe(u.toString());
        expect(edu.name).toBe('Education');
    });

    test('after migration, spend is attributed through the category id', async () => {
        const u = oid();
        const food = await cat(u, 'Food');
        await legacy(u, 'Food');
        await migrate({ apply: true, log: quiet });
        await Expense.create({ user: u, amount: 30, category: food._id, description: 'enc', date: new Date(Date.UTC(2026, 9, 5, 12)) });

        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        await budgetCtl.getBudgetTracking({ user: { _id: u }, params: { year: '2026', month: '10' } }, res);
        const t = res.json.mock.calls.at(-1)[0].data;
        expect(t.budgets).toHaveLength(1);
        expect(t.budgets[0].spent).toBe(30);
        expect(t.budgets[0].categoryName).toBe('Food');
    });

    test('idempotent: a second --apply changes nothing', async () => {
        const u = oid();
        await legacy(u, 'Food');
        await legacy(u, 'Shopping');
        await migrate({ apply: true, log: quiet });

        const r2 = await migrate({ apply: true, log: quiet });
        expect(r2.updated).toBe(0);
        expect(r2.unchanged).toBe(2);
        expect(r2.categoriesCreated).toBe(0);
        expect(await Category.countDocuments({ user: u })).toBe(2);
    });

    test('a migrated row\'s name-signed serverAttestation still verifies (no tamper warning)', async () => {
        const { generateUserKeyBundle } = require('../utils/keyManagement');
        const { signRecord } = require('../utils/signing');
        const dataKey = crypto.randomBytes(32);
        const user = { _id: oid(), ...(await generateUserKeyBundle(dataKey)) };
        const sig = await signRecord({ category: 'Food', limit: 100, month: 10, year: 2026 }, user, dataKey);
        await legacy(user._id, 'Food', { serverAttestation: sig });
        await migrate({ apply: true, log: quiet });

        // Records whose attestation doesn't verify come back flagged with
        // `integrity` (utils/integrity.js) rather than only logging a warning.
        const req = { user, dataKey, query: {}, ip: '127.0.0.1', get: () => 'jest' };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        await budgetCtl.getBudgets(req, res);
        const rows = res.json.mock.calls.at(-1)[0].data;
        expect(rows).toHaveLength(1);
        expect(rows[0].integrity).toBeUndefined();

        // ...while a genuinely tampered limit is still flagged.
        await Budget.collection.updateOne({ user: user._id }, { $set: { limit: 999 } });
        await budgetCtl.getBudgets(req, res);
        expect(res.json.mock.calls.at(-1)[0].data[0].integrity).toBe('invalid');
    });

    test('a legacy row whose slot is already taken by a migrated budget is reported, not merged', async () => {
        const u = oid();
        const food = await cat(u, 'Food');
        await Budget.create({ user: u, category: food._id, limit: 300, month: 10, year: 2026 });
        await legacy(u, 'Food');

        const dry = await migrate({ apply: false, log: quiet });
        expect(dry.conflicts).toBe(1);

        const r = await migrate({ apply: true, log: quiet });
        expect(r.conflicts).toBe(1);
        expect(r.updated).toBe(0);
        const leftover = await Budget.collection.findOne({ user: u, category: 'Food' });
        expect(leftover).not.toBeNull(); // untouched for a human to resolve
    });
});
