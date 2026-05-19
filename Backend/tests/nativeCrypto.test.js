const crypto = require('node:crypto');
const native = require('../utils/nativeCrypto');

describe('nativeCrypto: AES-256-GCM', () => {
    const key = crypto.randomBytes(32);

    test('round-trip preserves plaintext', () => {
        const { ciphertext, iv, tag } = native.aesGcmEncrypt('hello world', key);
        const pt = native.aesGcmDecrypt(ciphertext, key, iv, tag).toString('utf8');
        expect(pt).toBe('hello world');
    });

    test('throws on bad key length', () => {
        expect(() => native.aesGcmEncrypt('x', crypto.randomBytes(16)))
            .toThrow(/key must be 32 bytes/);
    });

    test('tag tamper is detected (loud failure)', () => {
        const { ciphertext, iv, tag } = native.aesGcmEncrypt('secret', key);
        const tampered = Buffer.from(tag);
        tampered[0] ^= 0x01;
        expect(() => native.aesGcmDecrypt(ciphertext, key, iv, tampered)).toThrow();
    });

    test('ciphertext tamper is detected', () => {
        const { ciphertext, iv, tag } = native.aesGcmEncrypt('secret', key);
        const tamperedCt = Buffer.from(ciphertext);
        tamperedCt[0] ^= 0x01;
        expect(() => native.aesGcmDecrypt(tamperedCt, key, iv, tag)).toThrow();
    });

    test('IV is fresh per call (same plaintext → different ciphertext)', () => {
        const a = native.aesGcmEncrypt('repeat', key);
        const b = native.aesGcmEncrypt('repeat', key);
        expect(a.iv.equals(b.iv)).toBe(false);
        expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    });
});

describe('nativeCrypto: RSA-OAEP', () => {
    let keypair;
    beforeAll(() => { keypair = native.generateRsaKeypair(); });

    test('generated keys are PEM', () => {
        expect(keypair.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
        expect(keypair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    });

    test('round-trip preserves plaintext', () => {
        const ct = native.rsaOaepEncrypt('private note', keypair.publicKey);
        const pt = native.rsaOaepDecrypt(ct, keypair.privateKey).toString('utf8');
        expect(pt).toBe('private note');
    });

    test('decrypt with wrong key fails', () => {
        const other = native.generateRsaKeypair();
        const ct = native.rsaOaepEncrypt('x', keypair.publicKey);
        expect(() => native.rsaOaepDecrypt(ct, other.privateKey)).toThrow();
    });

    test('throws on non-PEM key input', () => {
        expect(() => native.rsaOaepEncrypt('x', 42)).toThrow(/PEM/);
    });
});

describe('nativeCrypto: ECDSA P-256', () => {
    let keypair;
    beforeAll(() => { keypair = native.generateEcKeypair(); });

    test('generated keys are PEM', () => {
        expect(keypair.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
        expect(keypair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    });

    test('sign + verify accepts a fresh signature', () => {
        const sig = native.ecdsaSign('record', keypair.privateKey);
        expect(native.ecdsaVerify('record', sig, keypair.publicKey)).toBe(true);
    });

    test('verify rejects a tampered message', () => {
        const sig = native.ecdsaSign('record', keypair.privateKey);
        expect(native.ecdsaVerify('different record', sig, keypair.publicKey)).toBe(false);
    });

    test('verify rejects a tampered signature', () => {
        const sig = native.ecdsaSign('record', keypair.privateKey);
        const tampered = Buffer.from(sig);
        tampered[tampered.length - 1] ^= 0x01;
        // tampered DER may be malformed; verify should return false rather than throw
        expect(native.ecdsaVerify('record', tampered, keypair.publicKey)).toBe(false);
    });

    test('verify rejects under a different public key', () => {
        const other = native.generateEcKeypair();
        const sig = native.ecdsaSign('record', keypair.privateKey);
        expect(native.ecdsaVerify('record', sig, other.publicKey)).toBe(false);
    });
});

describe('nativeCrypto: HMAC + SHA-256', () => {
    test('hmacSha256 is deterministic for same (message, key)', () => {
        const key = Buffer.from('shared-secret');
        const a = native.hmacSha256('hello', key);
        const b = native.hmacSha256('hello', key);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    test('hmacSha256 differs when message changes', () => {
        const key = Buffer.from('shared-secret');
        expect(native.hmacSha256('a', key)).not.toBe(native.hmacSha256('b', key));
    });

    test('hmacSha256 differs when key changes', () => {
        expect(native.hmacSha256('m', 'k1')).not.toBe(native.hmacSha256('m', 'k2'));
    });

    test('sha256 of "abc" matches FIPS-180-4 known vector', () => {
        expect(native.sha256('abc'))
            .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});

describe('nativeCrypto: argon2id password hashing', () => {
    test('hash + verify succeeds for correct password', async () => {
        const hash = await native.hashPassword('correct-horse-battery-staple');
        expect(hash).toMatch(/^\$argon2id\$/);
        expect(await native.verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
    });

    test('verify fails for wrong password', async () => {
        const hash = await native.hashPassword('correct-horse-battery-staple');
        expect(await native.verifyPassword('wrong-password', hash)).toBe(false);
    });

    test('hash uses argon2id (id, not d or i)', async () => {
        const hash = await native.hashPassword('any');
        expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    test('hash includes the configured memory cost', async () => {
        const hash = await native.hashPassword('any');
        expect(hash).toContain(`m=${native._params.ARGON2_PARAMS.memoryCost}`);
    });
});

describe('nativeCrypto: JWT HS256', () => {
    const secret = 'a'.repeat(64);

    test('sign + verify round-trip', () => {
        const token = native.signJwt({ id: 'u1', role: 'user' }, secret, '1h');
        const decoded = native.verifyJwt(token, secret);
        expect(decoded.id).toBe('u1');
        expect(decoded.role).toBe('user');
        expect(decoded.iat).toBeDefined();
        expect(decoded.exp).toBeDefined();
    });

    test('verify fails on wrong secret', () => {
        const token = native.signJwt({ id: 'u1' }, secret, '1h');
        expect(() => native.verifyJwt(token, 'different-secret')).toThrow();
    });

    test('verify rejects an unsigned-alg token (algorithms pin to HS256)', () => {
        // Hand-craft an 'alg: none' token. jsonwebtoken must reject it because
        // we lock algorithms to HS256.
        const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ id: 'attacker' })).toString('base64url');
        const noneToken = `${header}.${payload}.`;
        expect(() => native.verifyJwt(noneToken, secret)).toThrow();
    });
});

describe('nativeCrypto: TOTP', () => {
    test('generateTotpSecret returns a base32 string', () => {
        const s = native.generateTotpSecret();
        expect(typeof s).toBe('string');
        expect(s.length).toBeGreaterThanOrEqual(16);
        expect(/^[A-Z2-7]+=*$/.test(s)).toBe(true);
    });

    test('a wrong code is rejected', () => {
        const s = native.generateTotpSecret();
        expect(native.verifyTotp(s, '000000')).toBe(false);
    });

    test('otpauth URI advertises sha256 to match legacy enrollments', () => {
        const uri = native.totpOtpauthUri('user@example.com', 'FinAssist', native.generateTotpSecret());
        expect(uri).toMatch(/^otpauth:\/\/totp\//);
        expect(uri).toContain('algorithm=SHA256');
    });
});
