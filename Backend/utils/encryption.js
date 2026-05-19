/**
 * encryption.js — high-level encryption / integrity helpers used by the
 * request-path code. Internals call `nativeCrypto` (Node).
 *
 * Public API:
 *   masterEncrypt / masterDecrypt   — wrap user dataKeys with MASTER_ENCRYPTION_KEY
 *   encrypt / decrypt / safeDecrypt — per-user AES-256-GCM
 *   hashEmail                       — keyed HMAC-SHA256 (Phase 2; was SHA-256)
 *   generateDataKey                 — 32 random bytes, hex string
 *
 * Wire format for encrypted blobs: base64(IV || tag || ciphertext)
 * with IV_LEN=12 and TAG_LEN=16. The IV is sourced exclusively from
 * crypto.randomBytes(12) inside nativeCrypto.aesGcmEncrypt — there is no
 * code path here or in nativeCrypto that accepts an externally-supplied IV.
 *
 * Phase 2 dropped the record-integrity HMAC layer (generateHMAC / verifyHMAC)
 * — the AES-GCM auth tag already covers integrity for encrypted fields, and
 * the ECDSA server-attestation covers integrity for plaintext fields.
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

// ── Email lookup hash (keyed HMAC) ───────────────────────────────────────────
// Phase 2 migrated from sha256(email) to hmac_sha256(email, EMAIL_HASH_SECRET).
// Rationale:
//   - SHA-256 is a public hash. An attacker who exfiltrates the User collection
//     can confirm whether arbitrary candidate emails are in the user base by
//     hashing them and looking up emailHash. The keyed HMAC makes that
//     impossible without also exfiltrating EMAIL_HASH_SECRET.
//   - Confidentiality of the email collection is the threat model; uniqueness
//     and equality lookup behavior are unchanged.
// Migration of pre-Phase-2 users is handled by
// Backend/scripts/migrate-email-hash.js (one-shot, idempotent).

function _emailHashKey() {
    const hex = process.env.EMAIL_HASH_SECRET;
    if (typeof hex !== 'string' || hex.length !== 64) {
        throw new Error('encryption: EMAIL_HASH_SECRET must be 64 hex chars');
    }
    return Buffer.from(hex, 'hex');
}

async function hashEmail(email) {
    if (typeof email !== 'string') {
        throw new TypeError('hashEmail: email must be a string');
    }
    const normalized = email.toLowerCase().trim();
    return native.hmacSha256(normalized, _emailHashKey());
}

function generateDataKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    masterEncrypt, masterDecrypt,
    encrypt, decrypt, safeDecrypt,
    hashEmail, generateDataKey,
};
