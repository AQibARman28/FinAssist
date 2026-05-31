/**
 * Standalone Savings account + Wallet integration.
 * Pure helper (savingsNet) tested without a DB; deposit/withdraw caps and the
 * month-rollover decision exercised through the real controller + in-memory Mongo.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { savingsNet } = require('../services/balance');

describe('savingsNet (pure)', () => {
    const from = new Date(2026, 5, 1), to = new Date(2026, 5, 30, 23, 59, 59);
    const entries = [
        { amount: 1000, direction: 'deposit',  date: new Date(2026, 5, 5) },
        { amount: 300,  direction: 'withdraw', date: new Date(2026, 5, 10) },
        { amount: 500,  direction: 'deposit',  date: new Date(2026, 4, 20) }, // out of window
    ];
    test('net = deposits − withdrawals within window', () => {
        expect(savingsNet(entries, from, to)).toBe(700); // 1000 − 300
    });
    test('open-ended (all time) sums everything', () => {
        expect(savingsNet(entries, new Date(0), null)).toBe(1200); // 1000 − 300 + 500
    });
    test('empty → 0', () => {
        expect(savingsNet([], from, to)).toBe(0);
    });
});

describe('savings controller (DB)', () => {
    let mongo, User, Category, Income, SavingsEntry, ctl;
    let masterEncrypt, generateDataKey, encrypt, generateUserKeyBundle;

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
        ({ generateUserKeyBundle } = require('../utils/keyManagement'));
        await Promise.all([Category.init(), Income.init(), SavingsEntry.init()]);
    }, 60_000);
    afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
    beforeEach(async () => {
        if (!mongoose.connection.db) return;
        const colls = await mongoose.connection.db.listCollections().toArray();
        await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
    });

    async function persistUser() {
        const raw = generateDataKey();
        const bundle = await generateUserKeyBundle(Buffer.from(raw, 'hex'));
        return User.create({
            name: 'x', email: 'x', emailHash: `eh-${Math.random().toString(36).slice(2, 12)}`,
            password: 'pw-placeholder', currency: 'BDT', encryptedDataKey: await masterEncrypt(raw), ...bundle,
        });
    }
    async function seedIncome(user, amount, date) {
        const dataKey = Buffer.from(await require('../utils/encryption').masterDecrypt(user.encryptedDataKey), 'hex');
        const cat = await Category.create({ user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' });
        await Income.create({ user: user._id, amount, category: cat._id, description: await encrypt('s', dataKey), date, isRecurring: false, isPostTax: true });
    }
    const mockReq = (user, body = {}) => ({ user, body, query: {}, params: {}, ip: '127.0.0.1', get: () => 'jest' });
    const mockRes = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };

    test('deposit within wallet → savings rises, wallet drops; over-deposit blocked', async () => {
        const user = await persistUser();
        await seedIncome(user, 10_000, new Date());

        const r1 = mockRes();
        await ctl.depositSavings(mockReq(user, { amount: 3_000 }), r1);
        expect(r1.status).toHaveBeenCalledWith(201);
        const after = r1.json.mock.calls.at(-1)[0].data;
        expect(after.balance).toBe(3_000);   // savings
        expect(after.wallet).toBe(7_000);    // 10k − 3k

        // Over-deposit (more than the 7k left) is blocked.
        const r2 = mockRes();
        await ctl.depositSavings(mockReq(user, { amount: 9_000 }), r2);
        expect(r2.status).toHaveBeenCalledWith(400);
        expect(await SavingsEntry.countDocuments({ user: user._id })).toBe(1);
    });

    test('withdraw returns money to the wallet; over-withdraw blocked', async () => {
        const user = await persistUser();
        await seedIncome(user, 10_000, new Date());
        await ctl.depositSavings(mockReq(user, { amount: 4_000 }), mockRes());

        const r1 = mockRes();
        await ctl.withdrawSavings(mockReq(user, { amount: 1_500 }), r1);
        const after = r1.json.mock.calls.at(-1)[0].data;
        expect(after.balance).toBe(2_500); // 4000 − 1500
        expect(after.wallet).toBe(7_500);  // 10000 − 2500

        const r2 = mockRes();
        await ctl.withdrawSavings(mockReq(user, { amount: 5_000 }), r2);
        expect(r2.status).toHaveBeenCalledWith(400);
    });
});
