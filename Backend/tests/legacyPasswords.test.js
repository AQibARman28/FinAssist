/**
 * Legacy PBKDF2 hashes (10,000 iterations, from the pre-SEC-1 Python crypto)
 * are wrapped in Argon2id at rest, so dormant accounts don't stay cheap to
 * crack while they wait for a login to upgrade them.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo, User, legacy;

function pbkdf2Legacy(password, iterations = 10_000) {
    const salt = crypto.randomBytes(16);
    const dk = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    return `pbkdf2-sha256$${iterations}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User = require('../models/User');
    legacy = require('../utils/legacyPasswords');
    await User.init();
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await User.deleteMany({}); });

async function legacyUser(password) {
    const stored = pbkdf2Legacy(password);
    await User.collection.insertOne({ name: 'n', email: 'e', emailHash: crypto.randomBytes(8).toString('hex'), password: stored, passwordHashScheme: 'pbkdf2' });
    return { user: await User.findOne({}), stored };
}

test('wrapping removes the PBKDF2 output from storage', async () => {
    const { stored } = await legacyUser('Old-Password-1');
    const wrapped = await legacy.wrapLegacyPbkdf2(stored);
    expect(wrapped).not.toContain(stored.split('$')[3]);
    expect(wrapped).toMatch(/^wrap\$pbkdf2-sha256\$10000\$[0-9a-f]+\$32\$\$argon2id\$/);
});

test('a wrapped hash still verifies the right password and rejects a wrong one', async () => {
    const { user, stored } = await legacyUser('Old-Password-1');
    user.password = await legacy.wrapLegacyPbkdf2(stored);
    user.passwordHashScheme = 'pbkdf2-argon2id';
    await User.updateOne({ _id: user._id }, { $set: { password: user.password, passwordHashScheme: user.passwordHashScheme } });
    const fresh = await User.findById(user._id);
    expect(await fresh.comparePassword('Old-Password-1')).toBe(true);
    expect(await fresh.comparePassword('old-password-1')).toBe(false);
});

test('the migration wraps every legacy account and is idempotent', async () => {
    await legacyUser('Old-Password-1');
    expect(await legacy.wrapAllLegacyHashes({ apply: true })).toEqual({ scanned: 1, wrapped: 1 });
    expect(await legacy.wrapAllLegacyHashes({ apply: true })).toEqual({ scanned: 0, wrapped: 0 });
    expect((await User.findOne({})).passwordHashScheme).toBe('pbkdf2-argon2id');
});

test('a dry run reports without writing', async () => {
    const { stored } = await legacyUser('Old-Password-1');
    expect(await legacy.wrapAllLegacyHashes({ apply: false })).toEqual({ scanned: 1, wrapped: 0 });
    expect((await User.findOne({})).password).toBe(stored);
});
