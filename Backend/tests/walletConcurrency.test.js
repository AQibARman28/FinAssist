/**
 * G4 — wallet-capped writes are check-then-write: savings deposit/withdraw and
 * goal contribute/allocate read the balance, then insert. Without a guard,
 * parallel requests all pass the check and overdraw. These tests fire the
 * requests concurrently and assert the balance never goes negative and that
 * exactly the affordable number succeed.
 *
 * mongodb-memory-server is a standalone server (no multi-document
 * transactions), which is also why the guard is a per-user lock document
 * updated atomically with findOneAndUpdate (services/walletLock.js).
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo, Category, Income, Goal, SavingsEntry, savingsCtl, goalCtl, walletLock;
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
    savingsCtl = require('../controllers/savingsController');
    goalCtl = require('../controllers/goalController');
    try { walletLock = require('../services/walletLock'); } catch { walletLock = undefined; }
    ({ encrypt } = require('../utils/encryption'));
    await Promise.all([Category.init(), Income.init(), SavingsEntry.init(), Goal.init()]);
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    if (!mongoose.connection.db) return;
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
});

const DATA_KEY = crypto.randomBytes(32);
const makeUser = () => ({ _id: new mongoose.Types.ObjectId(), currency: 'BDT' });
const mockReq = (user, body = {}, params = {}) => ({ user, dataKey: DATA_KEY, body, params, query: {}, ip: '127.0.0.1', get: () => 'jest' });
const mockRes = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const statusOf = (res) => { const c = res.status.mock.calls.at(-1); return c ? c[0] : 200; };

async function seedIncome(user, amount) {
    const cat = await Category.create({ user: user._id, name: `Salary-${Math.random()}`, type: 'income', color: '#10B981', icon: 'briefcase' });
    await Income.create({ user: user._id, amount, category: cat._id, description: await encrypt('s', DATA_KEY), date: new Date(Date.now() - 60_000), isRecurring: false, isPostTax: true });
}
async function makeGoal(user, targetAmount = 1_000_000) {
    return Goal.create({ user: user._id, title: await encrypt('Goal', DATA_KEY), targetAmount, targetDate: new Date(Date.now() + 365 * 86_400_000) });
}
async function wallet(user) {
    const res = mockRes();
    await savingsCtl.getSavings(mockReq(user), res);
    return res.json.mock.calls.at(-1)[0].data; // { balance (savings), wallet }
}
async function fire(n, fn) {
    const results = await Promise.all(Array.from({ length: n }, async () => { const res = mockRes(); await fn(res); return statusOf(res); }));
    return { ok: results.filter((s) => s === 200 || s === 201).length, rejected: results.filter((s) => s === 400).length, statuses: results };
}

describe('walletLock (unit)', () => {
    test('second holder waits, then fails with a 409-style WalletBusyError', async () => {
        const uid = new mongoose.Types.ObjectId();
        const token = await walletLock.acquire(uid);
        await expect(walletLock.acquire(uid, { waitMs: 60 })).rejects.toMatchObject({ name: 'WalletBusyError', status: 409 });
        await walletLock.release(uid, token);
        const again = await walletLock.acquire(uid, { waitMs: 60 });
        await walletLock.release(uid, again);
    });

    test('an expired lock (crashed holder) can be taken over', async () => {
        const uid = new mongoose.Types.ObjectId();
        await walletLock.acquire(uid, { ttlMs: 1 });
        await new Promise((r) => setTimeout(r, 10));
        const t = await walletLock.acquire(uid, { waitMs: 60 });
        expect(typeof t).toBe('string');
        await walletLock.release(uid, t);
    });

    test('locks are per user', async () => {
        const a = new mongoose.Types.ObjectId();
        const b = new mongoose.Types.ObjectId();
        const ta = await walletLock.acquire(a);
        const tb = await walletLock.acquire(b, { waitMs: 60 });
        await walletLock.release(a, ta);
        await walletLock.release(b, tb);
    });

    test('withWalletLock releases even when the body throws', async () => {
        const uid = new mongoose.Types.ObjectId();
        await expect(walletLock.withWalletLock(uid, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        const t = await walletLock.acquire(uid, { waitMs: 60 });
        await walletLock.release(uid, t);
    });
});

describe('parallel wallet writes never overdraw (G4)', () => {
    test('10 parallel savings withdrawals of 1,000 from 4,000 → exactly 4 succeed, savings never negative', async () => {
        const user = makeUser();
        await seedIncome(user, 10_000);
        await savingsCtl.depositSavings(mockReq(user, { amount: 4_000 }), mockRes());

        const r = await fire(10, (res) => savingsCtl.withdrawSavings(mockReq(user, { amount: 1_000 }), res));
        expect(r.ok).toBe(4);
        expect(r.rejected).toBe(6);

        const w = await wallet(user);
        expect(w.balance).toBe(0);
        expect(w.wallet).toBe(10_000);
        expect(await SavingsEntry.countDocuments({ user: user._id, direction: 'withdraw' })).toBe(4);
    });

    test('10 parallel savings deposits of 3,000 from a 10,000 wallet → exactly 3 succeed', async () => {
        const user = makeUser();
        await seedIncome(user, 10_000);

        const r = await fire(10, (res) => savingsCtl.depositSavings(mockReq(user, { amount: 3_000 }), res));
        expect(r.ok).toBe(3);

        const w = await wallet(user);
        expect(w.wallet).toBe(1_000);
        expect(w.wallet).toBeGreaterThanOrEqual(0);
        expect(w.balance).toBe(9_000);
    });

    test('10 parallel contributions of 3,000 to one goal from a 10,000 wallet → exactly 3 recorded', async () => {
        const user = makeUser();
        await seedIncome(user, 10_000);
        const goal = await makeGoal(user);

        const r = await fire(10, (res) => goalCtl.addContribution(mockReq(user, { amount: 3_000 }, { id: goal._id.toString() }), res));
        expect(r.ok).toBe(3);

        const fresh = await Goal.findById(goal._id);
        expect(fresh.contributions).toHaveLength(3);
        expect(fresh.currentAmount).toBe(9_000);
        expect((await wallet(user)).wallet).toBe(1_000);
    });

    test('6 parallel 2-goal allocations of 2,000 from a 5,000 wallet → exactly 2 recorded', async () => {
        const user = makeUser();
        await seedIncome(user, 5_000);
        const g1 = await makeGoal(user);
        const g2 = await makeGoal(user);
        const body = { allocations: [{ goalId: g1._id.toString(), amount: 1_000 }, { goalId: g2._id.toString(), amount: 1_000 }] };

        const r = await fire(6, (res) => goalCtl.allocateContributions(mockReq(user, body), res));
        expect(r.ok).toBe(2);

        const w = await wallet(user);
        expect(w.wallet).toBe(1_000);
        expect((await Goal.findById(g1._id)).currentAmount).toBe(2_000);
        expect((await Goal.findById(g2._id)).currentAmount).toBe(2_000);
    });

    test('deposits and goal contributions racing for the same wallet share one guard', async () => {
        const user = makeUser();
        await seedIncome(user, 5_000);
        const goal = await makeGoal(user);

        const [d, c] = await Promise.all([
            fire(5, (res) => savingsCtl.depositSavings(mockReq(user, { amount: 1_500 }), res)),
            fire(5, (res) => goalCtl.addContribution(mockReq(user, { amount: 1_500 }, { id: goal._id.toString() }), res)),
        ]);
        expect(d.ok + c.ok).toBe(3);
        const w = await wallet(user);
        expect(w.wallet).toBe(500);
    });

    test('a held lock surfaces as 409 (not a silent overdraw or a 500)', async () => {
        const user = makeUser();
        await seedIncome(user, 5_000);
        const prev = walletLock.settings.waitMs;
        walletLock.settings.waitMs = 50;
        const token = await walletLock.acquire(user._id);
        try {
            const res = mockRes();
            await savingsCtl.depositSavings(mockReq(user, { amount: 100 }), res);
            expect(statusOf(res)).toBe(409);
            expect(res.json.mock.calls.at(-1)[0].message).toMatch(/try again/i);
            expect(await SavingsEntry.countDocuments({ user: user._id })).toBe(0);
        } finally {
            walletLock.settings.waitMs = prev;
            await walletLock.release(user._id, token);
        }
    });
});
