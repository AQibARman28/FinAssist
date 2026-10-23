/**
 * encryption.js — high-level encryption helpers used by the request path.
 * Internals call `nativeCrypto` (Node).
 *
 * Public API:
 *   masterEncrypt / masterDecrypt    — wrap user data keys with the master key ring
 *   masterKeyId / needsRewrap        — which master key wrapped a blob
 *   encrypt / decrypt / decryptOrNull — per-user AES-256-GCM, bound to a context
 *   fieldContext(field, userId)      — the AAD for one field of one user's data
 *   hashEmail                        — keyed HMAC-SHA256 blind index
 *   generateDataKey                  — 32 random bytes, hex string
 *
 * Wire formats (IV always from crypto.randomBytes(12) inside nativeCrypto —
 * no code path accepts a caller-supplied IV):
 *
 *   v2:<base64(iv || tag || ct)>          field ciphertext with AAD = context.
 *                                         The AAD binds it to one owner and one
 *                                         field, so a blob copied onto another
 *                                         user or field fails to decrypt.
 *   <base64(iv || tag || ct)>             v1 field ciphertext (no AAD), written
 *                                         before 2026-10. Still decrypts; the
 *                                         next write or scripts/reencrypt-fields.js
 *                                         upgrades it.
 *   mk2:<kid>:<base64(iv || tag || ct)>   data key wrapped by the master key
 *                                         whose id is <kid> (first 8 hex of
 *                                         sha256(key)), so the master key can
 *                                         be rotated (MASTER_ENCRYPTION_KEY_PREVIOUS
 *                                         + scripts/rotate-master-key.js).
 *   <base64(...)>                         legacy wrapped key, tried against the
 *                                         current then the previous master key.
 *
 * Integrity: decryption failure is never papered over. decrypt() throws;
 * decryptOrNull() returns null and logs. The old safeDecrypt() returned the
 * stored value unchanged on failure, which let anyone with database write
 * access plant plaintext that displayed as real data — it is now an alias of
 * decryptOrNull.
 */

const crypto = require('node:crypto');
const native = require('./nativeCrypto');

const IV_LEN  = 12;   // GCM standard 12-byte IV
const TAG_LEN = 16;
const HEX64   = /^[0-9a-fA-F]{64}$/;

// ── AES helpers ───────────────────────────────────────────────────────────────

function _seal(keyBuf, plaintextStr, aad) {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(String(plaintextStr), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function _open(keyBuf, b64, aad) {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) throw new Error('encryption: ciphertext blob too short');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, buf.subarray(0, IV_LEN));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
}

// v1 blobs (and legacy wrapped keys) go through nativeCrypto exactly as before.
function _openV1(keyBuf, b64) {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) throw new Error('encryption: ciphertext blob too short');
    return native.aesGcmDecrypt(buf.subarray(IV_LEN + TAG_LEN), keyBuf, buf.subarray(0, IV_LEN), buf.subarray(IV_LEN, IV_LEN + TAG_LEN)).toString('utf8');
}

