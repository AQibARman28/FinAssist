/**
 * Tests for the Category collection (Part 1).
 *
 * Uses mongodb-memory-server so we exercise real Mongoose constraints
 * (compound unique index, immutable path, schema validation) without
 * touching the dev Atlas DB. The validator schemas are tested at the zod
 * level (`.strict()`, type-not-in-update) so we don't need to spin Express
 * for those assertions.
 *
 * Acceptance coverage targets (from the brief):
 *   ✓ create happy path
 *   ✓ duplicate {user, name, type} → 409
 *   ✓ .strict() rejection of unknown body keys
 *   ✓ type immutable on update (validator level)
 *   ✓ soft-delete behavior (DELETE default → isArchived: true)
 *   ✓ hard-delete with no refs → success
 *   ✓ hard-delete WITH refs → 409
 *   ✓ cross-user IDOR → 404 on GET, PUT, DELETE
 *   ✓ list filtering (type, includeArchived) + sort order
 *   ✓ same name different type allowed
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Avoid the startup secret-check IIFE running here — we never import index.js.
beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
});

let mongo;
let Category;
let Expense;
let controller;
let validator;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category   = require('../models/Category');
    Expense    = require('../models/Expense');
    controller = require('../controllers/categoryController');
    validator  = require('../validators/category');
    // Force the compound unique index to build before any test runs.
    // Without this the index is built lazily on first insert and can
    // race against the second insert in the duplicate test.
    await Category.init();
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

// ── Test helpers ─────────────────────────────────────────────────────────────

function fakeUser() {
    return { _id: new mongoose.Types.ObjectId() };
}

function mockReq({ user, body = {}, params = {}, query = {} }) {
    return {
        user,
        body,
        params,
        query,
        ip:  '127.0.0.1',
        get: (header) => (header === 'User-Agent' ? 'jest' : null),
        requestId: 'test',
    };
}

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}

function lastJson(res) {
    const call = res.json.mock.calls[res.json.mock.calls.length - 1];
    return call ? call[0] : null;
}

function lastStatus(res) {
    const call = res.status.mock.calls[res.status.mock.calls.length - 1];
    return call ? call[0] : 200; // default if status never called
}

const SAMPLE = { name: 'Food', type: 'expense', color: '#aabbcc', icon: 'utensils' };

// ── 1. Validator-layer tests ─────────────────────────────────────────────────

describe('category validators (zod)', () => {
    test('create schema: happy path parses', () => {
        const r = validator.create.safeParse(SAMPLE);
        expect(r.success).toBe(true);
    });

    test('create schema: rejects unknown key (mass-assignment guard)', () => {
        const r = validator.create.safeParse({ ...SAMPLE, userId: 'spoof' });
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error.issues)).toMatch(/userId/);
    });

    test('create schema: rejects invalid color', () => {
        const r = validator.create.safeParse({ ...SAMPLE, color: 'red' });
        expect(r.success).toBe(false);
    });

    test('create schema: rejects unlisted icon', () => {
        const r = validator.create.safeParse({ ...SAMPLE, icon: 'rocket' });
        expect(r.success).toBe(false);
    });

    test('update schema: rejects `type` field (immutability boundary)', () => {
        const r = validator.update.safeParse({ type: 'income' });
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error.issues)).toMatch(/type/);
    });

    test('update schema: accepts a single allowed field', () => {
        const r = validator.update.safeParse({ name: 'Renamed' });
        expect(r.success).toBe(true);
    });

    test('update schema: rejects empty body', () => {
        const r = validator.update.safeParse({});
        expect(r.success).toBe(false);
    });
});

// ── 2. Controller tests ──────────────────────────────────────────────────────

describe('createCategory', () => {
    test('happy path → 201 with the saved doc', async () => {
        const user = fakeUser();
        const req = mockReq({ user, body: SAMPLE });
        const res = mockRes();
        await controller.createCategory(req, res);

        expect(lastStatus(res)).toBe(201);
        const payload = lastJson(res);
        expect(payload.success).toBe(true);
        expect(payload.data.name).toBe('Food');
        expect(payload.data.user.toString()).toBe(user._id.toString());
        expect(payload.data.isArchived).toBe(false);
    });

    test('duplicate {user, name, type} → 409', async () => {
        const user = fakeUser();
        await controller.createCategory(mockReq({ user, body: SAMPLE }), mockRes());

        const res = mockRes();
        await controller.createCategory(mockReq({ user, body: SAMPLE }), res);
        expect(lastStatus(res)).toBe(409);
        expect(lastJson(res).success).toBe(false);
    });

    test('same name, different type → 201 (allowed)', async () => {
        const user = fakeUser();
        await controller.createCategory(
            mockReq({ user, body: { ...SAMPLE, type: 'expense' } }),
            mockRes(),
        );
        const res = mockRes();
        await controller.createCategory(
            mockReq({ user, body: { ...SAMPLE, type: 'income' } }),
            res,
        );
        expect(lastStatus(res)).toBe(201);
    });

    test('two users can each have the same {name, type}', async () => {
        const u1 = fakeUser();
        const u2 = fakeUser();
        await controller.createCategory(mockReq({ user: u1, body: SAMPLE }), mockRes());
        const res = mockRes();
        await controller.createCategory(mockReq({ user: u2, body: SAMPLE }), res);
        expect(lastStatus(res)).toBe(201);
    });

    test('hex color regex enforced by the model', async () => {
        const user = fakeUser();
        const res = mockRes();
        await controller.createCategory(
            mockReq({ user, body: { ...SAMPLE, color: 'not-a-hex' } }),
            res,
        );
        expect(lastStatus(res)).toBe(400);
    });
});

describe('getCategories', () => {
    async function seed(user) {
        await Category.create([
            { user: user._id, name: 'B-food',   type: 'expense', color: '#111111', icon: 'cart',   sortOrder: 2 },
            { user: user._id, name: 'A-rent',   type: 'expense', color: '#222222', icon: 'home',   sortOrder: 1 },
            { user: user._id, name: 'Salary',   type: 'income',  color: '#333333', icon: 'wallet', sortOrder: 0 },
            { user: user._id, name: 'Archived', type: 'expense', color: '#444444', icon: 'more',   sortOrder: 5, isArchived: true },
        ]);
    }

    test('default: only active, sorted by sortOrder asc then name asc', async () => {
        const user = fakeUser();
        await seed(user);
        const res = mockRes();
        await controller.getCategories(mockReq({ user }), res);

        const data = lastJson(res).data;
        expect(data.map((c) => c.name)).toEqual(['Salary', 'A-rent', 'B-food']);
        // Archived excluded.
        expect(data.find((c) => c.name === 'Archived')).toBeUndefined();
    });

    test('filter by type=expense', async () => {
        const user = fakeUser();
        await seed(user);
        const res = mockRes();
        await controller.getCategories(mockReq({ user, query: { type: 'expense' } }), res);
        const data = lastJson(res).data;
        expect(data.every((c) => c.type === 'expense')).toBe(true);
        expect(data.map((c) => c.name)).toEqual(['A-rent', 'B-food']);
    });

    test('includeArchived=true returns the archived ones too', async () => {
        const user = fakeUser();
        await seed(user);
        const res = mockRes();
        await controller.getCategories(mockReq({ user, query: { includeArchived: 'true' } }), res);
        const names = lastJson(res).data.map((c) => c.name);
        expect(names).toContain('Archived');
    });

    test('owner-scoped: does not return another user\'s rows', async () => {
        const u1 = fakeUser();
        const u2 = fakeUser();
        await seed(u1);
        const res = mockRes();
        await controller.getCategories(mockReq({ user: u2 }), res);
        expect(lastJson(res).data).toEqual([]);
    });
});

describe('getCategoryById', () => {
    test('owner can fetch their own', async () => {
        const user = fakeUser();
        const cat  = await Category.create({ user: user._id, ...SAMPLE });
        const res  = mockRes();
        await controller.getCategoryById(mockReq({ user, params: { id: cat._id.toString() } }), res);
        expect(lastStatus(res)).toBe(200);
        expect(lastJson(res).data._id.toString()).toBe(cat._id.toString());
    });

    test('cross-user → 404 (existence not leaked)', async () => {
        const owner    = fakeUser();
        const attacker = fakeUser();
        const cat = await Category.create({ user: owner._id, ...SAMPLE });
        const res = mockRes();
        await controller.getCategoryById(
            mockReq({ user: attacker, params: { id: cat._id.toString() } }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
    });
});

describe('updateCategory', () => {
    test('owner update happy path', async () => {
        const user = fakeUser();
        const cat  = await Category.create({ user: user._id, ...SAMPLE });
        const res  = mockRes();
        await controller.updateCategory(
            mockReq({ user, params: { id: cat._id.toString() }, body: { name: 'Groceries', color: '#ff0000' } }),
            res,
        );
        expect(lastStatus(res)).toBe(200);
        const data = lastJson(res).data;
        expect(data.name).toBe('Groceries');
        expect(data.color).toBe('#ff0000');
        expect(data.type).toBe('expense');
    });

    test('cross-user update → 404 (no row changed)', async () => {
        const owner    = fakeUser();
        const attacker = fakeUser();
        const cat = await Category.create({ user: owner._id, ...SAMPLE });
        const res = mockRes();
        await controller.updateCategory(
            mockReq({ user: attacker, params: { id: cat._id.toString() }, body: { name: 'Hijacked' } }),
            res,
        );
        expect(lastStatus(res)).toBe(404);

        // And the original is untouched.
        const reloaded = await Category.findById(cat._id);
        expect(reloaded.name).toBe('Food');
    });

    test('renaming into another category\'s {name, type} → 409', async () => {
        const user = fakeUser();
        await Category.create({ user: user._id, name: 'Food',   type: 'expense', color: '#aaaaaa', icon: 'utensils' });
        const other = await Category.create({ user: user._id, name: 'Travel', type: 'expense', color: '#bbbbbb', icon: 'plane' });

        const res = mockRes();
        await controller.updateCategory(
            mockReq({ user, params: { id: other._id.toString() }, body: { name: 'Food' } }),
            res,
        );
        expect(lastStatus(res)).toBe(409);
    });
});

describe('deleteCategory', () => {
    test('default (no force) → 200 + isArchived: true (soft delete)', async () => {
        const user = fakeUser();
        const cat = await Category.create({ user: user._id, ...SAMPLE });
        const res = mockRes();
        await controller.deleteCategory(
            mockReq({ user, params: { id: cat._id.toString() }, query: {} }),
            res,
        );
        expect(lastStatus(res)).toBe(200);
        const reloaded = await Category.findById(cat._id);
        expect(reloaded.isArchived).toBe(true);
    });

    test('force=true with no refs → 200, row removed', async () => {
        const user = fakeUser();
        const cat = await Category.create({ user: user._id, ...SAMPLE });
        const res = mockRes();
        await controller.deleteCategory(
            mockReq({ user, params: { id: cat._id.toString() }, query: { force: 'true' } }),
            res,
        );
        expect(lastStatus(res)).toBe(200);
        const reloaded = await Category.findById(cat._id);
        expect(reloaded).toBeNull();
    });

    test('force=true WITH expense references → 409, row preserved', async () => {
        // Part 3 made Expense.category an ObjectId ref, so a real insert
        // is the right way to exercise this — no more spyOn workaround.
        const user = fakeUser();
        const cat  = await Category.create({ user: user._id, ...SAMPLE });

        await Expense.create({
            user:        user._id,
            amount:      42,
            category:    cat._id,
            description: 'real-insert',
            date:        new Date(),
        });

        const res = mockRes();
        await controller.deleteCategory(
            mockReq({ user, params: { id: cat._id.toString() }, query: { force: 'true' } }),
            res,
        );

        expect(lastStatus(res)).toBe(409);
        expect(lastJson(res).refs.expenses).toBe(1);

        const reloaded = await Category.findById(cat._id);
        expect(reloaded).not.toBeNull();
    });

    test('cross-user delete → 404', async () => {
        const owner    = fakeUser();
        const attacker = fakeUser();
        const cat = await Category.create({ user: owner._id, ...SAMPLE });
        const res = mockRes();
        await controller.deleteCategory(
            mockReq({ user: attacker, params: { id: cat._id.toString() }, query: { force: 'true' } }),
            res,
        );
        expect(lastStatus(res)).toBe(404);
        const reloaded = await Category.findById(cat._id);
        expect(reloaded).not.toBeNull();
    });

    test('soft-deleting an already-archived row is idempotent (still 200)', async () => {
        const user = fakeUser();
        const cat = await Category.create({ user: user._id, ...SAMPLE, isArchived: true });
        const res = mockRes();
        await controller.deleteCategory(
            mockReq({ user, params: { id: cat._id.toString() }, query: {} }),
            res,
        );
        expect(lastStatus(res)).toBe(200);
        const reloaded = await Category.findById(cat._id);
        expect(reloaded.isArchived).toBe(true);
    });
});
