/**
 * Tests for the default-category seed (Part 2).
 *
 * The seed has two correctness properties worth pinning:
 *   1. Distribution — exactly 10 rows, six expense + four income, with the
 *      colors/icons fixed by the Part-2 brief.
 *   2. Idempotent failure — a second seed for the same user must fail on
 *      the { user, name, type } unique index, NOT silently insert
 *      duplicates. Documented as "correct behavior, not a bug" in the brief.
 *
 * Uses mongodb-memory-server so the unique-index enforcement runs against
 * real Mongoose.
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
let seed;
let DEFAULTS;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    Category = require('../models/Category');
    ({ seedDefaultCategoriesForUser: seed, DEFAULT_CATEGORIES: DEFAULTS } = require('../utils/defaultCategories'));
    // Make sure the unique index actually exists on the in-memory server.
    // Without ensureIndexes, the index would be lazily built on first
    // insertMany and the dup test below would silently succeed.
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

function fakeUserId() {
    return new mongoose.Types.ObjectId();
}

describe('DEFAULT_CATEGORIES manifest', () => {
    test('contains exactly 10 entries (6 expense + 4 income)', () => {
        expect(DEFAULTS).toHaveLength(10);
        expect(DEFAULTS.filter((c) => c.type === 'expense')).toHaveLength(6);
        expect(DEFAULTS.filter((c) => c.type === 'income')).toHaveLength(4);
    });

    test('every entry has the required Category fields', () => {
        for (const c of DEFAULTS) {
            expect(typeof c.name).toBe('string');
            expect(c.name.length).toBeGreaterThan(0);
            expect(['expense', 'income', 'both']).toContain(c.type);
            expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
            expect(typeof c.icon).toBe('string');
            expect(typeof c.sortOrder).toBe('number');
        }
    });

    test('expected name+type pairs are present', () => {
        const expected = new Set([
            'Food|expense', 'Transport|expense', 'Bills|expense',
            'Shopping|expense', 'Healthcare|expense', 'Other|expense',
            'Salary|income', 'Freelance|income', 'Gift|income', 'Other|income',
        ]);
        const got = new Set(DEFAULTS.map((c) => `${c.name}|${c.type}`));
        expect(got).toEqual(expected);
    });

    test('"Other" appears once per side (expense+income are distinct rows)', () => {
        const others = DEFAULTS.filter((c) => c.name === 'Other');
        expect(others).toHaveLength(2);
        const types = others.map((c) => c.type).sort();
        expect(types).toEqual(['expense', 'income']);
    });
});

describe('seedDefaultCategoriesForUser', () => {
    test('inserts exactly 10 rows for a fresh user', async () => {
        const userId = fakeUserId();
        const inserted = await seed(userId);
        expect(inserted).toHaveLength(10);

        const inDb = await Category.find({ user: userId });
        expect(inDb).toHaveLength(10);
    });

    test('the 10 rows match the manifest by {name, type, color, icon, sortOrder}', async () => {
        const userId = fakeUserId();
        await seed(userId);

        const inDb = await Category.find({ user: userId }).sort({ type: 1, sortOrder: 1 }).lean();
        const manifest = [...DEFAULTS].sort((a, b) => {
            if (a.type !== b.type) return a.type.localeCompare(b.type);
            return a.sortOrder - b.sortOrder;
        });

        for (let i = 0; i < manifest.length; i++) {
            expect(inDb[i].name).toBe(manifest[i].name);
            expect(inDb[i].type).toBe(manifest[i].type);
            expect(inDb[i].color).toBe(manifest[i].color);
            expect(inDb[i].icon).toBe(manifest[i].icon);
            expect(inDb[i].sortOrder).toBe(manifest[i].sortOrder);
            expect(inDb[i].user.toString()).toBe(userId.toString());
            expect(inDb[i].isArchived).toBe(false);
        }
    });

    test('distribution: 6 expense + 4 income', async () => {
        const userId = fakeUserId();
        await seed(userId);
        expect(await Category.countDocuments({ user: userId, type: 'expense' })).toBe(6);
        expect(await Category.countDocuments({ user: userId, type: 'income' })).toBe(4);
    });

    test('two different users each get their own 10', async () => {
        const u1 = fakeUserId();
        const u2 = fakeUserId();
        await seed(u1);
        await seed(u2);
        expect(await Category.countDocuments({ user: u1 })).toBe(10);
        expect(await Category.countDocuments({ user: u2 })).toBe(10);
        // No cross-contamination on rows.
        const u1Names = await Category.find({ user: u1 }).distinct('name');
        const u2Names = await Category.find({ user: u2 }).distinct('name');
        expect(u1Names.sort()).toEqual(u2Names.sort());
    });

    test('seeding twice for the SAME user throws on the unique index', async () => {
        const userId = fakeUserId();
        await seed(userId);
        await expect(seed(userId)).rejects.toThrow();
        // Mongo's dup-key error surfaces with code 11000.
        try {
            await seed(userId);
        } catch (err) {
            expect(err.code === 11000 || /duplicate key/i.test(err.message)).toBe(true);
        }
        // No partial duplication on the second try — count stays at 10.
        expect(await Category.countDocuments({ user: userId })).toBe(10);
    });

    test('throws if userId is missing', async () => {
        await expect(seed(undefined)).rejects.toThrow(/userId is required/);
        await expect(seed(null)).rejects.toThrow(/userId is required/);
    });

    test('accepts an options.session pass-through without crashing', async () => {
        // Real transactions need a replica set; in-memory standalone won't
        // support them. We just verify the function tolerates the option
        // shape and forwards it without throwing on undefined/empty.
        const userId = fakeUserId();
        const result = await seed(userId, { session: undefined });
        expect(result).toHaveLength(10);
    });
});
