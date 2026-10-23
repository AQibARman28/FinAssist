/**
 * Data at rest: ciphertext integrity (no plaintext fallback), AAD binding of
 * each ciphertext to its owner and field, master-key rotation with key ids,
 * JWT secret rollover, AES-encrypted notes of any length, and three-state
 * record attestations.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const hex64 = () => crypto.randomBytes(32).toString('hex');
let mongo;

beforeAll(async () => {
    process.env.MASTER_ENCRYPTION_KEY = hex64();
    process.env.EMAIL_HASH_SECRET     = hex64();
    process.env.JWT_SECRET            = hex64();
    delete process.env.MASTER_ENCRYPTION_KEY_PREVIOUS;
    delete process.env.JWT_SECRET_PREVIOUS;
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

const enc = require('../utils/encryption');
const uid = () => new mongoose.Types.ObjectId();

describe('field encryption', () => {
    test('a bound ciphertext decrypts only for the same owner and field', async () => {
        const key = crypto.randomBytes(32);
        const alice = uid(), bob = uid();
        const blob = await enc.encrypt('Rent for March', key, enc.fieldContext('expense.description', alice));
        expect(blob.startsWith('v2:')).toBe(true);
        expect(await enc.decrypt(blob, key, enc.fieldContext('expense.description', alice))).toBe('Rent for March');
        await expect(enc.decrypt(blob, key, enc.fieldContext('expense.description', bob))).rejects.toThrow();
        await expect(enc.decrypt(blob, key, enc.fieldContext('goal.title', alice))).rejects.toThrow();
    });

    test('decryptOrNull never echoes a forged plaintext back as if it were real', async () => {
        const key = crypto.randomBytes(32);
        const ctx = enc.fieldContext('user.name', uid());
        expect(await enc.decryptOrNull('Pay attacker 5000', key, ctx)).toBeNull();
    });

    test('decryptOrNull returns null for a tampered ciphertext', async () => {
        const key = crypto.randomBytes(32);
        const ctx = enc.fieldContext('user.email', uid());
        const blob = await enc.encrypt('me@example.com', key, ctx);
        const raw = Buffer.from(blob.slice(3), 'base64');
        raw[raw.length - 1] ^= 0x01;
        expect(await enc.decryptOrNull(`v2:${raw.toString('base64')}`, key, ctx)).toBeNull();
    });

    test('safeDecrypt (the old name) no longer echoes its input', async () => {
        expect(await enc.safeDecrypt('not-a-ciphertext', crypto.randomBytes(32))).toBeNull();
    });

    test('blobs written before AAD binding still decrypt', async () => {
        const key = crypto.randomBytes(32);
        const legacy = await enc.encrypt('old description', key); // no context → v1 format
        expect(legacy.startsWith('v2:')).toBe(false);
        expect(await enc.decrypt(legacy, key, enc.fieldContext('expense.description', uid()))).toBe('old description');
    });
});

describe('master key ring', () => {
    test('wrapped data keys carry the id of the key that wrapped them', async () => {
        const wrapped = await enc.masterEncrypt('a'.repeat(64));
        expect(wrapped).toMatch(new RegExp(`^mk2:${enc.masterKeyId()}:`));
    });

    test('after a rotation, keys wrapped by the previous master still unwrap', async () => {
        const original = process.env.MASTER_ENCRYPTION_KEY;
        const wrappedOld = await enc.masterEncrypt('data-key-hex');
        process.env.MASTER_ENCRYPTION_KEY_PREVIOUS = original;
        process.env.MASTER_ENCRYPTION_KEY = hex64();
        try {
            expect(await enc.masterDecrypt(wrappedOld)).toBe('data-key-hex');
            expect(enc.needsRewrap(wrappedOld)).toBe(true);
            expect(enc.needsRewrap(await enc.masterEncrypt('x'))).toBe(false);
        } finally {
            process.env.MASTER_ENCRYPTION_KEY = original;
            delete process.env.MASTER_ENCRYPTION_KEY_PREVIOUS;
        }
    });

    test('legacy unprefixed wrapped keys unwrap with the current key', async () => {
        const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
        const native = require('../utils/nativeCrypto');
        const { ciphertext, iv, tag } = native.aesGcmEncrypt('legacy-key', key);
        const legacy = Buffer.concat([iv, tag, ciphertext]).toString('base64');
        expect(await enc.masterDecrypt(legacy)).toBe('legacy-key');
    });

    test('the rotation job re-wraps every data key and is idempotent', async () => {
        const User = require('../models/User');
        const { rewrapAllDataKeys } = require('../utils/keyRotation');
        await User.deleteMany({});
        const original = process.env.MASTER_ENCRYPTION_KEY;
        const dataKey = hex64();
        await User.collection.insertOne({ name: 'n', email: 'e', emailHash: 'h1', password: 'p', encryptedDataKey: await enc.masterEncrypt(dataKey) });

        process.env.MASTER_ENCRYPTION_KEY_PREVIOUS = original;
        process.env.MASTER_ENCRYPTION_KEY = hex64();
        try {
            expect(await rewrapAllDataKeys({ apply: true })).toEqual({ scanned: 1, rewrapped: 1 });
            expect(await rewrapAllDataKeys({ apply: true })).toEqual({ scanned: 1, rewrapped: 0 });
            delete process.env.MASTER_ENCRYPTION_KEY_PREVIOUS; // old key retired
            const u = await User.findOne({});
            expect(await enc.masterDecrypt(u.encryptedDataKey)).toBe(dataKey);
        } finally {
            process.env.MASTER_ENCRYPTION_KEY = original;
            delete process.env.MASTER_ENCRYPTION_KEY_PREVIOUS;
        }
    });
});

describe('JWT secret rollover', () => {
    test('tokens signed with the previous secret verify during the rollover window', () => {
        const native = require('../utils/nativeCrypto');
        const { jwtSecrets } = require('../utils/sessions');
        const old = process.env.JWT_SECRET;
        const token = native.signJwt({ id: 'u1' }, old, '5m');
        process.env.JWT_SECRET_PREVIOUS = old;
        process.env.JWT_SECRET = hex64();
        try {
            expect(native.verifyJwt(token, jwtSecrets()).id).toBe('u1');
            delete process.env.JWT_SECRET_PREVIOUS;
            expect(() => native.verifyJwt(token, jwtSecrets())).toThrow();
        } finally {
            process.env.JWT_SECRET = old;
            delete process.env.JWT_SECRET_PREVIOUS;
        }
    });
});

describe('notes', () => {
    const keyMgmt = require('../utils/keyManagement');
    const signing = require('../utils/signing');

    async function makeUser() {
        const dataKey = crypto.randomBytes(32);
        const user = { _id: uid(), ...(await keyMgmt.generateUserKeyBundle(dataKey)) };
        return { user, dataKey };
    }

    test('a 2,000-character note encrypts and decrypts (RSA capped notes at 190 bytes)', async () => {
        const { user, dataKey } = await makeUser();
        const note = 'é'.repeat(1000) + 'x'.repeat(1000);
        const blob = await signing.encryptNote(note, user, dataKey, 'expense.note');
        expect(await signing.decryptNote(blob, user, dataKey, 'expense.note')).toBe(note);
    });

    test('notes written with the old RSA scheme still decrypt', async () => {
        const { user, dataKey } = await makeUser();
        const legacy = await keyMgmt.rsaEncrypt('old short note', user.rsaPublicKey);
        expect(await signing.decryptNote(legacy, user, dataKey, 'expense.note')).toBe('old short note');
    });
});

describe('attestations', () => {
    const keyMgmt = require('../utils/keyManagement');
    const signing = require('../utils/signing');

    test('valid, missing and invalid attestations are told apart', async () => {
        const dataKey = crypto.randomBytes(32);
        const user = { _id: uid(), ...(await keyMgmt.generateUserKeyBundle(dataKey)) };
        const payload = { amount: 250, category: 'c1' };
        const sig = await signing.signRecord(payload, user, dataKey);
        expect(await signing.attestationStatus(payload, sig, user)).toBe('valid');
        expect(await signing.attestationStatus(payload, null, user)).toBe('missing');
        expect(await signing.attestationStatus({ ...payload, amount: 25 }, sig, user)).toBe('invalid');
    });
});
