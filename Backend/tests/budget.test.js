/**
 * G1 — Budgets are keyed by the user's Category ObjectId (the same id an
 * Expense stores), so "spent" actually matches expenses. Spent is computed
 * on read from the expenses collection, so it cannot drift when an expense
 * is created, edited (amount / category / date) or deleted.
 *
 * Controllers are called directly with mock req/res against in-memory Mongo
 * (same pattern as expense.test.js / category.test.js).
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
});

let mongo, Budget, Category, Expense, budgetCtl, expenseCtl, aiCtl, budgetValidator;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Budget          = require('../models/Budget');
    Category        = require('../models/Category');
    Expense         = require('../models/Expense');
    budgetCtl       = require('../controllers/budgetController');
    expenseCtl      = require('../controllers/expenseController');
    aiCtl           = require('../controllers/aiController');
    budgetValidator = require('../validators/budget');
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

// ── helpers ──────────────────────────────────────────────────────────────────

const makeUser = () => ({ _id: new mongoose.Types.ObjectId(), currency: 'BDT' });
const DATA_KEY = crypto.randomBytes(32);

function mockReq({ user, body = {}, params = {}, query = {} }) {
    return { user, dataKey: DATA_KEY, body, params, query, ip: '127.0.0.1', get: () => 'jest', requestId: 'test' };
}
function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}
const lastStatus = (res) => { const c = res.status.mock.calls.at(-1); return c ? c[0] : 200; };
const lastJson   = (res) => res.json.mock.calls.at(-1)?.[0];

async function makeCategory(user, overrides = {}) {
    return Category.create({
        user: user._id,
        name: overrides.name || `Cat-${Math.random().toString(36).slice(2, 8)}`,
        type: overrides.type || 'expense',
        color: overrides.color || '#F97316',
        icon: overrides.icon || 'utensils',
        ...overrides,
    });
}

// The current UTC month — budgets and spend windows are UTC calendar months.
const NOW = new Date();
const Y = NOW.getUTCFullYear();
const M = NOW.getUTCMonth() + 1;
const inMonth = (day, y = Y, m = M) => new Date(Date.UTC(y, m - 1, day, 12, 0, 0)).toISOString();
const prev = M === 1 ? { y: Y - 1, m: 12 } : { y: Y, m: M - 1 };

async function addExpense(user, category, amount, date = inMonth(10)) {
    const res = mockRes();
    await expenseCtl.createExpense(mockReq({ user, body: { amount, category: category._id.toString(), description: 'x', date } }), res);
    expect(lastStatus(res)).toBe(201);
    return lastJson(res).data;
}

async function createBudget(user, body) {
    const res = mockRes();
    await budgetCtl.createBudget(mockReq({ user, body }), res);
    return res;
}

async function tracking(user, y = Y, m = M) {
    const res = mockRes();
    await budgetCtl.getBudgetTracking(mockReq({ user, params: { year: String(y), month: String(m) } }), res);
    expect(lastStatus(res)).toBe(200);
    return lastJson(res).data;
}

// ── validator ────────────────────────────────────────────────────────────────

describe('budget validators (G1)', () => {
    test('create rejects a legacy category NAME and accepts a Category id', () => {
        expect(budgetValidator.create.safeParse({ category: 'Food', limit: 100, month: 1, year: 2026 }).success).toBe(false);
        expect(budgetValidator.create.safeParse({
            category: new mongoose.Types.ObjectId().toString(), limit: 100, month: 1, year: 2026,
        }).success).toBe(true);
    });

    test('list filter takes a Category id, not a name', () => {
        expect(budgetValidator.list.safeParse({ category: 'Food' }).success).toBe(false);
        expect(budgetValidator.list.safeParse({ category: new mongoose.Types.ObjectId().toString() }).success).toBe(true);
    });
});

// ── create / guard ───────────────────────────────────────────────────────────

describe('POST /budgets (G1)', () => {
    test('creates a budget on the user\'s Category id and counts existing spend', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        await addExpense(user, food, 120);
        await addExpense(user, food, 30);

        const res = await createBudget(user, { category: food._id.toString(), limit: 500, month: M, year: Y });
        expect(lastStatus(res)).toBe(201);
        const b = lastJson(res).data;
        expect(b.category.toString()).toBe(food._id.toString());
        expect(b.spent).toBe(150);
        expect(b.categoryName).toBe('Food');
        expect(b.categoryColor).toBe('#F97316');
        expect(b.categoryIcon).toBe('utensils');
        expect(b.usagePercentage).toBe(30);

        const stored = await Budget.findById(b._id).lean();
        expect(stored.category).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    test('same category + month again upserts (200) instead of duplicating', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        await createBudget(user, { category: food._id.toString(), limit: 500, month: M, year: Y });
        const res = await createBudget(user, { category: food._id.toString(), limit: 800, month: M, year: Y, alertThreshold: 90 });
        expect(lastStatus(res)).toBe(200);
        expect(lastJson(res).data.limit).toBe(800);
        expect(lastJson(res).data.alertThreshold).toBe(90);
        expect(await Budget.countDocuments({ user: user._id })).toBe(1);
    });

    test('guard: another user\'s category → 404; income-only → 400; archived → 400', async () => {
        const a = makeUser();
        const b = makeUser();
        const bCat = await makeCategory(b, { name: 'Food' });
        const income = await makeCategory(a, { name: 'Salary', type: 'income' });
        const archived = await makeCategory(a, { name: 'Old', isArchived: true });

        const r1 = await createBudget(a, { category: bCat._id.toString(), limit: 1, month: M, year: Y });
        expect(lastStatus(r1)).toBe(404);
        const r2 = await createBudget(a, { category: income._id.toString(), limit: 1, month: M, year: Y });
        expect(lastStatus(r2)).toBe(400);
        const r3 = await createBudget(a, { category: archived._id.toString(), limit: 1, month: M, year: Y });
        expect(lastStatus(r3)).toBe(400);
        expect(await Budget.countDocuments({})).toBe(0);
    });

    test('a "both"-type category is accepted', async () => {
        const user = makeUser();
        const both = await makeCategory(user, { name: 'Misc', type: 'both' });
        const res = await createBudget(user, { category: both._id.toString(), limit: 100, month: M, year: Y });
        expect(lastStatus(res)).toBe(201);
    });

    test('unique index on { user, category, month, year }', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        const doc = { user: user._id, category: food._id, limit: 1, month: M, year: Y };
        await Budget.create(doc);
        await expect(Budget.create(doc)).rejects.toMatchObject({ code: 11000 });
    });
});

// ── spent tracks expense create / update / delete ───────────────────────────

describe('budget spent follows expenses (G1)', () => {
    test('tracking reflects expense create, edit (amount, category, date) and delete', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        const travel = await makeCategory(user, { name: 'Transport', color: '#3B82F6', icon: 'car' });
        await createBudget(user, { category: food._id.toString(), limit: 200, month: M, year: Y, alertThreshold: 80 });

        let t = await tracking(user);
        expect(t.budgets).toHaveLength(1);
        expect(t.budgets[0].spent).toBe(0);

        const e1 = await addExpense(user, food, 100);
        await addExpense(user, travel, 999);                         // other category: ignored
        await addExpense(user, food, 777, inMonth(10, prev.y, prev.m)); // other month: ignored

        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(100);
        expect(t.budgets[0].usagePercentage).toBe(50);
        expect(t.budgets[0].remaining).toBe(100);
        expect(t.budgets[0].isNearLimit).toBe(false);
        expect(t.budgets[0].categoryName).toBe('Food');

        // Edit the amount → near limit (≥ 80%).
        let res = mockRes();
        await expenseCtl.updateExpense(mockReq({ user, params: { id: e1._id.toString() }, body: { amount: 170 } }), res);
        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(170);
        expect(t.budgets[0].isNearLimit).toBe(true);
        expect(t.alerts).toHaveLength(1);

        // Second expense → over limit.
        const e2 = await addExpense(user, food, 50);
        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(220);
        expect(t.budgets[0].isOverLimit).toBe(true);

        // Move e2 to another category → leaves this budget.
        res = mockRes();
        await expenseCtl.updateExpense(mockReq({ user, params: { id: e2._id.toString() }, body: { category: travel._id.toString() } }), res);
        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(170);

        // Move e1 to last month → leaves this month's budget.
        res = mockRes();
        await expenseCtl.updateExpense(mockReq({ user, params: { id: e1._id.toString() }, body: { date: inMonth(5, prev.y, prev.m) } }), res);
        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(0);

        // New expense, then delete it.
        const e3 = await addExpense(user, food, 40);
        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(40);
        res = mockRes();
        await expenseCtl.deleteExpense(mockReq({ user, params: { id: e3._id.toString() } }), res);
        t = await tracking(user);
        expect(t.budgets[0].spent).toBe(0);
    });

    test('another user\'s expenses in a same-named category never count', async () => {
        const a = makeUser();
        const b = makeUser();
        const aFood = await makeCategory(a, { name: 'Food' });
        const bFood = await makeCategory(b, { name: 'Food' });
        await createBudget(a, { category: aFood._id.toString(), limit: 100, month: M, year: Y });
        await addExpense(b, bFood, 90);
        const t = await tracking(a);
        expect(t.budgets[0].spent).toBe(0);
    });

    test('GET /budgets list carries computed spent + category display fields', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        await createBudget(user, { category: food._id.toString(), limit: 100, month: M, year: Y });
        await addExpense(user, food, 25);

        const res = mockRes();
        await budgetCtl.getBudgets(mockReq({ user, query: { month: M, year: Y } }), res);
        const rows = lastJson(res).data;
        expect(rows).toHaveLength(1);
        expect(rows[0].spent).toBe(25);
        expect(rows[0].categoryName).toBe('Food');

        const byCat = mockRes();
        await budgetCtl.getBudgets(mockReq({ user, query: { category: food._id.toString() } }), byCat);
        expect(lastJson(byCat).data).toHaveLength(1);
    });

    test('GET /budgets/alerts names the category and uses live spend', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        await createBudget(user, { category: food._id.toString(), limit: 100, month: M, year: Y });
        await addExpense(user, food, 130);

        const res = mockRes();
        await budgetCtl.getBudgetAlerts(mockReq({ user }), res);
        const alerts = lastJson(res).data;
        expect(alerts).toHaveLength(1);
        expect(alerts[0].type).toBe('over_limit');
        expect(alerts[0].category).toBe('Food');
        expect(alerts[0].message).toMatch(/Food/);
        expect(alerts[0].message).toMatch(/30/);
    });
});

// ── get / update / delete / reset ───────────────────────────────────────────

describe('budget get/update/delete/reset (G1)', () => {
    test('get + update return computed spent; IDOR → 404', async () => {
        const user = makeUser();
        const other = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        const created = lastJson(await createBudget(user, { category: food._id.toString(), limit: 100, month: M, year: Y })).data;
        await addExpense(user, food, 60);

        let res = mockRes();
        await budgetCtl.getBudgetById(mockReq({ user, params: { id: created._id.toString() } }), res);
        expect(lastJson(res).data.spent).toBe(60);

        res = mockRes();
        await budgetCtl.updateBudget(mockReq({ user, params: { id: created._id.toString() }, body: { limit: 50 } }), res);
        expect(lastStatus(res)).toBe(200);
        expect(lastJson(res).data.limit).toBe(50);
        expect(lastJson(res).data.isOverLimit).toBe(true);

        res = mockRes();
        await budgetCtl.updateBudget(mockReq({ user: other, params: { id: created._id.toString() }, body: { limit: 1 } }), res);
        expect(lastStatus(res)).toBe(404);

        res = mockRes();
        await budgetCtl.deleteBudget(mockReq({ user: other, params: { id: created._id.toString() } }), res);
        expect(lastStatus(res)).toBe(404);

        res = mockRes();
        await budgetCtl.deleteBudget(mockReq({ user, params: { id: created._id.toString() } }), res);
        expect(lastStatus(res)).toBe(200);
        expect(await Budget.countDocuments({})).toBe(0);
    });

    test('reset copies budgets by category id into the next month (spent recomputed)', async () => {
        const user = makeUser();
        const food = await makeCategory(user, { name: 'Food' });
        await addExpense(user, food, 70, inMonth(3, prev.y, prev.m));
        await createBudget(user, { category: food._id.toString(), limit: 100, month: prev.m, year: prev.y });

        const res = mockRes();
        await budgetCtl.resetBudgets(mockReq({ user, body: { fromMonth: prev.m, fromYear: prev.y, toMonth: M, toYear: Y } }), res);
        expect(lastStatus(res)).toBe(200);
        expect(lastJson(res).data).toHaveLength(1);

        const t = await tracking(user);
        expect(t.budgets).toHaveLength(1);
        expect(t.budgets[0].category.toString()).toBe(food._id.toString());
        expect(t.budgets[0].spent).toBe(0);

        const last = await tracking(user, prev.y, prev.m);
        expect(last.budgets[0].spent).toBe(70);

        // Idempotent: a second copy creates nothing new.
        const again = mockRes();
        await budgetCtl.resetBudgets(mockReq({ user, body: { fromMonth: prev.m, fromYear: prev.y, toMonth: M, toYear: Y } }), again);
        expect(lastJson(again).data).toHaveLength(0);
    });
});

// ── health score consumes budgets by id ─────────────────────────────────────

describe('financial-health-score budget input (G1)', () => {
    test('budget adherence is computed from the budget\'s category id', async () => {
        const user = makeUser();
        // Category NAME deliberately differs from any legacy enum value: the
        // old code mapped Budget.category names → ids and would drop it.
        const cat = await makeCategory(user, { name: 'Groceries & household' });
        await createBudget(user, { category: cat._id.toString(), limit: 100, month: M, year: Y });
        await addExpense(user, cat, 150, new Date().toISOString());

        const res = mockRes();
        await aiCtl.financialHealthScore(mockReq({ user }), res);
        const factor = lastJson(res).data.factors.find((f) => f.label === 'Budget adherence');
        expect(factor.score).toBe(50); // 1 − 50/100 overspend
    });
});
