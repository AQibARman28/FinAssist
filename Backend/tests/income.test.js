/**
 * Part-5 income tests. Validator + controller + encryption + IDOR +
 * serverAttestation tamper detection + audit-log write.
 *
 * Some tests need real per-user keys (for signing / encryption round-trips
 * and the tamper check), so the suite-level setup generates a full Mongoose
 * connection plus a per-test user object that carries:
 *   - encryptedDataKey is unused here (the controller takes req.dataKey
 *     directly)
 *   - rsaPublicKey / encryptedRsaPrivateKey for notes
 *   - eccPublicKey  / encryptedEccPrivateKey for serverAttestation
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
let Category;
let Income;
let AuditLog;
let controller;
let validator;
let signing;
let generateUserKeyBundle;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category   = require('../models/Category');
    Income     = require('../models/Income');
    AuditLog   = require('../models/AuditLog');
    controller = require('../controllers/incomeController');
    validator  = require('../validators/income');
    signing    = require('../utils/signing');
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

// Generate a real key bundle so signing/encryption actually run end-to-end.
async function makeUserWithKeys() {
    const dataKey = crypto.randomBytes(32);
    const bundle = await generateUserKeyBundle(dataKey);
    const user = {
        _id: new mongoose.Types.ObjectId(),
        ...bundle,
    };
    return { user, dataKey };
}

function mockReq({ user, dataKey, body = {}, params = {}, query = {} }) {
    return {
        user,
        dataKey,
        body,
        params,
        query,
        ip:        '127.0.0.1',
        get:       () => 'jest',
        requestId: 'test',
    };
}

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}

const lastStatus = (res) => {
    const c = res.status.mock.calls[res.status.mock.calls.length - 1];
    return c ? c[0] : 200;
};
const lastJson = (res) => {
    const c = res.json.mock.calls[res.json.mock.calls.length - 1];
    return c ? c[0] : null;
};

async function makeCategory(user, overrides = {}) {
    return Category.create({
        user:  user._id,
        name:  overrides.name  || `Cat-${Math.random().toString(36).slice(2, 8)}`,
        type:  overrides.type  || 'income',
        color: overrides.color || '#10B981',
        icon:  overrides.icon  || 'briefcase',
        ...overrides,
    });
}

const VALID_BODY = (categoryId) => ({
    amount:      5000,
    category:    categoryId,
    description: 'October salary',
    date:        new Date('2026-10-01T00:00:00.000Z').toISOString(),
});

// ── 1. Validator ────────────────────────────────────────────────────────────

describe('income create validator', () => {
    test('happy path parses', () => {
        const r = validator.create.safeParse(
            VALID_BODY(new mongoose.Types.ObjectId().toString()),
        );
        expect(r.success).toBe(true);
    });

    test('rejects unknown key (.strict mass-assignment guard)', () => {
        const r = validator.create.safeParse({
            ...VALID_BODY(new mongoose.Types.ObjectId().toString()),
            userId: 'spoof',
        });
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error.issues)).toMatch(/userId/);
    });

    test('isRecurring: true without recurringFrequency → fails', () => {
        const r = validator.create.safeParse({
            ...VALID_BODY(new mongoose.Types.ObjectId().toString()),
            isRecurring: true,
        });
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error.issues)).toMatch(/recurringFrequency/i);
    });

    test('isRecurring: true WITH recurringFrequency → passes', () => {
        const r = validator.create.safeParse({
            ...VALID_BODY(new mongoose.Types.ObjectId().toString()),
            isRecurring:        true,
            recurringFrequency: 'monthly',
        });
        expect(r.success).toBe(true);
    });

    test('update with partial fields is allowed', () => {
        const r = validator.update.safeParse({ amount: 1000 });
        expect(r.success).toBe(true);
    });

    test('update setting isRecurring=true without frequency → fails', () => {
        const r = validator.update.safeParse({ isRecurring: true });
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error.issues)).toMatch(/recurringFrequency/i);
    });
});

// ── 2. Controller — happy paths ─────────────────────────────────────────────

describe('createIncome (controller)', () => {
    test('valid POST → 201, persisted with the Category ref', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });

        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );

        expect(lastStatus(res)).toBe(201);
        const data = lastJson(res).data;
        expect(data.amount).toBe(5000);
        expect(data.category.toString()).toBe(cat._id.toString());
        expect(data.isPostTax).toBe(true);                // default
        expect(data.isRecurring).toBe(false);             // default

        const inDb = await Income.findOne({ user: user._id });
        expect(inDb).not.toBeNull();
        expect(inDb.category.toString()).toBe(cat._id.toString());
    });

    test("type='both' Category accepted for income", async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'both' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        expect(lastStatus(res)).toBe(201);
    });

    // ── 3. categoryGuard integration ────────────────────────────────────────

    test('expense-only Category → 400 type mismatch', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const expCat = await makeCategory(user, { type: 'expense' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(expCat._id.toString()) }),
            res,
        );
        expect(lastStatus(res)).toBe(400);
        expect(lastJson(res).message).toBe('Category type mismatch');
        expect(await Income.countDocuments({})).toBe(0);
    });

    test('archived Category → 400 archived', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income', isArchived: true });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        expect(lastStatus(res)).toBe(400);
        expect(lastJson(res).message).toBe('Category is archived');
    });

    test("cross-user Category id → 404 (existence not leaked)", async () => {
        const ownerCtx    = await makeUserWithKeys();
        const attackerCtx = await makeUserWithKeys();
        const cat = await makeCategory(ownerCtx.user, { type: 'income' });

        const res = mockRes();
        await controller.createIncome(
            mockReq({ user: attackerCtx.user, dataKey: attackerCtx.dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
        expect(lastJson(res).message).toBe('Category not found');
    });

    // ── 4. Encryption shape ─────────────────────────────────────────────────

    test('description stored AES-encrypted, not plaintext', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        const incomeId = lastJson(res).data._id;

        // Raw fetch bypasses schema, so we see the stored ciphertext as-is.
        const raw = await Income.collection.findOne({ _id: new mongoose.Types.ObjectId(incomeId.toString()) });
        expect(raw.description).not.toBe('October salary');
        expect(typeof raw.description).toBe('string');
        expect(raw.description.length).toBeGreaterThan(0);
        // base64 shape (the encryption wrapper outputs base64(IV||tag||CT)).
        expect(raw.description).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    // ── 5. Audit log written ────────────────────────────────────────────────

    test("AuditLog 'income.create' row is written after a successful create", async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        // logAudit is fire-and-forget; let the microtask queue flush.
        await new Promise((r) => setTimeout(r, 50));

        const entry = await AuditLog.findOne({ event: 'income.create', userId: user._id });
        expect(entry).not.toBeNull();
        expect(entry.metadata?.incomeId).toBe(lastJson(res).data._id.toString());
    });
});

// ── 6. IDOR ─────────────────────────────────────────────────────────────────

describe('income IDOR (cross-user 404)', () => {
    async function seedOwnerIncome() {
        const ownerCtx    = await makeUserWithKeys();
        const attackerCtx = await makeUserWithKeys();
        const cat = await makeCategory(ownerCtx.user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user: ownerCtx.user, dataKey: ownerCtx.dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        return {
            ownerCtx, attackerCtx,
            incomeId: lastJson(res).data._id,
        };
    }

    test('GET another user\'s income → 404', async () => {
        const { attackerCtx, incomeId } = await seedOwnerIncome();
        const res = mockRes();
        await controller.getIncomeById(
            mockReq({
                user: attackerCtx.user, dataKey: attackerCtx.dataKey,
                params: { id: incomeId.toString() },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
    });

    test('PUT another user\'s income → 404, row untouched', async () => {
        const { ownerCtx, attackerCtx, incomeId } = await seedOwnerIncome();
        const before = await Income.findById(incomeId);

        const res = mockRes();
        await controller.updateIncome(
            mockReq({
                user: attackerCtx.user, dataKey: attackerCtx.dataKey,
                params: { id: incomeId.toString() },
                body:   { amount: 9999 },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(404);

        const after = await Income.findById(incomeId);
        expect(after.amount).toBe(before.amount);
        expect(after.user.toString()).toBe(ownerCtx.user._id.toString());
    });

    test('DELETE another user\'s income → 404, row preserved', async () => {
        const { attackerCtx, incomeId } = await seedOwnerIncome();
        const res = mockRes();
        await controller.deleteIncome(
            mockReq({
                user: attackerCtx.user, dataKey: attackerCtx.dataKey,
                params: { id: incomeId.toString() },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
        expect(await Income.findById(incomeId)).not.toBeNull();
    });
});

// ── 7. serverAttestation tamper detection ───────────────────────────────────

describe('income serverAttestation', () => {
    test('verifies the freshly-signed payload', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        const incomeId = lastJson(res).data._id;

        const income = await Income.findById(incomeId);
        const ok = await signing.verifyRecord(
            {
                amount:    income.amount,
                category:  income.category,
                date:      income.date,
                user:      income.user,
                createdAt: income.createdAt,
            },
            income.serverAttestation,
            user,
        );
        expect(ok).toBe(true);
    });

    test('verify fails after direct-DB amount tamper', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        const incomeId = lastJson(res).data._id;

        // Bypass Mongoose schema and rewrite the amount underneath.
        await Income.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(incomeId.toString()) },
            { $set: { amount: 99999 } },
        );

        const income = await Income.findById(incomeId);
        const ok = await signing.verifyRecord(
            {
                amount:    income.amount,
                category:  income.category,
                date:      income.date,
                user:      income.user,
                createdAt: income.createdAt,
            },
            income.serverAttestation,
            user,
        );
        expect(ok).toBe(false);
    });
});

// ── 8. Recurring fields ─────────────────────────────────────────────────────

describe('recurring fields', () => {
    test('isRecurring=true + frequency persists both', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({
                user, dataKey,
                body: {
                    ...VALID_BODY(cat._id.toString()),
                    isRecurring:        true,
                    recurringFrequency: 'monthly',
                },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(201);
        const data = lastJson(res).data;
        expect(data.isRecurring).toBe(true);
        expect(data.recurringFrequency).toBe('monthly');
    });

    test('parentRecurringId defaults to null on new rows', async () => {
        const { user, dataKey } = await makeUserWithKeys();
        const cat = await makeCategory(user, { type: 'income' });
        const res = mockRes();
        await controller.createIncome(
            mockReq({ user, dataKey, body: VALID_BODY(cat._id.toString()) }),
            res,
        );
        const data = lastJson(res).data;
        expect(data.parentRecurringId).toBeNull();
    });
});
