/**
 * nativeCrypto.js — native-Node crypto engine that replaces the Python
 * subprocess bridge (pyCrypto.js → crypto_cli.py).
 *
 * Public API surface (signatures fixed by SEC-1 Phase 1 brief):
 *
 *   AES-256-GCM:
 *     aesGcmEncrypt(plaintext, key) -> { ciphertext, iv, tag }   // Buffers
 *     aesGcmDecrypt(ciphertext, key, iv, tag) -> Buffer
 *
 *   RSA-OAEP (SHA-256):
 *     rsaOaepEncrypt(plaintext, publicKeyPem) -> Buffer
 *     rsaOaepDecrypt(ciphertext, privateKeyPem) -> Buffer
 *
 *   ECDSA P-256 / SHA-256 (DER signatures):
 *     ecdsaSign(message, privateKeyPem) -> Buffer
 *     ecdsaVerify(message, signature, publicKeyPem) -> boolean
 *
 *   HMAC / hash:
 *     hmacSha256(message, key) -> string (lowercase hex)
 *     sha256(message) -> string (lowercase hex)
 *
 *   Keypair generation (returns PEM):
 *     generateRsaKeypair() -> { publicKey, privateKey }   // SPKI / PKCS#8
 *     generateEcKeypair()  -> { publicKey, privateKey }   // P-256 SPKI / PKCS#8
 *
 *   Password hashing (argon2id, OWASP 2023):
 *     hashPassword(plaintext) -> string (encoded argon2 hash)
 *     verifyPassword(plaintext, hash) -> boolean
 *
 *   TOTP (otplib):
 *     generateTotpSecret() -> string (base32)
 *     verifyTotp(secret, code) -> boolean
 *
 *   JWT (jsonwebtoken HS256):
 *     signJwt(payload, secret, expiresIn) -> string
 *     verifyJwt(token, secret) -> object (payload)
 *
 * Design rules (SEC-1):
 *   - No silent fallbacks. Bad input throws.
 *   - IVs are fresh per call from crypto.randomBytes(12). Callers cannot
 *     supply an IV to aesGcmEncrypt.
 *   - All Buffer inputs are accepted; string plaintexts are encoded UTF-8.
 *   - PEM is the only accepted asymmetric key format here. Legacy
 *     hex-JSON keypairs from the Python era are handled in keyManagement.js
 *     (the wrapper), not here.
 */

const crypto = require('node:crypto');
const argon2 = require('argon2');
const speakeasy = require('speakeasy');
const jwt = require('jsonwebtoken');

const AES_KEY_LEN = 32;     // AES-256
const AES_IV_LEN  = 12;     // GCM standard
const AES_TAG_LEN = 16;     // GCM tag

// ── Argon2id parameters (OWASP 2023 recommendation for memory-constrained envs)
const ARGON2_PARAMS = Object.freeze({
    type:        argon2.argon2id,
    memoryCost:  19456,   // ~19 MiB
    timeCost:    2,
    parallelism: 1,
});

// TOTP config: SHA-256 + 30s step + ±1 window. SHA-256 matches the legacy
// Python TOTP — existing 2FA-enrolled users' authenticator apps were
// provisioned with `algorithm=SHA256`; switching to SHA-1 here would
// silently invalidate every enrolled secret. window:1 accepts ±30s clock
// skew.
const TOTP_OPTS = Object.freeze({
    encoding:  'base32',
    algorithm: 'sha256',
    step:      30,
    window:    1,
    digits:    6,
});

// ── AES-256-GCM ───────────────────────────────────────────────────────────────

function _coerceBuffer(value, label, encoding = 'utf8') {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value, encoding);
    throw new TypeError(`${label}: expected Buffer or string`);
}

function _assertKey(key) {
    if (!Buffer.isBuffer(key)) {
        throw new TypeError('aesGcm: key must be a Buffer');
    }
    if (key.length !== AES_KEY_LEN) {
        throw new RangeError(`aesGcm: key must be ${AES_KEY_LEN} bytes (got ${key.length})`);
    }
}

function aesGcmEncrypt(plaintext, key) {
    _assertKey(key);
    const pt = _coerceBuffer(plaintext, 'aesGcmEncrypt.plaintext');
    const iv = crypto.randomBytes(AES_IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext, iv, tag };
}

