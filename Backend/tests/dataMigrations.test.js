/**
 * One-time data migrations that ship with the data-at-rest hardening:
 * upgrading v1 ciphertexts and RSA notes to owner+field bound v2, and
 * establishing an attestation baseline for records signed before re-signing
 * on update existed.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
});

let mongo, User, Expense, Goal, enc, keyMgmt, signing, migrations;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User = require('../models/User');
    Expense = require('../models/Expense');
    Goal = require('../models/Goal');
    enc = require('../utils/encryption');
    keyMgmt = require('../utils/keyManagement');
    signing = require('../utils/signing');
    migrations = require('../utils/dataMigrations');
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
});

// A user and records exactly as the pre-hardening code wrote them: v1 field
// ciphertexts (no AAD) and an RSA-OAEP note.
async function legacyFixture() {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const dataKey = Buffer.from(rawKey, 'hex');
    const bundle = await keyMgmt.generateUserKeyBundle(dataKey); // no userId → v1 private keys
    const _id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
        _id, emailHash: 'h-' + _id, password: 'x', passwordHashScheme: 'argon2id',
        name: await enc.encrypt('Ada', dataKey), email: await enc.encrypt('ada@example.com', dataKey),
        encryptedDataKey: await enc.masterEncrypt(rawKey), ...bundle,
    });
    const cat = new mongoose.Types.ObjectId();
    const expenseId = new mongoose.Types.ObjectId();
    await Expense.collection.insertOne({
        _id: expenseId, user: _id, amount: 120, category: cat, date: new Date(),
        description: await enc.encrypt('Groceries', dataKey),
        note: await keyMgmt.rsaEncrypt('paid cash', bundle.rsaPublicKey),
    });
    return { _id, dataKey, expenseId };
}

describe('field re-encryption', () => {
    test('v1 ciphertexts and RSA notes become bound v2 values that still read correctly', async () => {
        const { _id, dataKey, expenseId } = await legacyFixture();
        const r = await migrations.upgradeFieldEncryption({ apply: true });
        expect(r.unreadable).toBe(0);
        expect(r.upgraded).toBeGreaterThanOrEqual(6); // name, email, 2 private keys, description, note

        const user = await User.findById(_id).lean();
        expect(user.name.startsWith('v2:')).toBe(true);
        expect(await enc.openField(user.name, dataKey, enc.FIELDS.userName, _id)).toBe('Ada');
        expect(await enc.openField(user.email, dataKey, enc.FIELDS.userEmail, _id)).toBe('ada@example.com');

        const e = await Expense.findById(expenseId).lean();
        expect(await enc.openField(e.description, dataKey, enc.FIELDS.expenseDescription, _id)).toBe('Groceries');
        expect(e.note.startsWith('v2:')).toBe(true);
        expect(await signing.decryptNote(e.note, user, dataKey, enc.FIELDS.expenseNote)).toBe('paid cash');
    });

    test('a second run has nothing left to upgrade', async () => {
        await legacyFixture();
        await migrations.upgradeFieldEncryption({ apply: true });
        expect((await migrations.upgradeFieldEncryption({ apply: true })).upgraded).toBe(0);
    });

    test('a dry run reports without writing', async () => {
        const { _id } = await legacyFixture();
        const before = (await User.findById(_id).lean()).name;
        const r = await migrations.upgradeFieldEncryption({ apply: false });
        expect(r.upgraded).toBeGreaterThan(0);
        expect((await User.findById(_id).lean()).name).toBe(before);
    });

    test('a value that isn\'t valid ciphertext is reported, and only sealed when the operator opts in', async () => {
        const { _id, dataKey } = await legacyFixture();
        await User.collection.updateOne({ _id }, { $set: { name: 'Plain Name From 2024' } });
        expect((await migrations.upgradeFieldEncryption({ apply: true })).unreadable).toBe(1);
        expect((await User.findById(_id).lean()).name).toBe('Plain Name From 2024');

        await migrations.upgradeFieldEncryption({ apply: true, sealPlaintext: true });
        const user = await User.findById(_id).lean();
        expect(await enc.openField(user.name, dataKey, enc.FIELDS.userName, _id)).toBe('Plain Name From 2024');
    });
});

describe('attestation baseline', () => {
    test('records without a valid attestation are listed in a dry run and signed on apply', async () => {
        const { _id, dataKey, expenseId } = await legacyFixture();
        await migrations.upgradeFieldEncryption({ apply: true });

        const dry = await migrations.reattestRecords({ apply: false });
        expect(dry.resigned).toBe(0);
        expect(dry.needing.map((n) => n.id)).toContain(String(expenseId));

        const applied = await migrations.reattestRecords({ apply: true });
        expect(applied.resigned).toBe(1);

        const user = await User.findById(_id).lean();
        const e = await Expense.findById(expenseId).lean();
        expect(await signing.attestationStatus({ amount: e.amount, category: e.category }, e.serverAttestation, user)).toBe('valid');
        expect((await migrations.reattestRecords({ apply: true })).resigned).toBe(0);
    });
});
