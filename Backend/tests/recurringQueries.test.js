/**
 * Round-trip budget for the recurring-income paths.
 *
 * incomeTotalForPeriod and materializeRecurring used to issue one
 * `Income.exists` per scheduled occurrence, one after another. A weekly
 * salary started a year ago meant ~50 sequential queries per call, and
 * GET /analytics/balance makes five all-time calls — hundreds of round trips
 * to Atlas for one wallet figure. These tests pin the totals AND a constant
 * query count, so the per-occurrence loop can't come back.
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
let finance, recurring, signing;
let masterEncrypt, generateDataKey, encrypt, generateUserKeyBundle;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User      = require('../models/User');
    Category  = require('../models/Category');
    Income    = require('../models/Income');
    Expense   = require('../models/Expense');
    finance   = require('../utils/finance');
    recurring = require('../utils/recurring');
    signing   = require('../utils/signing');
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

const DAY = 86_400_000;
const AMOUNT = 5000;
const WEEKS = 30;

// Every database operation `fn` performs, as "collection.method".
async function recordOps(fn) {
    const ops = [];
    mongoose.set('debug', (coll, method) => ops.push(`${coll}.${method}`));
    try {
        await fn();
    } finally {
        mongoose.set('debug', false);
    }
    return ops;
}

const on = (ops, coll) => ops.filter((op) => op.startsWith(`${coll}.`));

async function persistUser() {
    const raw = generateDataKey();
    const dataKey = Buffer.from(raw, 'hex');
    const user = await User.create({
        name: 'x', email: 'x', emailHash: `eh-${Math.random().toString(36).slice(2, 14)}`,
        password: 'pw-placeholder', encryptedDataKey: await masterEncrypt(raw),
        ...(await generateUserKeyBundle(dataKey)),
    });
    return { user, dataKey };
}

// A weekly template anchored WEEKS weeks before today's UTC midnight, so the
// window [EPOCH, now] holds exactly WEEKS + 1 occurrences (anchor included).
async function weeklyTemplate() {
    const { user, dataKey } = await persistUser();
    const category = await Category.create({
        user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase',
    });
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const anchor = new Date(todayUTC - WEEKS * 7 * DAY);
    const createdAt = new Date();
    const template = await Income.create({
        user: user._id, amount: AMOUNT, category: category._id,
        description: await encrypt('salary', dataKey), date: anchor,
        isRecurring: true, recurringFrequency: 'weekly', createdAt,
        serverAttestation: await signing.signRecord(
            { amount: AMOUNT, category: category._id, date: anchor, user: user._id, createdAt }, user, dataKey,
        ),
    });
    return { user, dataKey, category, template, anchor };
}

// Materialized instances for occurrences 1..n (the template is occurrence 0).
async function materializeFirst(n, { user, dataKey, category, template, anchor }) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
        rows.push({
            user: user._id, amount: AMOUNT, category: category._id,
            description: await encrypt('salary', dataKey),
            date: new Date(anchor.getTime() + i * 7 * DAY),
            isRecurring: false, parentRecurringId: template._id,
        });
    }
    await Income.insertMany(rows);
}

// ── incomeTotalForPeriod ────────────────────────────────────────────────────

describe('incomeTotalForPeriod with a partially materialized template', () => {
    test('counts every occurrence exactly once, plus one-off income', async () => {
        const fixture = await weeklyTemplate();
        await materializeFirst(10, fixture);
        await Income.create({
            user: fixture.user._id, amount: 1000, category: fixture.category._id,
            description: await encrypt('gift', fixture.dataKey), date: new Date(Date.now() - DAY),
        });

        const total = await finance.incomeTotalForPeriod(fixture.user._id, new Date(0), new Date());
        expect(total).toBe((WEEKS + 1) * AMOUNT + 1000);
    });

    // The dashboard reads /analytics/balance while /incomes materializes the
    // same occurrences. A write that lands mid-computation must not make an
    // occurrence vanish (counted neither as a row nor as a scheduled amount).
    test('counts an occurrence once even when it is materialized mid-computation', async () => {
        const fixture = await weeklyTemplate();
        const original = Income.aggregate;
        let wrote = false;
        Income.aggregate = function (...args) {
            const agg = original.apply(this, args);
            const exec = agg.exec.bind(agg);
            agg.exec = async (...rest) => {
                const out = await exec(...rest);
                if (!wrote) {
                    wrote = true;
                    await recurring.materializeRecurring(Income, fixture.user._id, new Date(0), new Date());
                }
                return out;
            };
            return agg;
        };
        try {
            const total = await finance.incomeTotalForPeriod(fixture.user._id, new Date(0), new Date());
            expect(wrote).toBe(true);
            expect(await Income.countDocuments({ parentRecurringId: fixture.template._id })).toBe(WEEKS);
            expect(total).toBe((WEEKS + 1) * AMOUNT);
        } finally {
            Income.aggregate = original;
        }
    });

    test('uses a constant number of Income queries, not one per occurrence', async () => {
        const fixture = await weeklyTemplate();
        await materializeFirst(10, fixture);

        const ops = await recordOps(() => finance.incomeTotalForPeriod(fixture.user._id, new Date(0), new Date()));
        expect(on(ops, 'incomes').length).toBeLessThanOrEqual(3);
    });
});

// ── materializeRecurring ────────────────────────────────────────────────────

describe('materializeRecurring round trips', () => {
    test('a user without templates costs one query and no user lookup', async () => {
        const { user } = await persistUser();
        const ops = await recordOps(() => recurring.materializeRecurring(Income, user._id, new Date(0), new Date()));
        expect(on(ops, 'users')).toEqual([]);
        expect(on(ops, 'incomes').length).toBe(1);
    });

    test('inserts all missing instances in one write', async () => {
        const fixture = await weeklyTemplate();
        let result;
        const ops = await recordOps(async () => {
            result = await recurring.materializeRecurring(Income, fixture.user._id, new Date(0), new Date());
        });
        expect(result.created).toBe(WEEKS);
        expect(await Income.countDocuments({ parentRecurringId: fixture.template._id })).toBe(WEEKS);
        expect(on(ops, 'incomes').filter((op) => /insert/i.test(op)).length).toBe(1);
    });

    test('an already materialized window is checked with a constant number of queries', async () => {
        const fixture = await weeklyTemplate();
        await recurring.materializeRecurring(Income, fixture.user._id, new Date(0), new Date());

        let result;
        const ops = await recordOps(async () => {
            result = await recurring.materializeRecurring(Income, fixture.user._id, new Date(0), new Date());
        });
        expect(result.created).toBe(0);
        expect(on(ops, 'incomes').length).toBeLessThanOrEqual(2);
    });
});
