/**
 * Unit tests for utils/totpGuard — TOTP replay protection + per-user rate
 * limit. Validates SEC-1 Phase 4 acceptance criterion: "Replayed TOTP code
 * within 90s of original use → rejected".
 *
 * We mock a User-shaped object and a stub `decrypt` so the test doesn't
 * touch Mongo or the real AES-GCM helper. The TOTP itself is generated
 * from a real base32 secret via speakeasy so the verify call exercises
 * the real nativeCrypto verifyTotp.
 */

const crypto = require('node:crypto');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
});

// Stub utils/encryption.decrypt so we don't have to AES-encrypt the secret
// for the test — the guard receives the user object's twoFactorSecret as
// an "encrypted blob" but we make decrypt return whatever we want.
jest.mock('../utils/encryption', () => ({
    decrypt: jest.fn(async (blob /* , dataKey */) => blob),
}));

const speakeasy = require('speakeasy');
const { checkAndRecordTotp } = require('../utils/totpGuard');

function makeUser(secretB32) {
    return {
        twoFactorSecret:    secretB32,    // shape: any string; stub decrypt returns as-is
        recentTotpCodes:    [],
        failedTotpAttempts: 0,
        firstFailedTotpAt:  null,
        totpLockedUntil:    null,
        save: async () => {},
    };
}

function currentTotp(secretB32) {
    return speakeasy.totp({ secret: secretB32, encoding: 'base32', algorithm: 'sha256' });
}

describe('totpGuard.checkAndRecordTotp', () => {
    test('accepts a valid code on first use', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        const code = currentTotp(secret);
        const result = await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(result).toEqual({ ok: true });
        expect(user.recentTotpCodes).toHaveLength(1);
        expect(user.recentTotpCodes[0].code).toBe(code);
    });

    test('rejects the same code on REPLAY inside the 90s window', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        const code = currentTotp(secret);

        const first  = await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(first.ok).toBe(true);

        const second = await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(second).toEqual({ ok: false, status: 401, replay: true });
    });

    test('replayed code increments the failure counter', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        const code = currentTotp(secret);
        await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(user.failedTotpAttempts).toBe(0);
        await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(user.failedTotpAttempts).toBe(1);
    });

    test('wrong code → status 401 and increments failures', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        const result = await checkAndRecordTotp(user, Buffer.alloc(32), '000000');
        expect(result.ok).toBe(false);
        expect(result.status).toBe(401);
        expect(result.replay).toBeUndefined();
        expect(user.failedTotpAttempts).toBe(1);
    });

    test('5 failures inside the window → status 423 on subsequent attempts', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        for (let i = 0; i < 5; i++) {
            await checkAndRecordTotp(user, Buffer.alloc(32), '000000');
        }
        expect(user.totpLockedUntil).toBeInstanceOf(Date);
        expect(user.totpLockedUntil.getTime()).toBeGreaterThan(Date.now());
        // Even with a correct code the user stays locked out
        const r = await checkAndRecordTotp(user, Buffer.alloc(32), currentTotp(secret));
        expect(r).toEqual({ ok: false, status: 423 });
    });

    test('valid code AFTER pruning out the stale replay entry succeeds', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        const code = currentTotp(secret);

        // Plant a >90s-old entry to ensure pruning works.
        user.recentTotpCodes = [{ code, usedAt: new Date(Date.now() - 91_000) }];

        const result = await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(result).toEqual({ ok: true });
        // The stale entry was pruned and the fresh entry was added.
        expect(user.recentTotpCodes).toHaveLength(1);
        expect(user.recentTotpCodes[0].usedAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
    });

    test('successful verify clears prior failure counters', async () => {
        const secret = speakeasy.generateSecret({ length: 20 }).base32;
        const user = makeUser(secret);
        user.failedTotpAttempts = 3;
        user.firstFailedTotpAt  = new Date();

        const code = currentTotp(secret);
        const result = await checkAndRecordTotp(user, Buffer.alloc(32), code);
        expect(result.ok).toBe(true);
        expect(user.failedTotpAttempts).toBe(0);
        expect(user.firstFailedTotpAt).toBeNull();
    });
});
