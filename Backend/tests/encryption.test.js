/**
 * Wrapper-level tests for Backend/utils/encryption.js — covers the SEC-1
 * Phase 2 audit items:
 *   - The AES-GCM helpers source IVs only from crypto.randomBytes(12) inside
 *     nativeCrypto.aesGcmEncrypt. None of the wrappers expose an IV
 *     parameter, so a caller cannot supply a reused IV. The "encrypt the
 *     same plaintext twice → different ciphertext" assertion is what
 *     actually proves freshness on the production code path.
 *   - hashEmail uses the keyed HMAC (EMAIL_HASH_SECRET) rather than a
 *     public sha256.
 */

const crypto = require('node:crypto');

const FAKE_MASTER = crypto.randomBytes(32).toString('hex');
const FAKE_EMAIL  = crypto.randomBytes(32).toString('hex');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = FAKE_MASTER;
    process.env.EMAIL_HASH_SECRET     = FAKE_EMAIL;
});

const enc    = require('../utils/encryption');
const native = require('../utils/nativeCrypto');

describe('encryption.js AES wrapper — IV freshness audit', () => {
    test('encrypt() produces different ciphertext for the same plaintext + key', async () => {
        const dataKey = crypto.randomBytes(32);
        const a = await enc.encrypt('repeat-me', dataKey);
        const b = await enc.encrypt('repeat-me', dataKey);
        expect(typeof a).toBe('string');
        expect(typeof b).toBe('string');
        expect(a).not.toBe(b);
    });

    test('masterEncrypt() produces different ciphertext for the same plaintext', async () => {
        const a = await enc.masterEncrypt('payload');
        const b = await enc.masterEncrypt('payload');
        expect(a).not.toBe(b);
    });

    test('encrypt/decrypt round-trips the plaintext', async () => {
        const dataKey = crypto.randomBytes(32);
        const blob = await enc.encrypt('the quick brown fox', dataKey);
        expect(await enc.decrypt(blob, dataKey)).toBe('the quick brown fox');
    });

    test('encrypt has no IV parameter — IV is always sourced internally', () => {
        // Loud-failure audit: any future helper that adds an `iv` arg is a
        // regression. Document the contract here.
        expect(enc.encrypt.length).toBeLessThanOrEqual(2);          // (plaintext, dataKey)
        expect(enc.masterEncrypt.length).toBeLessThanOrEqual(1);    // (plaintext)
        expect(native.aesGcmEncrypt.length).toBe(2);                // (plaintext, key)
    });
});

describe('encryption.js hashEmail — keyed HMAC migration', () => {
    test('hashEmail returns a 64-char hex HMAC under EMAIL_HASH_SECRET', async () => {
        const h = await enc.hashEmail('user@example.com');
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    test('hashEmail is deterministic for the same email + secret', async () => {
        const a = await enc.hashEmail('user@example.com');
        const b = await enc.hashEmail('user@example.com');
        expect(a).toBe(b);
    });

    test('hashEmail normalizes case + whitespace', async () => {
        const a = await enc.hashEmail('User@Example.com');
        const b = await enc.hashEmail('  user@example.com  ');
        expect(a).toBe(b);
    });

    test('hashEmail differs from the unkeyed sha256 (proves migration)', async () => {
        const hashed = await enc.hashEmail('user@example.com');
        const plain  = native.sha256('user@example.com');
        expect(hashed).not.toBe(plain);
    });

    test('hashEmail throws if EMAIL_HASH_SECRET is missing', async () => {
        const saved = process.env.EMAIL_HASH_SECRET;
        delete process.env.EMAIL_HASH_SECRET;
        await expect(enc.hashEmail('user@example.com')).rejects.toThrow(/EMAIL_HASH_SECRET/);
        process.env.EMAIL_HASH_SECRET = saved;
    });

    test('hashEmail rejects non-string input', async () => {
        await expect(enc.hashEmail(null)).rejects.toThrow();
        await expect(enc.hashEmail(42)).rejects.toThrow();
    });
});
