/**
 * Part-3 expense acceptance tests.
 *
 * Pins the five scenarios the brief calls out at the controller / validator
 * boundary so they're reproducible in CI without the live server:
 *
 *   1. body with category="Food" (legacy string)  → 400 from zod (validator)
 *   2. body with a valid Category ObjectId        → 201
 *   3. body with another user's Category id       → 404 from guard
 *   4. body with an archived Category             → 400 from guard
 *   5. body with an income-only Category          → 400 from guard
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
let Expense;
let controller;
let expenseValidator;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category         = require('../models/Category');
    Expense          = require('../models/Expense');
    controller       = require('../controllers/expenseController');
    expenseValidator = require('../validators/expense');
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

function makeUser() {
    // No encryptedEccPrivateKey / rsaPublicKey on the test user — that
    // makes signRecord and encryptNote return null without throwing,
    // which is the documented behavior of those wrappers when the user
    // doesn't yet have a key bundle. We're testing the controller flow,
    // not crypto specifics.
    return { _id: new mongoose.Types.ObjectId() };
}

function mockReq({ user, dataKey, body = {}, params = {}, query = {} }) {
    return {
        user,
        dataKey: dataKey || crypto.randomBytes(32),
        body,
        params,
        query,
        ip:        '127.0.0.1',
        get:       () => 'test',
        requestId: 'test',
    };
}

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}

function lastStatus(res) {
    const call = res.status.mock.calls[res.status.mock.calls.length - 1];
    return call ? call[0] : 200;
}
function lastJson(res) {
    const call = res.json.mock.calls[res.json.mock.calls.length - 1];
    return call ? call[0] : null;
}

async function makeCategory(user, overrides = {}) {
    return Category.create({
        user:  user._id,
        name:  overrides.name  || `Cat-${Math.random().toString(36).slice(2, 8)}`,
        type:  overrides.type  || 'expense',
        color: overrides.color || '#aabbcc',
        icon:  overrides.icon  || 'utensils',
        ...overrides,
    });
}

// ── 1. Validator: legacy string category → 400 ──────────────────────────────

describe('expense.create validator (Part 3)', () => {
    test('category as a legacy enum string ("Food") is rejected', () => {
        const r = expenseValidator.create.safeParse({
            amount:      10,
            category:    'Food',
            description: 'lunch',
        });
        expect(r.success).toBe(false);
        // The error mentions the category field as an invalid id.
        expect(JSON.stringify(r.error.issues)).toMatch(/category/i);
    });

    test('category as a 24-hex ObjectId string is accepted (shape only)', () => {
        const r = expenseValidator.create.safeParse({
            amount:      10,
            category:    new mongoose.Types.ObjectId().toString(),
            description: 'lunch',
        });
        expect(r.success).toBe(true);
    });

    test('omitting category → rejected (no auto-categorization fallback any more)', () => {
        const r = expenseValidator.create.safeParse({
            amount:      10,
            description: 'lunch',
        });
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error.issues)).toMatch(/category/i);
    });

    test('update may omit category (it is optional on update)', () => {
        const r = expenseValidator.update.safeParse({ amount: 5 });
        expect(r.success).toBe(true);
    });

    test('update with category as a legacy string is rejected', () => {
        const r = expenseValidator.update.safeParse({ category: 'Food' });
        expect(r.success).toBe(false);
    });
});

// ── 2. Controller: valid id → 201 ───────────────────────────────────────────

describe('createExpense (controller)', () => {
    test('valid Category id (type=expense) → 201, persisted with the ref', async () => {
        const user = makeUser();
        const cat  = await makeCategory(user, { type: 'expense' });

        const res = mockRes();
        await controller.createExpense(
            mockReq({
                user,
                body: { amount: 12.34, category: cat._id.toString(), description: 'lunch' },
            }),
            res,
        );

        expect(lastStatus(res)).toBe(201);
        const data = lastJson(res).data;
        expect(data.user.toString()).toBe(user._id.toString());
        expect(data.amount).toBe(12.34);
        expect(data.category.toString()).toBe(cat._id.toString());

        // Persisted.
        const inDb = await Expense.findOne({ user: user._id });
        expect(inDb).not.toBeNull();
        expect(inDb.category.toString()).toBe(cat._id.toString());
    });

    test("type='both' Category accepted for an expense", async () => {
        const user = makeUser();
        const cat  = await makeCategory(user, { type: 'both' });
        const res  = mockRes();
        await controller.createExpense(
            mockReq({
                user,
                body: { amount: 1, category: cat._id.toString(), description: 'x' },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(201);
    });

    // ── 3. Cross-user → 404 ─────────────────────────────────────────────────

    test("another user's Category id → 404 (existence not leaked)", async () => {
        const owner    = makeUser();
        const attacker = makeUser();
        const cat = await makeCategory(owner);

        const res = mockRes();
        await controller.createExpense(
            mockReq({
                user: attacker,
                body: { amount: 1, category: cat._id.toString(), description: 'attempt' },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
        expect(lastJson(res).message).toBe('Category not found');

        // No expense was created.
        expect(await Expense.countDocuments({})).toBe(0);
    });

    test('completely fabricated Category id → 404', async () => {
        const user = makeUser();
        const res  = mockRes();
        await controller.createExpense(
            mockReq({
                user,
                body: { amount: 1, category: new mongoose.Types.ObjectId().toString(), description: 'x' },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
    });

    // ── 4. Archived → 400 ───────────────────────────────────────────────────

    test('archived Category → 400 from guard', async () => {
        const user = makeUser();
        const cat  = await makeCategory(user, { type: 'expense', isArchived: true });
        const res  = mockRes();
        await controller.createExpense(
            mockReq({
                user,
                body: { amount: 1, category: cat._id.toString(), description: 'x' },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(400);
        expect(lastJson(res).message).toBe('Category is archived');
        expect(await Expense.countDocuments({})).toBe(0);
    });

    // ── 5. Type mismatch → 400 ──────────────────────────────────────────────

    test('income-only Category used for an expense → 400 type mismatch', async () => {
        const user = makeUser();
        const cat  = await makeCategory(user, { type: 'income' });
        const res  = mockRes();
        await controller.createExpense(
            mockReq({
                user,
                body: { amount: 1, category: cat._id.toString(), description: 'x' },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(400);
        expect(lastJson(res).message).toBe('Category type mismatch');
        expect(await Expense.countDocuments({})).toBe(0);
    });
});

// ── updateExpense: guard runs on category change ────────────────────────────

describe('updateExpense (controller, Part 3)', () => {
    test('changing category to a valid one → 200', async () => {
        const user = makeUser();
        const dataKey = crypto.randomBytes(32);
        const oldCat = await makeCategory(user, { type: 'expense', name: 'Old' });
        const newCat = await makeCategory(user, { type: 'expense', name: 'New' });

        // Use the same dataKey for create AND update so the description
        // round-trips. (decryptExpense uses safeDecrypt which would fall
        // back to the ciphertext on mismatch, but we want a clean test.)
        let res = mockRes();
        await controller.createExpense(
            mockReq({
                user, dataKey,
                body: { amount: 1, category: oldCat._id.toString(), description: 'x' },
            }),
            res,
        );
        const expId = lastJson(res).data._id.toString();

        res = mockRes();
        await controller.updateExpense(
            mockReq({
                user, dataKey,
                params: { id: expId },
                body:   { category: newCat._id.toString() },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(200);
        const inDb = await Expense.findById(expId);
        expect(inDb.category.toString()).toBe(newCat._id.toString());
    });

    test('changing to a cross-user category → 404 from guard, row unchanged', async () => {
        const user      = makeUser();
        const otherUser = makeUser();
        const dataKey   = crypto.randomBytes(32);
        const myCat     = await makeCategory(user,      { type: 'expense' });
        const theirCat  = await makeCategory(otherUser, { type: 'expense' });

        let res = mockRes();
        await controller.createExpense(
            mockReq({
                user, dataKey,
                body: { amount: 1, category: myCat._id.toString(), description: 'x' },
            }),
            res,
        );
        const expId = lastJson(res).data._id.toString();

        res = mockRes();
        await controller.updateExpense(
            mockReq({
                user, dataKey,
                params: { id: expId },
                body:   { category: theirCat._id.toString() },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
        expect(lastJson(res).message).toBe('Category not found');
        const inDb = await Expense.findById(expId);
        expect(inDb.category.toString()).toBe(myCat._id.toString());
    });

    test('changing to an income-only category → 400 type mismatch', async () => {
        const user    = makeUser();
        const dataKey = crypto.randomBytes(32);
        const expCat = await makeCategory(user, { type: 'expense' });
        const incCat = await makeCategory(user, { type: 'income' });

        let res = mockRes();
        await controller.createExpense(
            mockReq({
                user, dataKey,
                body: { amount: 1, category: expCat._id.toString(), description: 'x' },
            }),
            res,
        );
        const expId = lastJson(res).data._id.toString();

        res = mockRes();
        await controller.updateExpense(
            mockReq({
                user, dataKey,
                params: { id: expId },
                body:   { category: incCat._id.toString() },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(400);
        expect(lastJson(res).message).toBe('Category type mismatch');
    });

    test('update without touching category — guard is NOT invoked', async () => {
        const user    = makeUser();
        const dataKey = crypto.randomBytes(32);
        const cat = await makeCategory(user, { type: 'expense' });

        let res = mockRes();
        await controller.createExpense(
            mockReq({
                user, dataKey,
                body: { amount: 1, category: cat._id.toString(), description: 'x' },
            }),
            res,
        );
        const expId = lastJson(res).data._id.toString();

        res = mockRes();
        await controller.updateExpense(
            mockReq({
                user, dataKey,
                params: { id: expId },
                body:   { amount: 99 },
            }),
            res,
        );
        expect(lastStatus(res)).toBe(200);
        const inDb = await Expense.findById(expId);
        expect(inDb.amount).toBe(99);
        expect(inDb.category.toString()).toBe(cat._id.toString());
    });
});