function aesGcmDecrypt(ciphertext, key, iv, tag) {
    _assertKey(key);
    if (!Buffer.isBuffer(ciphertext)) throw new TypeError('aesGcmDecrypt: ciphertext must be a Buffer');
    if (!Buffer.isBuffer(iv) || iv.length !== AES_IV_LEN) {
        throw new TypeError(`aesGcmDecrypt: iv must be a ${AES_IV_LEN}-byte Buffer`);
    }
    if (!Buffer.isBuffer(tag) || tag.length !== AES_TAG_LEN) {
        throw new TypeError(`aesGcmDecrypt: tag must be a ${AES_TAG_LEN}-byte Buffer`);
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    // throws if the tag doesn't validate
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── RSA-OAEP (SHA-256) ────────────────────────────────────────────────────────

function rsaOaepEncrypt(plaintext, publicKeyPem) {
    if (typeof publicKeyPem !== 'string') {
        throw new TypeError('rsaOaepEncrypt: publicKeyPem must be a string (PEM)');
    }
    const pt = _coerceBuffer(plaintext, 'rsaOaepEncrypt.plaintext');
    return crypto.publicEncrypt(
        { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        pt
    );
}

function rsaOaepDecrypt(ciphertext, privateKeyPem) {
    if (typeof privateKeyPem !== 'string') {
        throw new TypeError('rsaOaepDecrypt: privateKeyPem must be a string (PEM)');
    }
    if (!Buffer.isBuffer(ciphertext)) {
        throw new TypeError('rsaOaepDecrypt: ciphertext must be a Buffer');
    }
    return crypto.privateDecrypt(
        { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        ciphertext
    );
}

// ── ECDSA P-256 (SHA-256) ─────────────────────────────────────────────────────

function ecdsaSign(message, privateKeyPem) {
    if (typeof privateKeyPem !== 'string') {
        throw new TypeError('ecdsaSign: privateKeyPem must be a string (PEM)');
    }
    const msg = _coerceBuffer(message, 'ecdsaSign.message');
    const signer = crypto.createSign('SHA256');
    signer.update(msg);
    signer.end();
    return signer.sign({ key: privateKeyPem, dsaEncoding: 'der' });
}

function ecdsaVerify(message, signature, publicKeyPem) {
    if (typeof publicKeyPem !== 'string') {
        throw new TypeError('ecdsaVerify: publicKeyPem must be a string (PEM)');
    }
    if (!Buffer.isBuffer(signature)) {
        throw new TypeError('ecdsaVerify: signature must be a Buffer');
    }
    const msg = _coerceBuffer(message, 'ecdsaVerify.message');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(msg);
    verifier.end();
    return verifier.verify({ key: publicKeyPem, dsaEncoding: 'der' }, signature);
}

// ── HMAC / SHA-256 ────────────────────────────────────────────────────────────

function hmacSha256(message, key) {
    const msgBuf = _coerceBuffer(message, 'hmacSha256.message');
    const keyBuf = _coerceBuffer(key,     'hmacSha256.key');
    return crypto.createHmac('sha256', keyBuf).update(msgBuf).digest('hex');
}

function sha256(message) {
    const msgBuf = _coerceBuffer(message, 'sha256.message');
    return crypto.createHash('sha256').update(msgBuf).digest('hex');
}

// ── Keypair generation (PEM) ──────────────────────────────────────────────────

function generateRsaKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
}

function generateEcKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // P-256
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
}

// ── Argon2id password hashing ─────────────────────────────────────────────────

async function hashPassword(plaintext) {
    if (typeof plaintext !== 'string') {
        throw new TypeError('hashPassword: plaintext must be a string');
    }
    return argon2.hash(plaintext, ARGON2_PARAMS);
}

async function verifyPassword(plaintext, hash) {
    if (typeof plaintext !== 'string') {
        throw new TypeError('verifyPassword: plaintext must be a string');
    }
    if (typeof hash !== 'string') {
        throw new TypeError('verifyPassword: hash must be a string');
    }
    // argon2.verify returns false on any decode/verify failure; it only
    // throws on impossible input. Per the SEC-1 "loud failure" rule we still
    // surface a thrown decode error to the caller — User.comparePassword in
    // model layer maps the legacy PBKDF2 case explicitly, so argon2 here only
    // ever sees argon2-formatted hashes.
    return argon2.verify(hash, plaintext);
}

// ── TOTP (speakeasy, SHA-256) ────────────────────────────────────────────────

function generateTotpSecret() {
    // length:20 = 160 random bits → 32-char base32 string, RFC-recommended.
    return speakeasy.generateSecret({ length: 20 }).base32;
}

function verifyTotp(secret, code) {
    if (typeof secret !== 'string') {
        throw new TypeError('verifyTotp: secret must be a base32 string');
    }
    if (typeof code !== 'string') {
        throw new TypeError('verifyTotp: code must be a string');
    }
    return speakeasy.totp.verify({ ...TOTP_OPTS, secret, token: code });
}

function totpOtpauthUri(label, issuer, secret) {
    if (typeof label !== 'string' || typeof issuer !== 'string' || typeof secret !== 'string') {
        throw new TypeError('totpOtpauthUri: label, issuer, secret must be strings');
    }
    return speakeasy.otpauthURL({
        secret,
        encoding:  'base32',
        label,
        issuer,
        algorithm: 'sha256',
        digits:    6,
        period:    30,
    });
}

// ── JWT (jsonwebtoken HS256) ──────────────────────────────────────────────────

function signJwt(payload, secret, expiresIn) {
    if (typeof payload !== 'object' || payload === null) {
        throw new TypeError('signJwt: payload must be an object');
    }
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new TypeError('signJwt: secret must be a non-empty string');
    }
    const options = { algorithm: 'HS256' };
    if (expiresIn !== undefined && expiresIn !== null) options.expiresIn = expiresIn;
    return jwt.sign(payload, secret, options);
}

function verifyJwt(token, secret) {
    if (typeof token !== 'string') {
        throw new TypeError('verifyJwt: token must be a string');
    }
    if (typeof secret !== 'string') {
        throw new TypeError('verifyJwt: secret must be a string');
    }
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

module.exports = {
    aesGcmEncrypt,
    aesGcmDecrypt,
    rsaOaepEncrypt,
    rsaOaepDecrypt,
    ecdsaSign,
    ecdsaVerify,
    hmacSha256,
    sha256,
    generateRsaKeypair,
    generateEcKeypair,
    hashPassword,
    verifyPassword,
    generateTotpSecret,
    verifyTotp,
    totpOtpauthUri,
    signJwt,
    verifyJwt,
    // exposed for tests
    _params: { AES_KEY_LEN, AES_IV_LEN, AES_TAG_LEN, ARGON2_PARAMS },
};
