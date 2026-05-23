/**
 * Part-7 analytics + AI tests.
 *
 * Two layers:
 *   1. Helpers in utils/finance.js — pure-ish DB aggregations.
 *   2. Controller endpoints (expense-income-ratio + financial-health-score)
 *      called directly with mock req/res, against in-memory Mongo.
 *
 * The brief's three required cases sit inside `describe('expense-income-ratio')`
 * and `describe('financial-health-score')`. Additional helper / boundary
 * tests are extras worth pinning.
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
let User, Category, Income, Expense;
let analyticsCtl, aiCtl;
let finance;
let masterEncrypt, generateDataKey, encrypt, generateUserKeyBundle;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User      = require('../models/User');
    Category  = require('../models/Category');
    Income    = require('../models/Income');
    Expense   = require('../models/Expense');
    analyticsCtl = require('../controllers/analyticsController');
    aiCtl        = require('../controllers/aiController');
    finance      = require('../utils/finance');
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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function persistUser() {
    const raw = generateDataKey();
    const encDataKey = await masterEncrypt(raw);
    const dataKey = Buffer.from(raw, 'hex');
    const bundle  = await generateUserKeyBundle(dataKey);
    const user = await User.create({
        name: 'x', email: 'x', emailHash: `eh-${Math.random().toString(36).slice(2, 14)}`,
        password: 'pw-placeholder', encryptedDataKey: encDataKey, ...bundle,
    });
    return { user, dataKey };
}

async function makeCategory(user, type, name) {
    return Category.create({
        user: user._id, name, type, color: '#10B981', icon: 'briefcase',
    });
}

async function plantRecurringIncome({ user, dataKey, category, amount, anchorDate, frequency = 'monthly' }) {
    return Income.create({
        user: user._id,
        amount, category: category._id,
        description: await encrypt('Salary', dataKey),
        date: anchorDate,
        isRecurring: true,
        recurringFrequency: frequency,
        isPostTax: true,
    });
}

async function plantExpense({ user, dataKey, category, amount, date }) {
    return Expense.create({
        user: user._id,
        amount, category: category._id,
        description: await encrypt('expense', dataKey),
        date,
    });
}

function mockReq(user, dataKey) {
    return {
        user,
        dataKey,
        body: {}, params: {}, query: {},
        ip:  '127.0.0.1',
        get: () => 'jest',
        requestId: 'test',
    };
}
function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}
function lastJson(res) {
    const c = res.json.mock.calls[res.json.mock.calls.length - 1];
    return c ? c[0] : null;
}

// UTC throughout — matches the controllers' and recurring.js's convention.
// A local-time anchor at month-start lands in the PREVIOUS UTC month for
// any TZ east of UTC, which would shift the projected occurrence count.
const startOfCurrentMonth = () => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 0, 0, 0, 0));
};
const someDateThisMonth = () => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 15, 12, 0, 0, 0));
};

// ── finance.js helpers ──────────────────────────────────────────────────────

describe('utils/finance', () => {
    test('monthlyEquivalentIncome: monthly template at amount 80000 → 80000', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user, 'income', 'Salary');
        await plantRecurringIncome({
            user, dataKey, category: cat, amount: 80000,
            anchorDate: startOfCurrentMonth(), frequency: 'monthly',
        });
        expect(await finance.monthlyEquivalentIncome(user._id)).toBe(80000);
    });

    test('monthlyEquivalentIncome: weekly template at 1000 → 52000/12 ≈ 4333.33', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user, 'income', 'Side gig');
        await plantRecurringIncome({
            user, dataKey, category: cat, amount: 1000,
            anchorDate: startOfCurrentMonth(), frequency: 'weekly',
        });
        const m = await finance.monthlyEquivalentIncome(user._id);
        expect(m).toBeCloseTo(52000 / 12, 5);
    });

    test('monthlyEquivalentIncome: yearly template at 60000 → 5000', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user, 'income', 'Bonus');
        await plantRecurringIncome({
            user, dataKey, category: cat, amount: 60000,
            anchorDate: startOfCurrentMonth(), frequency: 'yearly',
        });
        expect(await finance.monthlyEquivalentIncome(user._id)).toBe(5000);
    });

    test('incomeTotalForPeriod: counts the template anchor in window', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user, 'income', 'Salary');
        const now = new Date();
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1, 0, 0, 0, 0));
        const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        await plantRecurringIncome({
            user, dataKey, category: cat, amount: 80000,
            anchorDate: start, frequency: 'monthly',
        });
        expect(await finance.incomeTotalForPeriod(user._id, start, end)).toBe(80000);
    });

    test('incomeTotalForPeriod: returns 0 for a user with no income', async () => {
        const { user } = await persistUser();
        const now = new Date();
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1, 0, 0, 0, 0));
        const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        expect(await finance.incomeTotalForPeriod(user._id, start, end)).toBe(0);
    });
});

// ── expense-income-ratio ────────────────────────────────────────────────────

describe('GET /api/analytics/expense-income-ratio', () => {
    test('no income on file → ratio: null (not 0, not NaN, no crash)', async () => {
        const { user, dataKey } = await persistUser();
        const expCat = await makeCategory(user, 'expense', 'Food');
        await plantExpense({ user, dataKey, category: expCat, amount: 60_000, date: someDateThisMonth() });

        const res = mockRes();
        await analyticsCtl.expenseIncomeRatio(mockReq(user, dataKey), res);

        const data = lastJson(res).data;
        expect(data.totalIncome).toBe(0);
        expect(data.totalExpense).toBe(60_000);
        expect(data.ratio).toBeNull();
    });

    test('acceptance case: monthly Salary 80,000 + 60,000 expenses → ratio 0.75', async () => {
        const { user, dataKey } = await persistUser();
        const incCat = await makeCategory(user, 'income', 'Salary');
        const expCat = await makeCategory(user, 'expense', 'Food');
        await plantRecurringIncome({
            user, dataKey, category: incCat, amount: 80_000,
            anchorDate: startOfCurrentMonth(), frequency: 'monthly',
        });
        await plantExpense({ user, dataKey, category: expCat, amount: 60_000, date: someDateThisMonth() });

        const res = mockRes();
        await analyticsCtl.expenseIncomeRatio(mockReq(user, dataKey), res);

        const data = lastJson(res).data;
        expect(data.totalIncome).toBe(80_000);
        expect(data.totalExpense).toBe(60_000);
        expect(data.ratio).toBeCloseTo(0.75, 6);
    });

    test('both zero → totalIncome=0, totalExpense=0, ratio:null (no division-by-zero)', async () => {
        const { user, dataKey } = await persistUser();
        const res = mockRes();
        await analyticsCtl.expenseIncomeRatio(mockReq(user, dataKey), res);
        const data = lastJson(res).data;
        expect(data.totalIncome).toBe(0);
        expect(data.totalExpense).toBe(0);
        expect(data.ratio).toBeNull();
    });
});

// ── financial-health-score ──────────────────────────────────────────────────

describe('GET /api/ai/financial-health-score (HS-1 multi-factor)', () => {
    async function plantOneOffIncome({ user, dataKey, category, amount, date }) {
        return Income.create({
            user: user._id, amount, category: category._id,
            description: await encrypt('income', dataKey), date,
            isRecurring: false, isPostTax: true,
        });
    }

    test('brand-new account (no data) → building status, never a number', async () => {
        const { user, dataKey } = await persistUser();
        const res = mockRes();
        await aiCtl.financialHealthScore(mockReq(user, dataKey), res);
        const d = lastJson(res).data;
        expect(d.status).toBe('building');
        expect(d.score).toBeNull();
        expect(Array.isArray(d.factors)).toBe(true);
    });

    test('REGRESSION: one-off income + expenses scores on real factors, not a stuck 20', async () => {
        const { user, dataKey } = await persistUser();
        const inc = await makeCategory(user, 'income', 'Salary');
        const exp = await makeCategory(user, 'expense', 'Food');
        // One-off (non-recurring) income — the OLD endpoint counted only
        // recurring templates, so this user used to be stuck at 20.
        await plantOneOffIncome({ user, dataKey, category: inc, amount: 80_000, date: someDateThisMonth() });
        await plantExpense({ user, dataKey, category: exp, amount: 60_000, date: someDateThisMonth() });

        const res = mockRes();
        await aiCtl.financialHealthScore(mockReq(user, dataKey), res);
        const d = lastJson(res).data;
        expect(d.status).toBe('ok');
        expect(typeof d.score).toBe('number');
        expect(d.score).not.toBe(20);
        expect(d.factors.find((f) => f.label === 'Savings rate').score).not.toBeNull();
        expect(d.band).toEqual(expect.any(String));
        expect(d.message).toEqual(expect.any(String));
    });

    test('recurring income also counts; returns the full factor breakdown shape', async () => {
        const { user, dataKey } = await persistUser();
        const inc = await makeCategory(user, 'income', 'Salary');
        const exp = await makeCategory(user, 'expense', 'Food');
        await plantRecurringIncome({ user, dataKey, category: inc, amount: 80_000, anchorDate: startOfCurrentMonth() });
        await plantExpense({ user, dataKey, category: exp, amount: 30_000, date: someDateThisMonth() });

        const res = mockRes();
        await aiCtl.financialHealthScore(mockReq(user, dataKey), res);
        const d = lastJson(res).data;
        expect(d.status).toBe('ok');
        expect(d.factors).toHaveLength(5);
        expect(d.contributor).toEqual(expect.objectContaining({ label: expect.any(String), score: expect.any(Number) }));
        expect(d.detractor).toEqual(expect.objectContaining({ label: expect.any(String), score: expect.any(Number) }));
    });
});

// ── budget-optimization sanity (category name resolved, monthlyIncome present) ──

describe('GET /api/ai/budget-optimization', () => {
    test('returns category NAME (not ObjectId) and monthlyIncome alongside totals', async () => {
        const { user, dataKey } = await persistUser();
        const incCat = await makeCategory(user, 'income', 'Salary');
        const food   = await makeCategory(user, 'expense', 'Food');
        await plantRecurringIncome({ user, dataKey, category: incCat, amount: 80_000, anchorDate: startOfCurrentMonth() });
        await plantExpense({ user, dataKey, category: food, amount: 500, date: someDateThisMonth() });

        const res = mockRes();
        await aiCtl.budgetOptimization(mockReq(user, dataKey), res);
        const d = lastJson(res).data;
        expect(d.monthlyIncome).toBe(80_000);
        expect(d.categories.length).toBeGreaterThan(0);
        expect(d.categories[0].category).toBe('Food');
    });
});
