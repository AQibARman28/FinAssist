const crypto = require('crypto');
const { aes256gcmEncrypt, aes256gcmDecrypt } = require('./scratch/aes256gcm');
const { hmacSha256Hex } = require('./scratch/hmacSha256');
const { sha256Hex } = require('./scratch/sha256');

const IV_LEN  = 12;   // GCM standard 12-byte IV (scratch aes256gcm requires this length)
const TAG_LEN = 16;

// ── Master-key operations (encrypts/decrypts user data keys) ──────────────────

function masterEncrypt(plaintext) {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    const iv  = crypto.randomBytes(IV_LEN);
    const { ciphertext, tag } = aes256gcmEncrypt(key, iv, String(plaintext));
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function masterDecrypt(ciphertext) {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    const buf = Buffer.from(ciphertext, 'base64');
    const iv  = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    return aes256gcmDecrypt(key, iv, enc, tag).toString('utf8');
}

// ── Per-user AES-256-GCM operations ──────────────────────────────────────────

function encrypt(plaintext, dataKey) {
    if (plaintext === null || plaintext === undefined) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    const iv  = crypto.randomBytes(IV_LEN);
    const { ciphertext, tag } = aes256gcmEncrypt(key, iv, String(plaintext));
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    const buf = Buffer.from(ciphertext, 'base64');
    const iv  = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    return aes256gcmDecrypt(key, iv, enc, tag).toString('utf8');
}

// Graceful decrypt — falls back to plaintext for legacy unencrypted data
function safeDecrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    try {
        return decrypt(ciphertext, dataKey);
    } catch {
        return ciphertext;
    }
}

// ── HMAC-SHA256 integrity ─────────────────────────────────────────────────────

function generateHMAC(payload, userId) {
    const key  = Buffer.from(process.env.HMAC_SECRET, 'hex');
    const data = JSON.stringify({ ...payload, _uid: userId.toString() });
    return hmacSha256Hex(key, data);
}

function verifyHMAC(payload, mac, userId) {
    try {
        const expected = generateHMAC(payload, userId);
        if (typeof mac !== 'string' || mac.length !== expected.length) return false;
        // Constant-time hex-string comparison: walk every char unconditionally
        // and OR-accumulate the differences.
        let diff = 0;
        for (let i = 0; i < expected.length; i++) {
            diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
        }
        return diff === 0;
    } catch {
        return false;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashEmail(email) {
    return sha256Hex(email.toLowerCase().trim());
}

function generateDataKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    masterEncrypt, masterDecrypt,
    encrypt, decrypt, safeDecrypt,
    generateHMAC, verifyHMAC,
    hashEmail, generateDataKey
};
