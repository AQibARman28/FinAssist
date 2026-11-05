/**
 * GOAL-1 Phase 2 — feasibility + forecast. Pure-service boundary tests, plus a
 * GET /api/goals/plan integration check against in-memory Mongo.
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { planGoal, planGoals, allocateSurplus, goalVerdict, STATUS } = require('../services/goalPlanning');

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
        // Nothing saved and nothing due yet, and the surplus covers it: the
        // verdict comes from pace and surplus, not from a rate it can't have.
        expect(r.status).toBe(STATUS.ON_TRACK);
    });

    // One verdict for the goals plan and the health score (PRODUCT.md › Plan
    // from real money): out of reach when the rest needs more each month
    // than the whole surplus; behind when below an even pace from the day the
    // goal was set; otherwise on track.
    test('behind the even pace but affordable → At risk', () => {
        const r = planGoal(
            { id: 'g3', targetAmount: 12_000, currentAmount: 3000, createdAt: new Date(NOW - 6 * MONTH), targetDate: new Date(NOW + 6 * MONTH), contributions: monthlyContribs(500, 3) },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.requiredMonthly).toBe(1500); // 9000 / 6mo, within the surplus
        expect(r.status).toBe(STATUS.AT_RISK); // 25% saved, an even pace would be 50%
    });

    test('on or ahead of the even pace and affordable → On track, whatever the recent rate', () => {
        const r = planGoal(
            { id: 'g7', targetAmount: 12_000, currentAmount: 7000, createdAt: new Date(NOW - 6 * MONTH), targetDate: new Date(NOW + 6 * MONTH), contributions: [] },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.actualMonthlyRate).toBeNull(); // nothing added lately
        expect(r.status).toBe(STATUS.ON_TRACK);
    });

    test('a goal set yesterday is judged on pace and surplus, not on a 90-day rate it cannot have', () => {
        const r = planGoal(
            {
                id: 'g8', targetAmount: 3000, currentAmount: 1000,
                createdAt: new Date(NOW - 1 * DAY), targetDate: new Date(NOW + 25 * DAY),
                contributions: [{ amount: 1000, date: new Date(NOW - 1 * DAY) }],
            },
            { monthlySurplus: 5566, now: NOW },
        );
        expect(r.status).toBe(STATUS.ON_TRACK);
        expect(r.actualMonthlyRate).toBe(1000); // its first month, not 1000 / 3
        expect(r.forecastMonths).toBeNull();     // too young to forecast from
        expect(r.forecastDelta).toBeNull();
    });

    test('the saving rate covers only the lifetime of the goal', () => {
        const r = planGoal(
            {
                id: 'g9', targetAmount: 12_000, currentAmount: 900,
                createdAt: new Date(NOW - 45 * DAY), targetDate: new Date(NOW + 12 * MONTH),
                contributions: [{ amount: 900, date: new Date(NOW - 40 * DAY) }],
            },
            { monthlySurplus: 2000, now: NOW },
        );
        expect(r.actualMonthlyRate).toBe(600); // 900 over 1.5 months, not over 3
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

describe('goalVerdict (shared with the health score)', () => {
    const fresh = (createdAgo) => ({ targetAmount: 2000, currentAmount: 0, createdAt: new Date(NOW - createdAgo), targetDate: new Date(NOW + 26 * DAY) });
    test('a goal set today with nothing saved yet is not behind', () => {
        expect(goalVerdict(fresh(60 * 60 * 1000), { monthlySurplus: 5000, now: NOW })).toBe(STATUS.ON_TRACK);
    });
    test('a whole day without saving its share puts it behind', () => {
        expect(goalVerdict(fresh(2 * DAY), { monthlySurplus: 5000, now: NOW })).toBe(STATUS.AT_RISK);
    });
    test('affordability needs the surplus; without it, pace alone decides', () => {
        const goal = { targetAmount: 100_000, currentAmount: 0, createdAt: new Date(NOW), targetDate: new Date(NOW + 1 * MONTH) };
        expect(goalVerdict(goal, { monthlySurplus: 5000, now: NOW })).toBe(STATUS.NOT_FEASIBLE);
        expect(goalVerdict(goal, { now: NOW })).toBe(STATUS.ON_TRACK);
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

describe('allocateSurplus (pure)', () => {
    const at = (months) => new Date(NOW + months * MONTH);

    test('scarce surplus → emergency to baseline first, then nearest deadline', () => {
        const r = allocateSurplus({
            goals: [
                { id: 'em',  targetAmount: 30_000, currentAmount: 0, targetDate: at(6),  goalType: 'Emergency Fund', priority: 0 },
                { id: 'vac', targetAmount: 12_000, currentAmount: 0, targetDate: at(3),  goalType: 'Vacation',       priority: 0 },
                { id: 'car', targetAmount: 24_000, currentAmount: 0, targetDate: at(12), goalType: 'Car',            priority: 0 },
            ],
            monthlySurplus: 6000, monthlyAvgExpenses: 10_000, now: NOW, // baseline 30k
        });
        const get = (id) => r.allocations.find((a) => a.goalId === id).suggested;
        expect(get('em')).toBe(5000);  // required 30k/6, capped by gap, funded first
        expect(get('vac')).toBe(1000); // remainder after emergency
        expect(get('car')).toBe(0);    // surplus exhausted
        expect(r.freeSurplus).toBe(0);
        expect(r.overcommitted).toBe(true);

        const vac = r.tradeoffs.find((t) => t.goalId === 'vac');
        expect(vac.shortfall).toBe(3000);   // need 4000 − 1000
        expect(vac.extendMonths).toBe(9);   // 12000/1000=12mo vs 3mo left
        const car = r.tradeoffs.find((t) => t.goalId === 'car');
        expect(car.shortfall).toBe(2000);
        expect(car.extendMonths).toBeNull(); // allocated 0 → can't forecast
    });

    test('ample surplus → all funded, freeSurplus reported, no tradeoffs', () => {
        const r = allocateSurplus({
            goals: [
                { id: 'em',  targetAmount: 30_000, currentAmount: 0, targetDate: at(6),  goalType: 'Emergency Fund' },
                { id: 'vac', targetAmount: 12_000, currentAmount: 0, targetDate: at(3),  goalType: 'Vacation' },
                { id: 'car', targetAmount: 24_000, currentAmount: 0, targetDate: at(12), goalType: 'Car' },
            ],
            monthlySurplus: 20_000, monthlyAvgExpenses: 10_000, now: NOW,
        });
        expect(r.freeSurplus).toBe(9000); // 20000 − (5000+4000+2000)
        expect(r.tradeoffs).toHaveLength(0);
        expect(r.overcommitted).toBe(false);
    });

    // Due in under a month, remaining ÷ months-left is more than the goal
    // still needs. Suggesting that would put more into the goal than its target.
    test('never suggests more than a goal still needs (deadline under a month away)', () => {
        const r = allocateSurplus({
            goals: [
                { id: 'phone', targetAmount: 3000, currentAmount: 1000, targetDate: at(0.5), goalType: 'Phone' },
            ],
            monthlySurplus: 6000, monthlyAvgExpenses: 1000, now: NOW,
        });
        expect(r.allocations[0].suggested).toBe(2000);
        expect(r.freeSurplus).toBe(4000);
        expect(r.tradeoffs).toHaveLength(0); // fully funded: nothing is short
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
    function mockReq(user, dataKey, body = {}) { return { user, dataKey, query: {}, params: {}, body, ip: '127.0.0.1', get: () => 'jest' }; }
    async function makeGoal(user, dataKey, { title = 'Car', targetAmount = 12_000, goalType = 'Car' } = {}) {
        const sa = await signRecord({ title, targetAmount, goalType }, user, dataKey);
        return Goal.create({
            user: user._id, title: await encrypt(title, dataKey), targetAmount,
            targetDate: new Date(Date.now() + 365 * DAY), goalType, serverAttestation: sa,
        });
    }
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

    // The Goals page and the health score must give a goal the same verdict.
    test('the goals plan and the health score agree on behind and out of reach', async () => {
        const aiCtl = require('../controllers/aiController');
        const { user, dataKey } = await persistUser();
        const incCat = await Category.create({ user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' });
        await Income.create({ user: user._id, amount: 90_000, category: incCat._id, description: await encrypt('s', dataKey), date: daysAgo(10), isRecurring: false, isPostTax: true });

        // Set 20 days ago, due in 10: an even pace would have two thirds saved by now.
        const behind = await makeGoal(user, dataKey, { title: 'Phone', targetAmount: 3000, goalType: 'Other' });
        await Goal.collection.updateOne({ _id: behind._id }, { $set: {
            currentAmount: 300, createdAt: daysAgo(20), targetDate: new Date(Date.now() + 10 * DAY),
            contributions: [{ amount: 300, date: daysAgo(15) }],
        } });

        const plan = mockRes();
        await goalCtl.getGoalPlan(mockReq(user, dataKey), plan);
        expect(plan.json.mock.calls.at(-1)[0].data.goals[0].status).toBe(STATUS.AT_RISK);

        const health = mockRes();
        await aiCtl.financialHealthScore(mockReq(user, dataKey), health);
        const goalFactor = (res) => res.json.mock.calls.at(-1)[0].data.factors.find((f) => f.label === 'Goal progress');
        expect(goalFactor(health).detail).toBe('Your goal is behind');

        // Due in a month but needing far more than the 30,000 a month surplus.
        await Goal.collection.updateOne({ _id: behind._id }, { $set: {
            targetAmount: 1_000_000, currentAmount: 0, createdAt: new Date(), targetDate: new Date(Date.now() + 30 * DAY), contributions: [],
        } });
        const plan2 = mockRes();
        await goalCtl.getGoalPlan(mockReq(user, dataKey), plan2);
        expect(plan2.json.mock.calls.at(-1)[0].data.goals[0].status).toBe(STATUS.NOT_FEASIBLE);
        const health2 = mockRes();
        await aiCtl.financialHealthScore(mockReq(user, dataKey), health2);
        expect(goalFactor(health2).detail).toBe('Your goal is out of reach');
    });

    test('POST /allocate records contributions via the contribute path', async () => {
        const { user, dataKey } = await persistUser();
        // Seed monthly savings so the hard cap allows the 500 allocation.
        const incCat = await Category.create({ user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' });
        await Income.create({ user: user._id, amount: 5_000, category: incCat._id, description: await encrypt('s', dataKey), date: new Date(), isRecurring: false, isPostTax: true });
        const goal = await makeGoal(user, dataKey, { targetAmount: 12_000 });

        const res = mockRes();
        await goalCtl.allocateContributions(mockReq(user, dataKey, { allocations: [{ goalId: goal._id.toString(), amount: 500 }] }), res);
        expect(res.json).toHaveBeenCalled();

        const fresh = await Goal.findById(goal._id);
        expect(fresh.contributions).toHaveLength(1);
        expect(fresh.contributions[0].amount).toBe(500);
        expect(fresh.currentAmount).toBe(500); // pre-save recompute
    });

    test('POST /allocate hard-caps at available savings (rejects, records nothing)', async () => {
        const { user, dataKey } = await persistUser();
        // No income → 0 available savings, so any positive allocation is blocked.
        const goal = await makeGoal(user, dataKey, { targetAmount: 12_000 });

        const res = mockRes();
        await goalCtl.allocateContributions(mockReq(user, dataKey, { allocations: [{ goalId: goal._id.toString(), amount: 500 }] }), res);
        expect(res.status).toHaveBeenCalledWith(400);

        const fresh = await Goal.findById(goal._id);
        expect(fresh.contributions).toHaveLength(0);
    });

    test('POST /allocate rejects a goal the user does not own (404, records nothing)', async () => {
        const { user: a, dataKey: dkA } = await persistUser();
        const { user: b, dataKey: dkB } = await persistUser();
        const bGoal = await makeGoal(b, dkB);

        const res = mockRes();
        await goalCtl.allocateContributions(mockReq(a, dkA, { allocations: [{ goalId: bGoal._id.toString(), amount: 500 }] }), res);
        expect(res.status).toHaveBeenCalledWith(404);

        const fresh = await Goal.findById(bGoal._id);
        expect(fresh.contributions).toHaveLength(0);
    });
});
