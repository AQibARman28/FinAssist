const crypto = require('crypto');
const { callPython } = require('./pyCrypto');

const IV_LEN  = 12;   // GCM standard 12-byte IV (scratch aes256gcm requires this length)
const TAG_LEN = 16;

// ── Helpers ───────────────────────────────────────────────────────────────────
// Each helper is a thin Node-side adapter: encode buffers to base64, hand off
// to the Python dispatcher, decode the response. Entropy (random IVs, data
// keys) stays in Node — only the math goes through Python.

function _b64(buf) { return buf.toString('base64'); }
function _bytes(b64) { return Buffer.from(b64, 'base64'); }

async function _aesEncryptBuf(keyBuf, plaintextStr) {
    const iv = crypto.randomBytes(IV_LEN);
    const result = await callPython('aes_encrypt', {
        key_b64: _b64(keyBuf),
        iv_b64:  _b64(iv),
        plaintext_b64: _b64(Buffer.from(plaintextStr, 'utf8')),
    });
    const tag = _bytes(result.tag_b64);
    const ct  = _bytes(result.ciphertext_b64);
    return Buffer.concat([iv, tag, ct]).toString('base64');
}

async function _aesDecryptBuf(keyBuf, storedB64) {
    const buf = Buffer.from(storedB64, 'base64');
    const iv  = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const result = await callPython('aes_decrypt', {
        key_b64: _b64(keyBuf),
        iv_b64:  _b64(iv),
        ciphertext_b64: _b64(enc),
        tag_b64: _b64(tag),
    });
    return _bytes(result.plaintext_b64).toString('utf8');
}

// ── Master-key operations (encrypts/decrypts user data keys) ──────────────────

async function masterEncrypt(plaintext) {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    return _aesEncryptBuf(key, String(plaintext));
}

async function masterDecrypt(ciphertext) {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    return _aesDecryptBuf(key, ciphertext);
}

// ── Per-user AES-256-GCM operations ──────────────────────────────────────────

async function encrypt(plaintext, dataKey) {
    if (plaintext === null || plaintext === undefined) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    return _aesEncryptBuf(key, String(plaintext));
}

async function decrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    return _aesDecryptBuf(key, ciphertext);
}

// Graceful decrypt — falls back to plaintext for legacy unencrypted data.
// Preserves the pre-swap behavior: on ANY decrypt failure (Python error,
// tag mismatch, malformed wire format) return the input ciphertext string
// unchanged rather than throwing.
async function safeDecrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    try {
        return await decrypt(ciphertext, dataKey);
    } catch {
        return ciphertext;
    }
}

// ── HMAC-SHA256 integrity ─────────────────────────────────────────────────────

async function generateHMAC(payload, userId) {
    const key  = Buffer.from(process.env.HMAC_SECRET, 'hex');
    const data = JSON.stringify({ ...payload, _uid: userId.toString() });
    const result = await callPython('hmac_sha256_hex', {
        key_b64: _b64(key),
        message_b64: _b64(Buffer.from(data, 'utf8')),
    });
    return result.hex;
}

async function verifyHMAC(payload, mac, userId) {
    try {
        const expected = await generateHMAC(payload, userId);
        if (typeof mac !== 'string' || mac.length !== expected.length) return false;
        // Constant-time hex-string comparison stays in Node — no point
        // round-tripping a fixed-length compare to Python.
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

async function hashEmail(email) {
    const normalized = email.toLowerCase().trim();
    const result = await callPython('sha256_hex', {
        message_b64: _b64(Buffer.from(normalized, 'utf8')),
    });
    return result.hex;
}

// Pure entropy — stays sync. Per the integration plan, randomness stays in
// Node (crypto.randomBytes is OS-CSPRNG-backed and explicitly permitted).
function generateDataKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    masterEncrypt, masterDecrypt,
    encrypt, decrypt, safeDecrypt,
    generateHMAC, verifyHMAC,
    hashEmail, generateDataKey
};
