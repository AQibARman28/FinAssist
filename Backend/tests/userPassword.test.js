/**
 * Verifies the lazy password migration path in models/User.js.
 *
 *   - A user document holding a legacy PBKDF2 hash (the format produced by
 *     the Python-era pre('save') hook) must `comparePassword` true with the
 *     correct password and false with the wrong one — without ever calling
 *     Python, without rehashing.
 *   - A user document with an argon2id hash must verify via the native
 *     argon2 path.
 *
 * No DB is touched: we instantiate User as a Mongoose document but never
 * call .save() — comparePassword is a method on the instance.
 */

const crypto = require('node:crypto');
const native = require('../utils/nativeCrypto');

// stub the mongoose dependency surface for User so the unit test doesn't
// require a live MongoDB connection
jest.mock('mongoose', () => {
    const actual = jest.requireActual('mongoose');
    return {
        ...actual,
        model: (name, schema) => {
            // create a model bound to a brand-new connection-less mongoose
            // instance so other tests / app instances aren't polluted
            const m = new actual.Mongoose();
            return m.model(name, schema);
        },
    };
});

const User = require('../models/User');

function makeLegacyPbkdf2(password, iterations = 1000) {
    const salt = crypto.randomBytes(16);
    const dk = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    return `pbkdf2-sha256$${iterations}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

describe('User.comparePassword: legacy PBKDF2 → argon2id branch', () => {
    test('legacy hash + correct password verifies', async () => {
        const stored = makeLegacyPbkdf2('horse-battery-staple');
        const user = new User({
            name: 'x', email: 'x@example.com', emailHash: 'h',
            password: stored,
            passwordHashScheme: 'pbkdf2',
        });
        expect(await user.comparePassword('horse-battery-staple')).toBe(true);
    });

    test('legacy hash + wrong password rejects', async () => {
        const stored = makeLegacyPbkdf2('horse-battery-staple');
        const user = new User({
            name: 'x', email: 'x@example.com', emailHash: 'h',
            password: stored,
            passwordHashScheme: 'pbkdf2',
        });
        expect(await user.comparePassword('other')).toBe(false);
    });

    test('argon2id hash + correct password verifies', async () => {
        const stored = await native.hashPassword('horse-battery-staple');
        const user = new User({
            name: 'x', email: 'x@example.com', emailHash: 'h',
            password: stored,
            passwordHashScheme: 'argon2id',
        });
        expect(await user.comparePassword('horse-battery-staple')).toBe(true);
    });

    test('inferred scheme from hash prefix works when field is missing', async () => {
        // Documents predating the schema migration won't have passwordHashScheme.
        const stored = makeLegacyPbkdf2('horse-battery-staple');
        const user = new User({
            name: 'x', email: 'x@example.com', emailHash: 'h',
            password: stored,
            // passwordHashScheme intentionally omitted — mongoose default would
            // populate 'argon2id', so override after construction.
        });
        user.passwordHashScheme = undefined;
        expect(await user.comparePassword('horse-battery-staple')).toBe(true);
    });
});
