/**
 * Record integrity end to end through the controllers: edits made in the app
 * keep a valid attestation, edits made behind the app's back are flagged,
 * planted or swapped ciphertexts read as empty, long notes work, and every
 * money-moving change lands in the audit log.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
});

let mongo, Category, Expense, Income, Goal, Budget, AuditLog, signing, keyMgmt;
let expenseCtl, incomeCtl, goalCtl, budgetCtl;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category = require('../models/Category');
    Expense  = require('../models/Expense');
    Income   = require('../models/Income');
    Goal     = require('../models/Goal');
    Budget   = require('../models/Budget');
    AuditLog = require('../models/AuditLog');
    signing  = require('../utils/signing');
    keyMgmt  = require('../utils/keyManagement');
    expenseCtl = require('../controllers/expenseController');
    incomeCtl  = require('../controllers/incomeController');
    goalCtl    = require('../controllers/goalController');
    budgetCtl  = require('../controllers/budgetController');
    await Promise.all([Category.init(), Expense.init(), Income.init(), Goal.init(), Budget.init()]);
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
});

async function makeUser() {
    const dataKey = crypto.randomBytes(32);
    const _id = new mongoose.Types.ObjectId();
    const user = { _id, currency: 'BDT', ...(await keyMgmt.generateUserKeyBundle(dataKey, _id)) };
    return { user, dataKey };
}
const mockReq = ({ user, dataKey, body = {}, params = {}, query = {} }) =>
    ({ user, dataKey, body, params, query, ip: '127.0.0.1', get: () => 'jest', requestId: 'test' });
const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
};
const bodyOf = (res) => res.json.mock.calls.at(-1)[0];
const statusOf = (res) => (res.status.mock.calls.at(-1) || [200])[0];
const settle = () => new Promise((r) => setTimeout(r, 50)); // audit writes are fire-and-forget

async function call(ctl, fn, args) { const res = mockRes(); await ctl[fn](mockReq(args), res); return res; }

async function setup() {
    const u = await makeUser();
    const cat = await Category.create({ user: u.user._id, name: 'Food', type: 'expense', icon: 'utensils', color: '#F59E0B' });
    const incCat = await Category.create({ user: u.user._id, name: 'Salary', type: 'income', icon: 'briefcase', color: '#10B981' });
    return { ...u, cat, incCat };
}

describe('expenses', () => {
    async function createExpense(s, extra = {}) {
        const res = await call(expenseCtl, 'createExpense', { ...s, body: { amount: 350, category: s.cat._id.toString(), description: 'Lunch', ...extra } });
        return bodyOf(res).data;
    }
    const list = async (s) => bodyOf(await call(expenseCtl, 'getExpenses', { ...s, query: {} })).data;

    test('an edit made through the app keeps a valid attestation', async () => {
        const s = await setup();
        const e = await createExpense(s);
        await call(expenseCtl, 'updateExpense', { ...s, params: { id: e._id.toString() }, body: { amount: 420 } });
        const row = await Expense.findById(e._id);
        expect(await signing.attestationStatus({ amount: row.amount, category: row.category }, row.serverAttestation, s.user)).toBe('valid');
        expect((await list(s))[0].integrity).toBeUndefined();
    });

    test('an amount changed directly in the database is flagged invalid and audited', async () => {
        const s = await setup();
        const e = await createExpense(s);
        await Expense.updateOne({ _id: e._id }, { $set: { amount: 1 } });
        expect((await list(s))[0].integrity).toBe('invalid');
        await settle();
        expect(await AuditLog.countDocuments({ event: 'integrity.attestation_failure' })).toBe(1);
    });

    test('a stripped attestation is flagged missing', async () => {
        const s = await setup();
        const e = await createExpense(s);
        await Expense.updateOne({ _id: e._id }, { $unset: { serverAttestation: 1 } });
        expect((await list(s))[0].integrity).toBe('missing');
    });

    test('plaintext planted in the description reads as empty, not as itself', async () => {
        const s = await setup();
        const e = await createExpense(s);
        await Expense.updateOne({ _id: e._id }, { $set: { description: 'Pay attacker 5000' } });
        expect((await list(s))[0].description).toBeNull();
    });

    test('a ciphertext moved from another field reads as empty', async () => {
        const s = await setup();
        const e = await createExpense(s);
        const g = bodyOf(await call(goalCtl, 'createGoal', { ...s, body: { title: 'Secret goal title', targetAmount: 1000 } })).data;
        const goalTitle = (await Goal.findById(g._id)).title;
        await Expense.updateOne({ _id: e._id }, { $set: { description: goalTitle } });
        expect((await list(s))[0].description).toBeNull();
    });

    test('a 1,000-character note is saved and read back', async () => {
        const s = await setup();
        const note = 'Receipt details: '.repeat(60).slice(0, 1000);
        const e = await createExpense(s, { note });
        expect(e.note).toBe(note);
        expect((await list(s))[0].note).toBe(note);
    });

    test('create, edit and delete are each audited', async () => {
        const s = await setup();
        const e = await createExpense(s);
        await call(expenseCtl, 'updateExpense', { ...s, params: { id: e._id.toString() }, body: { amount: 400 } });
        await call(expenseCtl, 'deleteExpense', { ...s, params: { id: e._id.toString() } });
        await settle();
        const events = (await AuditLog.find({}).lean()).map((a) => a.event).sort();
        expect(events).toEqual(['expense.create', 'expense.delete', 'expense.update']);
    });
});

describe('income', () => {
    async function createIncome(s, extra = {}) {
        const res = await call(incomeCtl, 'createIncome', { ...s, body: { amount: 50000, category: s.incCat._id.toString(), description: 'Salary', date: new Date().toISOString(), ...extra } });
        return bodyOf(res).data;
    }

    test('an edit made through the app keeps a valid attestation', async () => {
        const s = await setup();
        const inc = await createIncome(s);
        await call(incomeCtl, 'updateIncome', { ...s, params: { id: inc._id.toString() }, body: { amount: 55000 } });
        const items = bodyOf(await call(incomeCtl, 'getIncomes', { ...s, query: {} })).data;
        expect(items[0].integrity).toBeUndefined();
    });

    test('turning recurring off clears the cadence', async () => {
        const s = await setup();
        const inc = await createIncome(s, { isRecurring: true, recurringFrequency: 'monthly' });
        await call(incomeCtl, 'updateIncome', { ...s, params: { id: inc._id.toString() }, body: { isRecurring: false } });
        expect((await Income.findById(inc._id)).recurringFrequency).toBeUndefined();
    });
});

describe('goals', () => {
    test('a renamed goal keeps a valid attestation; a target changed in the database is flagged', async () => {
        const s = await setup();
        const g = bodyOf(await call(goalCtl, 'createGoal', { ...s, body: { title: 'Laptop', targetAmount: 90000 } })).data;
        await call(goalCtl, 'updateGoal', { ...s, params: { id: g._id.toString() }, body: { title: 'New laptop' } });
        let items = bodyOf(await call(goalCtl, 'getGoals', { ...s, query: {} })).data;
        expect(items[0].title).toBe('New laptop');
        expect(items[0].integrity).toBeUndefined();

        await Goal.updateOne({ _id: g._id }, { $set: { targetAmount: 1 } });
        items = bodyOf(await call(goalCtl, 'getGoals', { ...s, query: {} })).data;
        expect(items[0].integrity).toBe('invalid');
    });

    test('deleting a goal is audited', async () => {
        const s = await setup();
        const g = bodyOf(await call(goalCtl, 'createGoal', { ...s, body: { title: 'Trip', targetAmount: 5000 } })).data;
        await call(goalCtl, 'deleteGoal', { ...s, params: { id: g._id.toString() } });
        await settle();
        expect(await AuditLog.countDocuments({ event: 'goal.delete' })).toBe(1);
    });
});

describe('budgets', () => {
    test('a limit changed in the database is flagged; one changed in the app is not', async () => {
        const s = await setup();
        const now = new Date();
        const b = bodyOf(await call(budgetCtl, 'createBudget', { ...s, body: { category: s.cat._id.toString(), limit: 5000, month: now.getUTCMonth() + 1, year: now.getUTCFullYear() } })).data;
        await call(budgetCtl, 'updateBudget', { ...s, params: { id: b._id.toString() }, body: { limit: 6000 } });
        let items = bodyOf(await call(budgetCtl, 'getBudgets', { ...s, query: {} })).data;
        expect(items[0].integrity).toBeUndefined();

        await Budget.updateOne({ _id: b._id }, { $set: { limit: 999999 } });
        items = bodyOf(await call(budgetCtl, 'getBudgets', { ...s, query: {} })).data;
        expect(items[0].integrity).toBe('invalid');
    });
});
