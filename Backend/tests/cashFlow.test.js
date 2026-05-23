/**
 * GOAL-1 Phase 1 — cash-flow / surplus service.
 * Pure arithmetic (summarizeCashFlow) tested without a DB; getCashFlow tested
 * against in-memory Mongo with a known income+expense seed.
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { summarizeCashFlow } = require('../services/cashFlow');

// ── Pure arithmetic ──────────────────────────────────────────────────────────
describe('summarizeCashFlow (pure)', () => {
    test('90-day window → surplus + monthly averages', () => {
        const r = summarizeCashFlow({ income: 90_000, expenses: 30_000, windowDays: 90 });
        expect(r).toEqual({
            income: 90_000, expenses: 30_000, surplus: 60_000,
            monthlyAvgIncome: 30_000, monthlyAvgExpenses: 10_000, monthlySurplus: 20_000,
        });
    });
    test('zero income → negative surplus, no NaN', () => {
        const r = summarizeCashFlow({ income: 0, expenses: 30_000, windowDays: 90 });
        expect(r.surplus).toBe(-30_000);
        expect(r.monthlyAvgIncome).toBe(0);
        expect(r.monthlySurplus).toBe(-10_000);
    });
    test('zero expenses → full surplus', () => {
        const r = summarizeCashFlow({ income: 90_000, expenses: 0, windowDays: 90 });
        expect(r.surplus).toBe(90_000);
        expect(r.monthlySurplus).toBe(30_000);
    });
    test('zero window → no divide-by-zero', () => {
        const r = summarizeCashFlow({ income: 100, expenses: 50, windowDays: 0 });
        expect(r.monthlyAvgIncome).toBe(0);
        expect(r.monthlyAvgExpenses).toBe(0);
        expect(r.monthlySurplus).toBe(0);
        expect(Number.isFinite(r.monthlySurplus)).toBe(true);
    });
});

// ── getCashFlow against in-memory Mongo ──────────────────────────────────────
describe('getCashFlow (DB)', () => {
    let mongo;
    let User, Category, Income, Expense, getCashFlow;
    let masterEncrypt, generateDataKey, encrypt, generateUserKeyBundle;

    beforeAll(() => {
        process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
        process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
        process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
    });

    beforeAll(async () => {
        mongo = await MongoMemoryServer.create();
        await mongoose.connect(mongo.getUri());
        User     = require('../models/User');
        Category = require('../models/Category');
        Income   = require('../models/Income');
        Expense  = require('../models/Expense');
        ({ getCashFlow } = require('../services/cashFlow'));
        ({ masterEncrypt, generateDataKey, encrypt } = require('../utils/encryption'));
        ({ generateUserKeyBundle } = require('../utils/keyManagement'));
        await Category.init();
        await Income.init();
        await Expense.init();
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

    async function persistUser() {
        const raw = generateDataKey();
        const encDataKey = await masterEncrypt(raw);
        const dataKey = Buffer.from(raw, 'hex');
        const bundle = await generateUserKeyBundle(dataKey);
        const user = await User.create({
            name: 'x', email: 'x', emailHash: `eh-${Math.random().toString(36).slice(2, 14)}`,
            password: 'pw-placeholder', encryptedDataKey: encDataKey, ...bundle,
        });
        return { user, dataKey };
    }
    const makeCat = (user, type, name) => Category.create({ user: user._id, name, type, color: '#10B981', icon: 'briefcase' });
    function daysAgo(n) {
        const d = new Date();
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n, 12, 0, 0, 0));
    }

    test('seed income + expenses in window → totals + monthly averages', async () => {
        const { user, dataKey } = await persistUser();
        const inc = await makeCat(user, 'income', 'Salary');
        const exp = await makeCat(user, 'expense', 'Food');
        await Income.create({ user: user._id, amount: 90_000, category: inc._id, description: await encrypt('s', dataKey), date: daysAgo(10), isRecurring: false, isPostTax: true });
        await Expense.create({ user: user._id, amount: 20_000, category: exp._id, description: await encrypt('e', dataKey), date: daysAgo(20) });
        await Expense.create({ user: user._id, amount: 10_000, category: exp._id, description: await encrypt('e', dataKey), date: daysAgo(40) });

        const r = await getCashFlow(user._id, 90);
        expect(r.income).toBe(90_000);
        expect(r.expenses).toBe(30_000);
        expect(r.surplus).toBe(60_000);
        expect(r.monthlyAvgIncome).toBe(30_000);
        expect(r.monthlyAvgExpenses).toBe(10_000);
        expect(r.monthlySurplus).toBe(20_000);
    });

    test('no income → zero income, negative surplus', async () => {
        const { user, dataKey } = await persistUser();
        const exp = await makeCat(user, 'expense', 'Food');
        await Expense.create({ user: user._id, amount: 15_000, category: exp._id, description: await encrypt('e', dataKey), date: daysAgo(5) });
        const r = await getCashFlow(user._id, 90);
        expect(r.income).toBe(0);
        expect(r.expenses).toBe(15_000);
        expect(r.surplus).toBe(-15_000);
        expect(r.monthlySurplus).toBe(-5_000);
    });

    test('no data → all zero, no NaN', async () => {
        const { user } = await persistUser();
        const r = await getCashFlow(user._id, 90);
        expect(r).toMatchObject({ income: 0, expenses: 0, surplus: 0, monthlySurplus: 0 });
    });
});
