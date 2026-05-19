/**
 * encryption.js — high-level encryption / integrity helpers used by the
 * request-path code. Internals call `nativeCrypto` (Node) — the legacy
 * Python subprocess bridge is gone.
 *
 * Public API (unchanged signatures so callers don't move):
 *   masterEncrypt / masterDecrypt   — wrap user dataKeys with MASTER_ENCRYPTION_KEY
 *   encrypt / decrypt / safeDecrypt — per-user AES-256-GCM
 *   generateHMAC / verifyHMAC       — record integrity (HMAC-SHA256 over canonical JSON)
 *   hashEmail                       — SHA-256 lookup hash (Phase 2 migrates to keyed HMAC)
 *   generateDataKey                 — 32 random bytes, hex string
 *
 * Wire format for encrypted blobs is unchanged: base64(IV || tag || ciphertext)
 * with IV_LEN=12 and TAG_LEN=16. Existing DB records decrypt as before.
 */

const crypto = require('node:crypto');
const native = require('./nativeCrypto');

const IV_LEN  = 12;   // GCM standard 12-byte IV
const TAG_LEN = 16;

// ── AES helpers (wire format: base64(iv || tag || ciphertext)) ───────────────

function _aesEncryptStored(keyBuf, plaintextStr) {
    const { ciphertext, iv, tag } = native.aesGcmEncrypt(plaintextStr, keyBuf);
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function _aesDecryptStored(keyBuf, storedB64) {
    const buf = Buffer.from(storedB64, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) {
        throw new Error('encryption._aesDecryptStored: ciphertext blob too short');
    }
    const iv  = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct  = buf.subarray(IV_LEN + TAG_LEN);
    return native.aesGcmDecrypt(ct, keyBuf, iv, tag).toString('utf8');
}

// ── Master-key operations (encrypts/decrypts user dataKeys) ──────────────────

function _masterKey() {
    const hex = process.env.MASTER_ENCRYPTION_KEY;
    if (typeof hex !== 'string' || hex.length !== 64) {
        throw new Error('encryption: MASTER_ENCRYPTION_KEY must be 64 hex chars');
    }
    return Buffer.from(hex, 'hex');
}

async function masterEncrypt(plaintext) {
    return _aesEncryptStored(_masterKey(), String(plaintext));
}

async function masterDecrypt(ciphertext) {
    return _aesDecryptStored(_masterKey(), ciphertext);
}

// ── Per-user AES-256-GCM operations ──────────────────────────────────────────

async function encrypt(plaintext, dataKey) {
    if (plaintext === null || plaintext === undefined) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    return _aesEncryptStored(key, String(plaintext));
}

async function decrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    return _aesDecryptStored(key, ciphertext);
}

// Graceful decrypt — preserves the existing fallback contract for legacy data
// stored before encryption rolled out. Decrypt failure (malformed blob, tag
// mismatch) returns the input string unchanged. Not a silent swallow: the
// surface area is bounded to "user PII fields written before encryption was
// added", and the caller still has the original value rather than null.
async function safeDecrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    try {
        return await decrypt(ciphertext, dataKey);
    } catch {
        return ciphertext;
    }
}

// ── HMAC-SHA256 record integrity ─────────────────────────────────────────────
// Phase 2 drops these from records (GCM tag covers it). Kept for Phase 1 to
// preserve the on-disk record format until Phase 2 lands.

function _hmacSecret() {
    const hex = process.env.HMAC_SECRET;
    if (typeof hex !== 'string' || hex.length !== 64) {
        throw new Error('encryption: HMAC_SECRET must be 64 hex chars');
    }
    return Buffer.from(hex, 'hex');
}

async function generateHMAC(payload, userId) {
    const data = JSON.stringify({ ...payload, _uid: userId.toString() });
    return native.hmacSha256(data, _hmacSecret());
}

async function verifyHMAC(payload, mac, userId) {
    try {
        const expected = await generateHMAC(payload, userId);
        if (typeof mac !== 'string' || mac.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(mac, 'hex'));
    } catch {
        return false;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function hashEmail(email) {
    if (typeof email !== 'string') {
        throw new TypeError('hashEmail: email must be a string');
    }
    const normalized = email.toLowerCase().trim();
    return native.sha256(normalized);
}

function generateDataKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    masterEncrypt, masterDecrypt,
    encrypt, decrypt, safeDecrypt,
    generateHMAC, verifyHMAC,
    hashEmail, generateDataKey,
};
