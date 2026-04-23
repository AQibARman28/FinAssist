const crypto = require('crypto');
const { encrypt, decrypt } = require('./encryption');

// ── RSA-2048 (key wrapping, payload encryption) ───────────────────────────────

function generateRSAKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
}

function rsaEncrypt(plaintext, publicKeyPem) {
    return crypto.publicEncrypt(
        { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(plaintext)
    ).toString('base64');
}

function rsaDecrypt(ciphertext, privateKeyPem) {
    return crypto.privateDecrypt(
        { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(ciphertext, 'base64')
    ).toString('utf8');
}

// ── ECC P-256 (digital signatures for data integrity) ────────────────────────

function generateECCKeyPair() {
    return crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
}

function eccSign(data, privateKeyPem) {
    const sign = crypto.createSign('SHA256');
    sign.update(typeof data === 'string' ? data : JSON.stringify(data));
    return sign.sign(privateKeyPem, 'base64');
}

function eccVerify(data, signature, publicKeyPem) {
    try {
        const verify = crypto.createVerify('SHA256');
        verify.update(typeof data === 'string' ? data : JSON.stringify(data));
        return verify.verify(publicKeyPem, signature, 'base64');
    } catch {
        return false;
    }
}

// ── Key bundle generation (called at registration) ────────────────────────────

function generateUserKeyBundle(dataKey) {
    const rsa = generateRSAKeyPair();
    const ecc = generateECCKeyPair();
    return {
        rsaPublicKey: rsa.publicKey,
        encryptedRsaPrivateKey: encrypt(rsa.privateKey, dataKey),
        eccPublicKey: ecc.publicKey,
        encryptedEccPrivateKey: encrypt(ecc.privateKey, dataKey)
    };
}

// Decrypt private keys from stored ciphertext
function getUserPrivateKeys(user, dataKey) {
    return {
        rsaPrivateKey: decrypt(user.encryptedRsaPrivateKey, dataKey),
        eccPrivateKey: decrypt(user.encryptedEccPrivateKey, dataKey)
    };
}

// ── Key rotation ──────────────────────────────────────────────────────────────
// Re-encrypts the user's dataKey with the new master key
// (Call after rotating MASTER_ENCRYPTION_KEY)
function rotateUserDataKey(user, oldMasterDecrypt, newMasterEncrypt) {
    const rawKey = oldMasterDecrypt(user.encryptedDataKey);
    return {
        encryptedDataKey: newMasterEncrypt(rawKey),
        keyVersion: (user.keyVersion || 1) + 1
    };
}

module.exports = {
    generateRSAKeyPair, rsaEncrypt, rsaDecrypt,
    generateECCKeyPair, eccSign, eccVerify,
    generateUserKeyBundle, getUserPrivateKeys,
    rotateUserDataKey
};
