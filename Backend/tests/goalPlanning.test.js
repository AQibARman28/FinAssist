/**
 * GOAL-1 Phase 2 — feasibility + forecast. Pure-service boundary tests, plus a
 * GET /api/goals/plan integration check against in-memory Mongo.
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { planGoal, planGoals, STATUS } = require('../services/goalPlanning');

const DAY = 86_400_000;
const MONTH = 30 * DAY;
const NOW = Date.UTC(2026, 4, 24, 12, 0, 0); // fixed reference

// Build N monthly contributions of `amount` ending `recentDays` ago.
function monthlyContribs(amount, count, latestDaysAgo = 5) {
    return Array.from({ length: count }, (_, i) => ({ amount, date: new Date(NOW - (latestDaysAgo * DAY) - i * MONTH) }));
}

describe('planGoal (pure)', () => {
    test('on pace → On track', () => {
        const r = planGoal(
            { id: 'g1', targetAmount: 12_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: monthlyContribs(1000, 3) },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.requiredMonthly).toBe(1000);   // 12000 / 12mo
        expect(r.actualMonthlyRate).toBe(1000); // 3000 / 3
        expect(r.status).toBe(STATUS.ON_TRACK);
    });

    test('no contributions → forecast/rate null (no history)', () => {
        const r = planGoal(
            { id: 'g2', targetAmount: 12_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: [] },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.actualMonthlyRate).toBeNull();
        expect(r.forecastMonths).toBeNull();
        expect(r.forecastDelta).toBeNull();
        // rate 0 vs required 1000 → not feasible at current rate
        expect(r.status).toBe(STATUS.NOT_FEASIBLE);
    });

    test('half the needed rate → At risk', () => {
        const r = planGoal(
            { id: 'g3', targetAmount: 12_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: monthlyContribs(500, 3) },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.requiredMonthly).toBe(1000);
        expect(r.actualMonthlyRate).toBe(500); // 50% of required
        expect(r.status).toBe(STATUS.AT_RISK);
    });

    test('requiredMonthly exceeds surplus → Not feasible', () => {
        const r = planGoal(
            { id: 'g4', targetAmount: 60_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: monthlyContribs(5000, 3) },
            { monthlySurplus: 2000, now: NOW }, // required 5000 > surplus 2000
        );
        expect(r.requiredMonthly).toBe(5000);
        expect(r.status).toBe(STATUS.NOT_FEASIBLE);
    });

    test('undated goal handled without NaN', () => {
        const r = planGoal(
            { id: 'g5', targetAmount: 10_000, currentAmount: 2000, targetDate: null, contributions: [] },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.requiredMonthly).toBeNull();
        expect(r.forecastDelta).toBeNull();
        expect(r.status).toBe(STATUS.ON_TRACK); // has progress
        expect(Number.isNaN(r.requiredMonthly)).toBe(false);
    });

    test('forecast delta computed (late) for under-rate goal', () => {
        // need 1000/mo for 12mo; contributing ~600/mo → ~20mo to finish → ~8mo late
        const r = planGoal(
            { id: 'g6', targetAmount: 12_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: monthlyContribs(600, 3) },
            { monthlySurplus: 5000, now: NOW },
        );
        expect(r.forecastMonths).toBe(20); // 12000 / 600
        expect(r.forecastDelta).toBe(8);   // 20 - 12
    });
});

describe('planGoals portfolio', () => {
    test('Σ requiredMonthly > surplus → overcommitted', () => {
        const goals = [
            { id: 'a', targetAmount: 18_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: [] }, // 1500/mo
            { id: 'b', targetAmount: 18_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: [] }, // 1500/mo
        ];
        const { portfolio } = planGoals({ goals, monthlySurplus: 2000, now: NOW });
        expect(portfolio.totalRequired).toBe(3000);
        expect(portfolio.overcommitted).toBe(true);
    });

    test('within surplus → not overcommitted', () => {
        const goals = [{ id: 'a', targetAmount: 12_000, currentAmount: 0, targetDate: new Date(NOW + 12 * MONTH), contributions: [] }];
        const { portfolio } = planGoals({ goals, monthlySurplus: 2000, now: NOW });
        expect(portfolio.overcommitted).toBe(false);
    });
});

describe('GET /api/goals/plan (DB)', () => {
    let mongo, User, Category, Income, Expense, Goal, goalCtl;
    let masterEncrypt, generateDataKey, encrypt, generateUserKeyBundle, signRecord;

    beforeAll(() => {
        process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
        process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
        process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
    });
    beforeAll(async () => {
        mongo = await MongoMemoryServer.create();
        await mongoose.connect(mongo.getUri());
        User = require('../models/User'); Category = require('../models/Category');
        Income = require('../models/Income'); Expense = require('../models/Expense'); Goal = require('../models/Goal');
        goalCtl = require('../controllers/goalController');
        ({ masterEncrypt, generateDataKey, encrypt } = require('../utils/encryption'));
        ({ generateUserKeyBundle } = require('../utils/keyManagement'));
        ({ signRecord } = require('../utils/signing'));
        await Promise.all([Category.init(), Income.init(), Expense.init(), Goal.init()]);
    }, 60_000);
    afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
    beforeEach(async () => {
        if (!mongoose.connection.db) return;
        const colls = await mongoose.connection.db.listCollections().toArray();
        await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
    });

    async function persistUser() {
        const raw = generateDataKey();
        const dataKey = Buffer.from(raw, 'hex');
        const bundle = await generateUserKeyBundle(dataKey);
        const user = await User.create({
            name: 'x', email: 'x', emailHash: `eh-${Math.random().toString(36).slice(2, 14)}`,
            password: 'pw-placeholder', encryptedDataKey: await masterEncrypt(raw), currency: 'USD', ...bundle,
        });
        return { user, dataKey };
    }
    function mockReq(user, dataKey) { return { user, dataKey, query: {}, params: {}, body: {} }; }
    function mockRes() { const res = {}; res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res); return res; }
    const daysAgo = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n, 12)); };

    test('returns cashFlow + per-goal plan + portfolio', async () => {
        const { user, dataKey } = await persistUser();
        const incCat = await Category.create({ user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' });
        await Income.create({ user: user._id, amount: 90_000, category: incCat._id, description: await encrypt('s', dataKey), date: daysAgo(10), isRecurring: false, isPostTax: true });

        const sa = await signRecord({ title: 'Car', targetAmount: 12_000, goalType: 'Car' }, user, dataKey);
        await Goal.create({
            user: user._id, title: await encrypt('Car', dataKey), targetAmount: 12_000,
            targetDate: new Date(Date.now() + 365 * DAY), goalType: 'Car', serverAttestation: sa,
            contributions: [{ amount: 1000, date: daysAgo(5) }],
        });

        const res = mockRes();
        await goalCtl.getGoalPlan(mockReq(user, dataKey), res);
        const d = res.json.mock.calls.at(-1)[0].data;

        expect(d.cashFlow.monthlySurplus).toBe(30_000); // 90k income, no expenses, /3
        expect(d.goals).toHaveLength(1);
        expect(d.goals[0].title).toBe('Car');
        expect(d.goals[0].requiredMonthly).toBeGreaterThan(0);
        expect(d.portfolio).toHaveProperty('overcommitted');
    });
});
