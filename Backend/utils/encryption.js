const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

// ── Master-key operations (encrypts/decrypts user data keys) ──────────────────

function masterEncrypt(plaintext) {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

function masterDecrypt(ciphertext) {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'hex');
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
}

// ── Per-user AES-256-GCM operations ──────────────────────────────────────────

function encrypt(plaintext, dataKey) {
    if (plaintext === null || plaintext === undefined) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(ciphertext, dataKey) {
    if (!ciphertext) return null;
    const key = Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex');
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
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
    const key = Buffer.from(process.env.HMAC_SECRET, 'hex');
    const data = JSON.stringify({ ...payload, _uid: userId.toString() });
    return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function verifyHMAC(payload, mac, userId) {
    try {
        const expected = generateHMAC(payload, userId);
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(mac, 'hex'));
    } catch {
        return false;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashEmail(email) {
    return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
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
