/**
 * G3 — deleting a goal must NOT rewrite history. Previously the goal and its
 * contributions were hard-deleted, so services/balance.js recomputed every
 * past month as if the money had never been set aside (past closing balances
 * jumped). Required now:
 *   (1) past closing balances are unchanged by the delete;
 *   (2) the goal's unspent contributions return to the wallet as of the
 *       deletion date.
 * The goal is archived (deletedAt + releasedAmount) and hidden from every
 * goal listing; balance.js counts its contributions at their dates and the
 * release at deletedAt.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo, Category, Income, Goal, SavingsEntry, goalCtl, savingsCtl, analyticsCtl, balanceSvc;
let encrypt;

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
});
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category = require('../models/Category'); Income = require('../models/Income');
    Goal = require('../models/Goal'); SavingsEntry = require('../models/SavingsEntry');
    goalCtl = require('../controllers/goalController');
    savingsCtl = require('../controllers/savingsController');
    analyticsCtl = require('../controllers/analyticsController');
    balanceSvc = require('../services/balance');
    ({ encrypt } = require('../utils/encryption'));
    await Promise.all([Category.init(), Income.init(), Goal.init(), SavingsEntry.init()]);
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    if (!mongoose.connection.db) return;
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
});

const DATA_KEY = crypto.randomBytes(32);
const makeUser = () => ({ _id: new mongoose.Types.ObjectId(), currency: 'BDT', lastRolloverYearMonth: null });
const mockReq = (user, { body = {}, params = {}, query = {} } = {}) => ({ user, dataKey: DATA_KEY, body, params, query, ip: '127.0.0.1', get: () => 'jest' });
const mockRes = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const statusOf = (res) => { const c = res.status.mock.calls.at(-1); return c ? c[0] : 200; };
const bodyOf = (res) => res.json.mock.calls.at(-1)[0];

// Server-local month boundaries — the same convention as services/balance.js.
const now = new Date();
const lastMonth = (day) => new Date(now.getFullYear(), now.getMonth() - 1, day, 12);
const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const endOfLastMonth = new Date(startOfThisMonth.getTime() - 1);

async function seed(user) {
    const cat = await Category.create({ user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' });
    await Income.create({ user: user._id, amount: 10_000, category: cat._id, description: await encrypt('s', DATA_KEY), date: lastMonth(10), isRecurring: false, isPostTax: true });
    return Goal.create({
        user: user._id, title: await encrypt('Bike', DATA_KEY), targetAmount: 50_000,
        targetDate: new Date(Date.now() + 200 * 86_400_000),
        contributions: [{ amount: 3_000, date: lastMonth(15) }],
    });
}
// Balance exactly the way the controllers load it (all of the user's goals).
async function balanceAt(user, at) {
    const [goals, entries] = await Promise.all([Goal.find({ user: user._id }), SavingsEntry.find({ user: user._id })]);
    return balanceSvc.getBalance(user._id, goals, entries, at);
}
async function apiBalance(user) {
    const res = mockRes();
    await analyticsCtl.balance(mockReq(user), res);
    return bodyOf(res).data;
}

describe('deleting a goal (G3)', () => {
    test('past closing balances are unchanged; unspent contributions return to the wallet as of today', async () => {
        const user = makeUser();
        const goal = await seed(user);

        const pastBefore = (await balanceAt(user, endOfLastMonth)).available;
        const nowBefore = await apiBalance(user);
        expect(pastBefore).toBe(7_000);
        expect(nowBefore.available).toBe(7_000);

        const res = mockRes();
        await goalCtl.deleteGoal(mockReq(user, { params: { id: goal._id.toString() } }), res);
        expect(statusOf(res)).toBe(200);

        // (1) history unchanged
        expect((await balanceAt(user, endOfLastMonth)).available).toBe(pastBefore);
        const st = mockRes();
        await savingsCtl.rolloverStatus(mockReq(user), st);
        expect(bodyOf(st).data.priorClosing).toBe(7_000);

        expect(bodyOf(res).data.released).toBe(3_000);

        // (2) released into the wallet now, shown as its own line this month
        const after = await apiBalance(user);
        expect(after.available).toBe(10_000);
        expect(after.monthly.carriedForward).toBe(7_000);
        expect(after.monthly.released).toBe(3_000);
        expect(after.monthly.closing).toBe(10_000);
        expect(after.cumulative.released).toBe(3_000);
    });

    test('the goal disappears from every goal view but its history is kept', async () => {
        const user = makeUser();
        const goal = await seed(user);
        const id = goal._id.toString();
        await goalCtl.deleteGoal(mockReq(user, { params: { id } }), mockRes());

        const list = mockRes();
        await goalCtl.getGoals(mockReq(user), list);
        expect(bodyOf(list).data).toHaveLength(0);

        for (const fn of ['getGoalById', 'getGoalProgress', 'deleteGoal']) {
            const r = mockRes();
            await goalCtl[fn](mockReq(user, { params: { id } }), r);
            expect(statusOf(r)).toBe(404);
        }
        const upd = mockRes();
        await goalCtl.updateGoal(mockReq(user, { params: { id }, body: { priority: 3 } }), upd);
        expect(statusOf(upd)).toBe(404);
        const contrib = mockRes();
        await goalCtl.addContribution(mockReq(user, { params: { id }, body: { amount: 1 } }), contrib);
        expect(statusOf(contrib)).toBe(404);
        const alloc = mockRes();
        await goalCtl.allocateContributions(mockReq(user, { body: { allocations: [{ goalId: id, amount: 1 }] } }), alloc);
        expect(statusOf(alloc)).toBe(404);

        const dash = mockRes();
        await goalCtl.getGoalsDashboard(mockReq(user), dash);
        expect(bodyOf(dash).data.totalGoals).toBe(0);
        expect(bodyOf(dash).data.totalSavedAmount).toBe(0);
        const plan = mockRes();
        await goalCtl.getGoalPlan(mockReq(user), plan);
        expect(bodyOf(plan).data.goals).toHaveLength(0);
        const sugg = mockRes();
        await goalCtl.getAllocationSuggestion(mockReq(user), sugg);
        expect(bodyOf(sugg).data.goals).toHaveLength(0);
        const rem = mockRes();
        await goalCtl.getGoalReminders(mockReq(user), rem);
        expect(bodyOf(rem).data).toHaveLength(0);

        const stored = await Goal.findById(goal._id).lean();
        expect(stored).not.toBeNull();
        expect(stored.deletedAt).toBeInstanceOf(Date);
        expect(stored.releasedAmount).toBe(3_000);
        expect(stored.contributions).toHaveLength(1);
    });

    test('released money is spendable: it lifts the cap for new saves', async () => {
        const user = makeUser();
        const goal = await seed(user);
        const other = await Goal.create({ user: user._id, title: await encrypt('Trip', DATA_KEY), targetAmount: 50_000, targetDate: new Date(Date.now() + 99 * 86_400_000) });

        const tooMuch = mockRes();
        await goalCtl.addContribution(mockReq(user, { params: { id: other._id.toString() }, body: { amount: 9_000 } }), tooMuch);
        expect(statusOf(tooMuch)).toBe(400); // only 7,000 available

        await goalCtl.deleteGoal(mockReq(user, { params: { id: goal._id.toString() } }), mockRes());
        const ok = mockRes();
        await goalCtl.addContribution(mockReq(user, { params: { id: other._id.toString() }, body: { amount: 9_000 } }), ok);
        expect(statusOf(ok)).toBe(200);
        expect((await apiBalance(user)).available).toBe(1_000);
    });
});

describe('balance.releasedInWindow (pure)', () => {
    test('counts a deleted goal\'s release only in the window containing deletedAt', () => {
        const d = new Date(2026, 5, 20);
        const goals = [
            { deletedAt: d, releasedAmount: 500, contributions: [{ amount: 500, date: new Date(2026, 4, 1) }] },
            { deletedAt: null, contributions: [{ amount: 100, date: new Date(2026, 5, 2) }] },
        ];
        expect(balanceSvc.releasedInWindow(goals, new Date(2026, 5, 1), new Date(2026, 5, 30))).toBe(500);
        expect(balanceSvc.releasedInWindow(goals, new Date(2026, 4, 1), new Date(2026, 4, 31))).toBe(0);
        expect(balanceSvc.savedInWindow(goals, new Date(2026, 4, 1), new Date(2026, 4, 31))).toBe(500); // history kept
    });
});
