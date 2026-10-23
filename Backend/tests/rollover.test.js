/**
 * G2 — POST /wallet/rollover must be idempotent per month. Previously it never
 * checked lastRolloverYearMonth, so every "save" deposited last month's closing
 * balance into savings again. Now the month is claimed atomically
 * (findOneAndUpdate on the user with a lastRolloverYearMonth != current
 * condition) before anything is written, so a repeat — or a parallel
 * duplicate — gets 409 and records nothing.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo, User, Category, Income, SavingsEntry, ctl;
let masterEncrypt, generateDataKey, encrypt;

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
});
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User = require('../models/User'); Category = require('../models/Category');
    Income = require('../models/Income'); SavingsEntry = require('../models/SavingsEntry');
    ctl = require('../controllers/savingsController');
    ({ masterEncrypt, generateDataKey, encrypt } = require('../utils/encryption'));
    await Promise.all([User.init(), Category.init(), Income.init(), SavingsEntry.init()]);
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    if (!mongoose.connection.db) return;
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
});

const DATA_KEY = crypto.randomBytes(32);
async function persistUser(extra = {}) {
    return User.create({
        name: 'x', email: 'x', emailHash: `eh-${Math.random().toString(36).slice(2, 12)}`,
        password: 'pw-placeholder', currency: 'BDT', encryptedDataKey: await masterEncrypt(generateDataKey()), ...extra,
    });
}
// Income dated mid-previous-month → last month closes with that surplus.
async function seedLastMonthIncome(user, amount) {
    const now = new Date();
    const cat = await Category.create({ user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' });
    await Income.create({
        user: user._id, amount, category: cat._id, description: await encrypt('s', DATA_KEY),
        date: new Date(now.getFullYear(), now.getMonth() - 1, 15, 12), isRecurring: false, isPostTax: true,
    });
}
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const mockReq = (user, body = {}) => ({ user, body, query: {}, params: {}, ip: '127.0.0.1', get: () => 'jest' });
const mockRes = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const statusOf = (res) => { const c = res.status.mock.calls.at(-1); return c ? c[0] : 200; };

describe('POST /wallet/rollover is idempotent per month (G2)', () => {
    test('save twice → second is 409 and only one rollover deposit exists', async () => {
        const user = await persistUser();
        await seedLastMonthIncome(user, 8_000);

        const r1 = mockRes();
        await ctl.rollover(mockReq(user, { action: 'save' }), r1);
        expect(statusOf(r1)).toBe(200);

        // Same (stale) req.user object, as a double-click would send.
        const r2 = mockRes();
        await ctl.rollover(mockReq(user, { action: 'save' }), r2);
        expect(statusOf(r2)).toBe(409);
        expect(r2.json.mock.calls.at(-1)[0].success).toBe(false);

        const entries = await SavingsEntry.find({ user: user._id, source: 'rollover' });
        expect(entries).toHaveLength(1);
        expect(entries[0].amount).toBe(8_000);
        expect((await User.findById(user._id)).lastRolloverYearMonth).toBe(ym(new Date()));
    });

    test('5 parallel saves → exactly one applies', async () => {
        const user = await persistUser();
        await seedLastMonthIncome(user, 5_000);

        const statuses = await Promise.all(Array.from({ length: 5 }, async () => {
            const res = mockRes();
            await ctl.rollover(mockReq(user, { action: 'save' }), res);
            return statusOf(res);
        }));
        expect(statuses.filter((s) => s === 200)).toHaveLength(1);
        expect(statuses.filter((s) => s === 409)).toHaveLength(4);
        expect(await SavingsEntry.countDocuments({ user: user._id, source: 'rollover' })).toBe(1);
    });

    test('carry, then save in the same month → 409, nothing deposited', async () => {
        const user = await persistUser();
        await seedLastMonthIncome(user, 3_000);

        const r1 = mockRes();
        await ctl.rollover(mockReq(user, { action: 'carry' }), r1);
        expect(statusOf(r1)).toBe(200);
        const r2 = mockRes();
        await ctl.rollover(mockReq(user, { action: 'save' }), r2);
        expect(statusOf(r2)).toBe(409);
        expect(await SavingsEntry.countDocuments({ user: user._id })).toBe(0);
    });

    test('a month handled previously does not block this month', async () => {
        const user = await persistUser({ lastRolloverYearMonth: '2000-01' });
        await seedLastMonthIncome(user, 2_000);
        const res = mockRes();
        await ctl.rollover(mockReq(user, { action: 'save' }), res);
        expect(statusOf(res)).toBe(200);
        expect(await SavingsEntry.countDocuments({ user: user._id, source: 'rollover' })).toBe(1);
    });
});
