/**
 * keyManagement.js — per-user asymmetric key operations (RSA-OAEP for notes,
 * ECDSA-P256 for record signatures). Storage format is PEM as of SEC-1
 * Phase 1; the legacy hex-JSON format produced by the Python era is detected
 * but not consumed in the request path — it triggers a JIT key rotation in
 * the login flow.
 *
 * Public API (signatures unchanged from the Python era):
 *   generateRSAKeyPair() / generateECCKeyPair()
 *   rsaEncrypt / rsaDecrypt
 *   eccSign    / eccVerify
 *   generateUserKeyBundle(dataKey) -> { rsaPublicKey, encryptedRsaPrivateKey,
 *                                       eccPublicKey, encryptedEccPrivateKey }
 *   getUserPrivateKeys(user, dataKey) -> { rsaPrivateKey, eccPrivateKey } (PEM)
 *   rotateUserDataKey(user, oldMasterDecrypt, newMasterEncrypt)
 *
 * Extensions added in Phase 1:
 *   hasLegacyKeyBundle(user) -> boolean       — true if the user's stored keys
 *                                               are not in PEM format
 *   regenerateUserKeyBundle(user, dataKey)    — generate a fresh PEM bundle
 *                                               in-place on the user document
 *                                               (caller must save())
 *
 * Migration policy: at login (userController.loginUser, twoFactorController.
 * verify2FA), if hasLegacyKeyBundle returns true the controller calls
 * regenerateUserKeyBundle and saves the user. Old RSA-encrypted notes become
 * unreadable; old ECDSA signatures stop verifying (verifyRecord returns false
 * which only emits a console.warn — non-blocking). Documented tradeoff for
 * the migration off the academic Python crypto.
 */

const native = require('./nativeCrypto');
const { encrypt, decrypt } = require('./encryption');

// ── Format detection ─────────────────────────────────────────────────────────

const PEM_PUBLIC_PREFIX  = '-----BEGIN PUBLIC KEY-----';
const PEM_PRIVATE_PREFIX = '-----BEGIN PRIVATE KEY-----';

function _isPemPublic(s)  { return typeof s === 'string' && s.startsWith(PEM_PUBLIC_PREFIX); }
function _isPemPrivate(s) { return typeof s === 'string' && s.startsWith(PEM_PRIVATE_PREFIX); }

function _assertPemPublic(value, label) {
    if (!_isPemPublic(value)) {
        throw new Error(`${label}: expected PEM public key (got legacy or invalid format)`);
    }
}

function _assertPemPrivate(value, label) {
    if (!_isPemPrivate(value)) {
        throw new Error(`${label}: expected PEM private key (got legacy or invalid format)`);
    }
}

// ── RSA-2048 (notes) ─────────────────────────────────────────────────────────

async function generateRSAKeyPair() {
    return native.generateRsaKeypair();
}

async function rsaEncrypt(plaintext, publicKeyPem) {
    _assertPemPublic(publicKeyPem, 'rsaEncrypt.publicKey');
    return native.rsaOaepEncrypt(plaintext, publicKeyPem).toString('base64');
}

async function rsaDecrypt(ciphertextB64, privateKeyPem) {
    _assertPemPrivate(privateKeyPem, 'rsaDecrypt.privateKey');
    if (typeof ciphertextB64 !== 'string') {
        throw new TypeError('rsaDecrypt: ciphertext must be a base64 string');
    }
    const ct = Buffer.from(ciphertextB64, 'base64');
    return native.rsaOaepDecrypt(ct, privateKeyPem).toString('utf8');
}

// ── ECDSA P-256 (record signatures, DER) ─────────────────────────────────────

async function generateECCKeyPair() {
    return native.generateEcKeypair();
}

async function eccSign(message, privateKeyPem) {
    _assertPemPrivate(privateKeyPem, 'eccSign.privateKey');
    return native.ecdsaSign(message, privateKeyPem).toString('base64');
}

async function eccVerify(message, signatureB64, publicKeyPem) {
    // Returns false (rather than throwing) for two reasons:
    // (1) callers (signing.verifyRecord) treat the return value as truthy/falsy,
    // (2) legacy public keys / legacy signatures land here when migration
    //     hasn't run yet (e.g., already-issued JWT, never re-logged-in);
    //     the existing warn-and-continue contract upstream depends on a
    //     `false` here rather than an exception.
    if (!_isPemPublic(publicKeyPem) || typeof signatureB64 !== 'string') return false;
    try {
        const sig = Buffer.from(signatureB64, 'base64');
        return native.ecdsaVerify(message, sig, publicKeyPem);
    } catch {
        return false;
    }
}

// ── Key bundle (called at registration; uses encryption.encrypt) ─────────────

async function generateUserKeyBundle(dataKey) {
    const rsa = await generateRSAKeyPair();
    const ecc = await generateECCKeyPair();
    return {
        rsaPublicKey:           rsa.publicKey,
        encryptedRsaPrivateKey: await encrypt(rsa.privateKey, dataKey),
        eccPublicKey:           ecc.publicKey,
        encryptedEccPrivateKey: await encrypt(ecc.privateKey, dataKey),
    };
}

// Decrypt private keys from the per-user dataKey-encrypted blob. Returns PEM
// strings. Throws if the decrypted material is not PEM (i.e., the user still
// has a legacy hex-JSON bundle — caller must call regenerateUserKeyBundle
// first).
async function getUserPrivateKeys(user, dataKey) {
    const rsaPrivateKey = await decrypt(user.encryptedRsaPrivateKey, dataKey);
    const eccPrivateKey = await decrypt(user.encryptedEccPrivateKey, dataKey);
    _assertPemPrivate(rsaPrivateKey, 'getUserPrivateKeys.rsaPrivateKey');
    _assertPemPrivate(eccPrivateKey, 'getUserPrivateKeys.eccPrivateKey');
    return { rsaPrivateKey, eccPrivateKey };
}

// ── Legacy-bundle detection + JIT regeneration ───────────────────────────────

function hasLegacyKeyBundle(user) {
    return !_isPemPublic(user?.rsaPublicKey) || !_isPemPublic(user?.eccPublicKey);
}

// Mutates the user document in-place with a fresh PEM bundle. Caller is
// responsible for calling user.save(). The user's dataKey is unchanged.
async function regenerateUserKeyBundle(user, dataKey) {
    const bundle = await generateUserKeyBundle(dataKey);
    user.rsaPublicKey           = bundle.rsaPublicKey;
    user.encryptedRsaPrivateKey = bundle.encryptedRsaPrivateKey;
    user.eccPublicKey           = bundle.eccPublicKey;
    user.encryptedEccPrivateKey = bundle.encryptedEccPrivateKey;
    user.keyVersion             = (user.keyVersion || 1) + 1;
}

// ── Master-key rotation (scaffold — unused in production today) ──────────────

async function rotateUserDataKey(user, oldMasterDecrypt, newMasterEncrypt) {
    const rawKey = await oldMasterDecrypt(user.encryptedDataKey);
    return {
        encryptedDataKey: await newMasterEncrypt(rawKey),
        keyVersion:       (user.keyVersion || 1) + 1,
    };
}

module.exports = {
    generateRSAKeyPair, rsaEncrypt, rsaDecrypt,
    generateECCKeyPair, eccSign, eccVerify,
    generateUserKeyBundle, getUserPrivateKeys,
    hasLegacyKeyBundle, regenerateUserKeyBundle,
    rotateUserDataKey,
};
