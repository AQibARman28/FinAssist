/**
 * Part-6 recurring-materialization tests.
 *
 * Two layers:
 *   1. computeRecurringDates — pure date arithmetic. No DB.
 *   2. materializeRecurring — exercises the controller-adjacent path:
 *      real Mongo (in-memory), a user with a real key bundle, a Category,
 *      a recurring Income template, and assertions on what the
 *      materializer creates / skips / leaves alone.
 *
 * The "editing template doesn't mutate existing instances" test is the
 * one most worth pinning — it locks in the "history is immutable"
 * invariant the brief asks us to document.
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
let User, Category, Income;
let recurring, signing;
let masterEncrypt, generateUserKeyBundle, generateDataKey;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User      = require('../models/User');
    Category  = require('../models/Category');
    Income    = require('../models/Income');
    recurring = require('../utils/recurring');
    signing   = require('../utils/signing');
    ({ masterEncrypt, generateDataKey } = require('../utils/encryption'));
    ({ generateUserKeyBundle } = require('../utils/keyManagement'));
    await Category.init();
    await Income.init();
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

const UTC = (y, m1based, d, h = 0, mi = 0, s = 0) =>
    new Date(Date.UTC(y, m1based - 1, d, h, mi, s, 0));

async function persistUser() {
    // We need a User row that the materializer can load to pick up keys.
    const rawDataKey = generateDataKey();
    const encryptedDataKey = await masterEncrypt(rawDataKey);
    const dataKey = Buffer.from(rawDataKey, 'hex');
    const bundle  = await generateUserKeyBundle(dataKey);

    const user = await User.create({
        // PII is required by the schema but the materializer never touches
        // it — any non-empty values are fine.
        name:        'placeholder',
        email:       'placeholder',
        emailHash:   `eh-${Math.random().toString(36).slice(2, 14)}`,
        password:    'placeholder-pw',
        encryptedDataKey,
        ...bundle,
    });
    return { user, dataKey };
}

async function makeIncomeCategory(user) {
    return Category.create({
        user: user._id, name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase',
    });
}

// Create a recurring income template directly (bypassing the controller so
// the tests don't depend on req-shape plumbing). The template carries the
// initial serverAttestation just like the controller would write.
async function makeTemplate({ user, dataKey, category, anchor, frequency, amount = 5000 }) {
    const createdAt = new Date();
    const attestation = await signing.signRecord(
        { amount, category: category._id, date: anchor, user: user._id, createdAt },
        user,
        dataKey,
    );
    // Encrypt description so the schema's required-string field is happy.
    const { encrypt } = require('../utils/encryption');
    const encDesc = await encrypt(`recurring ${frequency}`, dataKey);
    return Income.create({
        user:               user._id,
        amount,
        category:           category._id,
        description:        encDesc,
        date:               anchor,
        isRecurring:        true,
        recurringFrequency: frequency,
        isPostTax:          true,
        createdAt,
        serverAttestation:  attestation,
    });
}

// ── 1. computeRecurringDates ────────────────────────────────────────────────

describe('computeRecurringDates', () => {
    test('weekly: anchor + 7d intervals, window-bounded', () => {
        const anchor = UTC(2026, 1, 1);
        const dates = recurring.computeRecurringDates(
            anchor, 'weekly', UTC(2026, 1, 1), UTC(2026, 1, 31),
        );
        // Jan 1, 8, 15, 22, 29
        expect(dates.map((d) => d.toISOString().slice(0, 10)))
            .toEqual(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22', '2026-01-29']);
    });

    test('biweekly: every 14 days', () => {
        const anchor = UTC(2026, 1, 1);
        const dates = recurring.computeRecurringDates(
            anchor, 'biweekly', UTC(2026, 1, 1), UTC(2026, 3, 31),
        );
        expect(dates.map((d) => d.toISOString().slice(0, 10)))
            .toEqual(['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26', '2026-03-12', '2026-03-26']);
    });

    test('monthly: same day-of-month per month', () => {
        const anchor = UTC(2026, 1, 1);
        const dates = recurring.computeRecurringDates(
            anchor, 'monthly', UTC(2026, 1, 1), UTC(2026, 4, 30),
        );
        expect(dates.map((d) => d.toISOString().slice(0, 10)))
            .toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    });

    test('monthly: anchor on Jan 31 clamps to Feb-28, then Mar 31, Apr 30, May 31', () => {
        const anchor = UTC(2026, 1, 31);
        const dates = recurring.computeRecurringDates(
            anchor, 'monthly', UTC(2026, 1, 1), UTC(2026, 5, 31),
        );
        // Crucially, Mar must be 31 (NOT 28) — clamping must not compound
        // through previous occurrences.
        expect(dates.map((d) => d.toISOString().slice(0, 10)))
            .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    });

    test('yearly: same month/day per year, Feb-29 clamps on non-leap years', () => {
        const anchor = UTC(2024, 2, 29); // 2024 is leap
        const dates = recurring.computeRecurringDates(
            anchor, 'yearly', UTC(2024, 1, 1), UTC(2028, 12, 31),
        );
        expect(dates.map((d) => d.toISOString().slice(0, 10)))
            .toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    });

    test('range boundaries respected (no dates outside [from, to])', () => {
        const anchor = UTC(2026, 1, 1);
        const dates = recurring.computeRecurringDates(
            anchor, 'monthly', UTC(2026, 3, 1), UTC(2026, 5, 31),
        );
        // anchor (Jan 1) is BEFORE from (Mar 1) → excluded.
        expect(dates.map((d) => d.toISOString().slice(0, 10)))
            .toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
    });

    test('window entirely BEFORE the anchor → empty array', () => {
        const dates = recurring.computeRecurringDates(
            UTC(2026, 6, 1), 'monthly', UTC(2026, 1, 1), UTC(2026, 5, 31),
        );
        expect(dates).toEqual([]);
    });

    test('fromDate > toDate → empty array', () => {
        const dates = recurring.computeRecurringDates(
            UTC(2026, 1, 1), 'weekly', UTC(2026, 4, 1), UTC(2026, 1, 1),
        );
        expect(dates).toEqual([]);
    });

    test('unknown frequency throws', () => {
        expect(() => recurring.computeRecurringDates(
            UTC(2026, 1, 1), 'fortnightly', UTC(2026, 1, 1), UTC(2026, 3, 1),
        )).toThrow(/unknown frequency/);
    });
});

// ── 2. materializeRecurring ─────────────────────────────────────────────────

describe('materializeRecurring (Income)', () => {
    test('creates missing instances between anchor and the window end', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeIncomeCategory(user);
        const template = await makeTemplate({
            user, dataKey, category: cat,
            anchor:    UTC(2026, 1, 1),
            frequency: 'monthly',
        });

        const result = await recurring.materializeRecurring(
            Income, user._id, UTC(2026, 1, 1), UTC(2026, 4, 30),
        );
        expect(result.created).toBe(3);

        const all = await Income.find({ user: user._id }).sort({ date: 1 });
        expect(all.map((i) => i.date.toISOString().slice(0, 10)))
            .toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
        // First is the template, rest are instances.
        expect(all[0]._id.toString()).toBe(template._id.toString());
        for (const inst of all.slice(1)) {
            expect(inst.parentRecurringId.toString()).toBe(template._id.toString());
            expect(inst.isRecurring).toBe(false);
            expect(inst.recurringFrequency).toBeUndefined();
        }
    });

    test('idempotent — running twice does not duplicate', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeIncomeCategory(user);
        await makeTemplate({
            user, dataKey, category: cat,
            anchor: UTC(2026, 1, 1), frequency: 'monthly',
        });

        const r1 = await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 4, 30));
        expect(r1.created).toBe(3);
        const countAfterFirst = await Income.countDocuments({ user: user._id });

        const r2 = await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 4, 30));
        expect(r2.created).toBe(0);
        expect(await Income.countDocuments({ user: user._id })).toBe(countAfterFirst);
    });

    test('does not touch non-recurring rows or other users', async () => {
        const { user: u1, dataKey: dk1 } = await persistUser();
        const { user: u2, dataKey: dk2 } = await persistUser();
        const cat1 = await makeIncomeCategory(u1);
        const cat2 = await makeIncomeCategory(u2);

        // u1: recurring template
        await makeTemplate({
            user: u1, dataKey: dk1, category: cat1,
            anchor: UTC(2026, 1, 1), frequency: 'monthly',
        });
        // u1: a one-off, non-recurring income — must not produce instances
        const { encrypt } = require('../utils/encryption');
        await Income.create({
            user: u1._id, amount: 100, category: cat1._id,
            description: await encrypt('one-off', dk1),
            date: UTC(2026, 2, 15),
            isRecurring: false,
        });
        // u2: a recurring template — must not be touched by u1's materialize.
        await makeTemplate({
            user: u2, dataKey: dk2, category: cat2,
            anchor: UTC(2026, 1, 1), frequency: 'monthly',
        });

        await recurring.materializeRecurring(Income, u1._id, UTC(2026, 1, 1), UTC(2026, 4, 30));
        expect(await Income.countDocuments({ user: u1._id })).toBe(1 + 1 + 3);   // template + one-off + 3 instances
        expect(await Income.countDocuments({ user: u2._id })).toBe(1);            // u2's template, untouched
    });

    test('generated instance has a valid serverAttestation that verifies', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeIncomeCategory(user);
        const template = await makeTemplate({
            user, dataKey, category: cat,
            anchor: UTC(2026, 1, 1), frequency: 'monthly',
        });

        await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 3, 31));

        const inst = await Income.findOne({
            user: user._id, parentRecurringId: template._id, date: UTC(2026, 2, 1),
        });
        expect(inst).not.toBeNull();
        expect(inst.serverAttestation).toBeTruthy();
        const ok = await signing.verifyRecord(
            { amount: inst.amount, category: inst.category, date: inst.date, user: inst.user, createdAt: inst.createdAt },
            inst.serverAttestation,
            user,
        );
        expect(ok).toBe(true);
    });

    test('editing the template does NOT mutate existing instances', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeIncomeCategory(user);
        const template = await makeTemplate({
            user, dataKey, category: cat,
            anchor: UTC(2026, 1, 1), frequency: 'monthly', amount: 5000,
        });

        await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 4, 30));
        const beforeInstances = await Income.find({ user: user._id, parentRecurringId: template._id }).sort({ date: 1 });
        const beforeIds       = beforeInstances.map((i) => i._id.toString());
        const beforeAmounts   = beforeInstances.map((i) => i.amount);

        // Edit the template's amount.
        await Income.updateOne({ _id: template._id }, { $set: { amount: 9999 } });

        // Re-materialize for the SAME window — no new rows expected.
        const r = await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 4, 30));
        expect(r.created).toBe(0);

        // Existing instance amounts MUST be unchanged.
        const afterInstances = await Income.find({ user: user._id, parentRecurringId: template._id }).sort({ date: 1 });
        expect(afterInstances.map((i) => i._id.toString())).toEqual(beforeIds);
        expect(afterInstances.map((i) => i.amount)).toEqual(beforeAmounts);
    });

    test('skip-anchor: template stands in for its own date — no duplicate instance at the anchor', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeIncomeCategory(user);
        const template = await makeTemplate({
            user, dataKey, category: cat,
            anchor: UTC(2026, 1, 1), frequency: 'monthly',
        });

        await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 1, 31));
        // Only the template row should exist on Jan 1; no parentRecurringId
        // instance pointing at it on the same date.
        const onAnchor = await Income.find({ user: user._id, date: UTC(2026, 1, 1) });
        expect(onAnchor).toHaveLength(1);
        expect(onAnchor[0]._id.toString()).toBe(template._id.toString());
        expect(onAnchor[0].parentRecurringId).toBeNull();
    });

    test('weekly template materializes the expected number of instances in a 5-week window', async () => {
        const { user, dataKey } = await persistUser();
        const cat = await makeIncomeCategory(user);
        await makeTemplate({
            user, dataKey, category: cat,
            anchor: UTC(2026, 1, 1), frequency: 'weekly',
        });

        const r = await recurring.materializeRecurring(Income, user._id, UTC(2026, 1, 1), UTC(2026, 2, 4));
        // Jan 1, 8, 15, 22, 29, Feb 5 — but Feb 5 is OUTSIDE (to = Feb 4).
        // So schedule dates in window: Jan 1, 8, 15, 22, 29 = 5. Template
        // covers Jan 1, so 4 instances created.
        expect(r.created).toBe(4);
        expect(await Income.countDocuments({ user: user._id, parentRecurringId: { $ne: null } })).toBe(4);
    });
});