function _sealV1(keyBuf, plaintextStr) {
    const { ciphertext, iv, tag } = native.aesGcmEncrypt(plaintextStr, keyBuf);
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

// ── Master key ring (wraps user data keys) ───────────────────────────────────

function _hexKey(name) {
    const hex = process.env[name];
    if (typeof hex !== 'string' || !HEX64.test(hex)) {
        throw new Error(`encryption: ${name} must be 64 hex chars`);
    }
    return Buffer.from(hex, 'hex');
}

const _kid = (keyBuf) => crypto.createHash('sha256').update(keyBuf).digest('hex').slice(0, 8);

function _masterRing() {
    const current = _hexKey('MASTER_ENCRYPTION_KEY');
    const ring = [current];
    if (process.env.MASTER_ENCRYPTION_KEY_PREVIOUS) ring.push(_hexKey('MASTER_ENCRYPTION_KEY_PREVIOUS'));
    return ring;
}

function masterKeyId() {
    return _kid(_hexKey('MASTER_ENCRYPTION_KEY'));
}

async function masterEncrypt(plaintext) {
    const key = _hexKey('MASTER_ENCRYPTION_KEY');
    return `mk2:${_kid(key)}:${_seal(key, String(plaintext), `finassist/mk2/${_kid(key)}`)}`;
}

async function masterDecrypt(stored) {
    if (typeof stored !== 'string') throw new TypeError('masterDecrypt: expected a string');
    const ring = _masterRing();
    if (stored.startsWith('mk2:')) {
        const [, kid, b64] = stored.split(':');
        const key = ring.find((k) => _kid(k) === kid);
        if (!key) throw new Error(`masterDecrypt: no master key with id ${kid} is configured`);
        return _open(key, b64, `finassist/mk2/${kid}`);
    }
    let lastErr;
    for (const key of ring) {
        try { return _openV1(key, stored); } catch (err) { lastErr = err; }
    }
    throw lastErr;
}

// True when a wrapped data key was not produced by the current master key.
function needsRewrap(stored) {
    return typeof stored === 'string' && !stored.startsWith(`mk2:${masterKeyId()}:`);
}

// ── Per-user AES-256-GCM field encryption ───────────────────────────────────

// The AAD for one field of one user's data, e.g.
// fieldContext('expense.description', user._id).
function fieldContext(field, userId) {
    if (!field || !userId) throw new TypeError('fieldContext: field and userId are required');
    return `finassist/v2/${field}/${String(userId)}`;
}

const _keyBuf = (dataKey) => (Buffer.isBuffer(dataKey) ? dataKey : Buffer.from(dataKey, 'hex'));

// With a context the result is a bound v2 blob. Without one it is a v1 blob,
// kept only while callers are moved onto contexts.
async function encrypt(plaintext, dataKey, context = null) {
    if (plaintext === null || plaintext === undefined) return null;
    const key = _keyBuf(dataKey);
    if (context) return `v2:${_seal(key, String(plaintext), context)}`;
    return _sealV1(key, String(plaintext));
}

async function decrypt(ciphertext, dataKey, context = null) {
    if (!ciphertext) return null;
    if (typeof ciphertext !== 'string') throw new TypeError('decrypt: ciphertext must be a string');
    const key = _keyBuf(dataKey);
    if (ciphertext.startsWith('v2:')) {
        if (!context) throw new Error('decrypt: a v2 ciphertext needs its context');
        return _open(key, ciphertext.slice(3), context);
    }
    return _openV1(key, ciphertext);
}

// For display paths: a ciphertext that fails authentication (tampered,
// planted plaintext, wrong owner or field) reads as null, never as itself.
async function decryptOrNull(ciphertext, dataKey, context = null) {
    if (!ciphertext) return null;
    try {
        return await decrypt(ciphertext, dataKey, context);
    } catch {
        console.warn(`encryption: a stored value failed authentication${context ? ` (${context.split('/')[2]})` : ''}; shown as empty`);
        return null;
    }
}

const isBound = (ciphertext) => typeof ciphertext === 'string' && ciphertext.startsWith('v2:');

// Every encrypted field in the app, named once. Contexts are owner + field
// (not record): recurring income copies its template's ciphertext onto each
// generated instance, and record-level integrity of plaintext fields is the
// job of the ECDSA attestations.
const FIELDS = Object.freeze({
    userName:           'user.name',
    userEmail:          'user.email',
    userPendingEmail:   'user.pendingEmail',
    userTotpSecret:     'user.twoFactorSecret',
    userRsaPrivateKey:  'user.rsaPrivateKey',
    userEccPrivateKey:  'user.eccPrivateKey',
    expenseDescription: 'expense.description',
    expenseNote:        'expense.note',
    incomeDescription:  'income.description',
    incomeNote:         'income.note',
    goalTitle:          'goal.title',
    goalDescription:    'goal.description',
    goalNote:           'goal.note',
});

const sealField = (plaintext, dataKey, field, userId) => encrypt(plaintext, dataKey, fieldContext(field, userId));
const openField = (stored, dataKey, field, userId) => decryptOrNull(stored, dataKey, fieldContext(field, userId));

// ── Email lookup hash (keyed HMAC) ───────────────────────────────────────────
// hmac_sha256(normalized email, EMAIL_HASH_SECRET): an attacker holding only
// the User collection can't test candidate emails against it.

async function hashEmail(email) {
    if (typeof email !== 'string') {
        throw new TypeError('hashEmail: email must be a string');
    }
    const normalized = email.toLowerCase().trim();
    return native.hmacSha256(normalized, _hexKey('EMAIL_HASH_SECRET'));
}

function generateDataKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    masterEncrypt, masterDecrypt, masterKeyId, needsRewrap,
    encrypt, decrypt, decryptOrNull, fieldContext, isBound,
    FIELDS, sealField, openField,
    // Deprecated name kept for callers being migrated; same strict behaviour.
    safeDecrypt: decryptOrNull,
    hashEmail, generateDataKey,
};
