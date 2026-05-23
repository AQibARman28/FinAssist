/**
 * DASH-1 Phase 1 — GET /api/analytics/spending-timeline.
 *
 * Controller is called directly with a mock req/res against in-memory Mongo
 * (same pattern as analytics.test.js). Route-level zod validation is exercised
 * separately against the validator schema.
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
let User, Category, Expense;
let analyticsCtl;
let timelineSchema;
let masterEncrypt, generateDataKey, encrypt, generateUserKeyBundle;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User      = require('../models/User');
    Category  = require('../models/Category');
    Expense   = require('../models/Expense');
    analyticsCtl = require('../controllers/analyticsController');
    ({ spendingTimeline: timelineSchema } = require('../validators/analytics'));
    ({ masterEncrypt, generateDataKey, encrypt } = require('../utils/encryption'));
    ({ generateUserKeyBundle } = require('../utils/keyManagement'));
    await Category.init();
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

async function makeCategory(user, name = 'Food', type = 'expense') {
    return Category.create({ user: user._id, name, type, color: '#10B981', icon: 'utensils' });
}

async function plantExpense({ user, dataKey, category, amount, date, desc = 'expense' }) {
    return Expense.create({
        user: user._id,
        amount, category: category._id,
        description: await encrypt(desc, dataKey),
        date,
    });
}

function mockReq(user, dataKey, query = {}) {
    return { user, dataKey, body: {}, params: {}, query, ip: '127.0.0.1', get: () => 'jest', requestId: 'test' };
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
async function callTimeline(user, dataKey, query) {
    const res = mockRes();
    await analyticsCtl.spendingTimeline(mockReq(user, dataKey, query), res);
    return lastJson(res);
}

// noon UTC, n days before today — avoids day-boundary ambiguity.
function daysAgo(n) {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n, 12, 0, 0, 0));
}
const iso = (d) => d.toISOString();

// ── daily bucketing + top/max/hasMore ────────────────────────────────────────

describe('spending-timeline · daily', () => {
    test('buckets totals/count, top capped & amount-desc, max + hasMore, chronological', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user);

        // today: two expenses
        await plantExpense({ user, dataKey, category: cat, amount: 100, date: daysAgo(0) });
        await plantExpense({ user, dataKey, category: cat, amount: 50,  date: daysAgo(0) });
        // two days ago: a spike (3 expenses)
        const big = await plantExpense({ user, dataKey, category: cat, amount: 5000, date: daysAgo(2), desc: 'big one' });
        await plantExpense({ user, dataKey, category: cat, amount: 3000, date: daysAgo(2) });
        await plantExpense({ user, dataKey, category: cat, amount: 30,   date: daysAgo(2) });

        const out = await callTimeline(user, dataKey, { granularity: 'daily', from: iso(daysAgo(4)), to: iso(daysAgo(0)), previewLimit: 2 });
        const { buckets } = out.data;

        // chronological ascending
        const periods = buckets.map((b) => b.period);
        expect([...periods].sort()).toEqual(periods);

        const todayB  = buckets.find((b) => b.period === daysAgo(0).toISOString().slice(0, 10));
        const spikeB  = buckets.find((b) => b.period === daysAgo(2).toISOString().slice(0, 10));

        expect(todayB.total).toBe(150);
        expect(todayB.count).toBe(2);

        expect(spikeB.total).toBe(8030);
        expect(spikeB.count).toBe(3);
        expect(spikeB.maxExpenseId).toBe(big._id.toString());
        expect(spikeB.topExpenses.map((e) => e.amount)).toEqual([5000, 3000]); // desc, capped at 2
        expect(spikeB.hasMore).toBe(true);                                     // 3 > previewLimit 2
        expect(spikeB.topExpenses[0].description).toBe('big one');             // decrypted
        expect(spikeB.topExpenses[0].categoryName).toBe('Food');

        expect(out.data.grandTotal).toBe(8180);
        expect(out.data.grandCount).toBe(5);
    });
});

// ── ~100 expenses across 90 days sum correctly (monthly) ─────────────────────

describe('spending-timeline · monthly (90-day seed)', () => {
    test('grand totals/counts and per-bucket sums are correct', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user);

        let expected = 0;
        for (let i = 0; i < 90; i++) {
            const amount = 10 * (i + 1);
            expected += amount;
            await plantExpense({ user, dataKey, category: cat, amount, date: daysAgo(i) });
        }

        const out = await callTimeline(user, dataKey, { granularity: 'monthly', from: iso(daysAgo(95)), to: iso(daysAgo(0)) });
        const { buckets, grandTotal, grandCount } = out.data;

        expect(grandCount).toBe(90);
        expect(grandTotal).toBe(expected); // 40950
        expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(expected);
        expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(90);
        expect(buckets.length).toBeGreaterThanOrEqual(3); // ~Feb..May
        const periods = buckets.map((b) => b.period);
        expect([...periods].sort()).toEqual(periods);
    });
});

// ── weekly buckets are Monday-aligned ────────────────────────────────────────

describe('spending-timeline · weekly', () => {
    test('every bucket period falls on a Monday (ISO week)', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user);
        for (const d of [1, 4, 9, 13, 18]) {
            await plantExpense({ user, dataKey, category: cat, amount: 100, date: daysAgo(d) });
        }
        const out = await callTimeline(user, dataKey, { granularity: 'weekly', from: iso(daysAgo(21)), to: iso(daysAgo(0)) });
        for (const b of out.data.buckets) {
            expect(new Date(`${b.period}T00:00:00.000Z`).getUTCDay()).toBe(1); // Monday
        }
        expect(out.data.grandCount).toBe(5);
    });
});

// ── yearly groups by calendar year (default = all data) ──────────────────────

describe('spending-timeline · yearly', () => {
    test('groups across years; per-year totals correct', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user);
        await plantExpense({ user, dataKey, category: cat, amount: 777, date: new Date(Date.UTC(2024, 5, 15, 12)) });
        await plantExpense({ user, dataKey, category: cat, amount: 100, date: new Date(Date.UTC(2025, 2, 10, 12)) });
        await plantExpense({ user, dataKey, category: cat, amount: 200, date: new Date(Date.UTC(2025, 8, 1, 12)) });

        const out = await callTimeline(user, dataKey, { granularity: 'yearly' });
        const b2024 = out.data.buckets.find((b) => b.label === '2024');
        const b2025 = out.data.buckets.find((b) => b.label === '2025');
        expect(b2024.total).toBe(777);
        expect(b2025.total).toBe(300);
        expect(b2025.count).toBe(2);
    });
});

// ── preview cap / ordering / max id ──────────────────────────────────────────

describe('spending-timeline · topExpenses', () => {
    test('capped at previewLimit, amount-desc, maxExpenseId is the largest', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeCategory(user);
        const amounts = [10, 90, 30, 70, 50, 20, 80, 40, 60, 100];
        let maxDoc = null;
        for (const a of amounts) {
            const e = await plantExpense({ user, dataKey, category: cat, amount: a, date: daysAgo(0) });
            if (!maxDoc || a > maxDoc.amount) maxDoc = { id: e._id.toString(), amount: a };
        }
        const out = await callTimeline(user, dataKey, { granularity: 'daily', from: iso(daysAgo(1)), to: iso(daysAgo(0)), previewLimit: 3 });
        const b = out.data.buckets[0];
        expect(b.count).toBe(10);
        expect(b.topExpenses).toHaveLength(3);
        expect(b.topExpenses.map((e) => e.amount)).toEqual([100, 90, 80]);
        expect(b.maxExpenseId).toBe(maxDoc.id);
        expect(b.hasMore).toBe(true);
    });
});

// ── category filter ──────────────────────────────────────────────────────────

describe('spending-timeline · category filter', () => {
    test('only the requested category is counted', async () => {
        const { user, dataKey } = await persistUser();
        const food = await makeCategory(user, 'Food');
        const bills = await makeCategory(user, 'Bills');
        await plantExpense({ user, dataKey, category: food,  amount: 500, date: daysAgo(1) });
        await plantExpense({ user, dataKey, category: bills, amount: 111, date: daysAgo(1) });
        await plantExpense({ user, dataKey, category: bills, amount: 222, date: daysAgo(2) });

        const out = await callTimeline(user, dataKey, { granularity: 'daily', from: iso(daysAgo(5)), to: iso(daysAgo(0)), category: bills._id.toString() });
        expect(out.data.grandTotal).toBe(333);
        expect(out.data.grandCount).toBe(2);
    });
});

// ── IDOR boundary ────────────────────────────────────────────────────────────

describe('spending-timeline · IDOR', () => {
    test('user A never sees user B buckets', async () => {
        const { user: a, dataKey: dkA } = await persistUser();
        const { user: b, dataKey: dkB } = await persistUser();
        const catB = await makeCategory(b);
        await plantExpense({ user: b, dataKey: dkB, category: catB, amount: 9999, date: daysAgo(1) });

        const out = await callTimeline(a, dkA, { granularity: 'daily', from: iso(daysAgo(5)), to: iso(daysAgo(0)) });
        expect(out.data.buckets).toHaveLength(0);
        expect(out.data.grandTotal).toBe(0);
        expect(out.data.grandCount).toBe(0);
    });
});

// ── zod validation (route boundary) ──────────────────────────────────────────

describe('spending-timeline · query validation', () => {
    test('rejects a bad granularity', () => {
        expect(timelineSchema.safeParse({ granularity: 'hourly' }).success).toBe(false);
    });
    test('rejects a non-ObjectId category', () => {
        expect(timelineSchema.safeParse({ granularity: 'daily', category: 'not-an-id' }).success).toBe(false);
    });
    test('rejects unknown fields (strict)', () => {
        expect(timelineSchema.safeParse({ granularity: 'daily', bogus: 1 }).success).toBe(false);
    });
    test('coerces previewLimit and enforces max 50', () => {
        const ok = timelineSchema.safeParse({ granularity: 'daily', previewLimit: '10' });
        expect(ok.success).toBe(true);
        expect(ok.data.previewLimit).toBe(10);
        expect(timelineSchema.safeParse({ granularity: 'daily', previewLimit: 51 }).success).toBe(false);
    });
    test('accepts a minimal valid query', () => {
        expect(timelineSchema.safeParse({ granularity: 'monthly' }).success).toBe(true);
    });
});
