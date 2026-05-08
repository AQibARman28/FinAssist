const { rsaEncrypt, rsaDecrypt, eccSign, eccVerify, getUserPrivateKeys } = require('./keyManagement');

// Sort top-level keys so signRecord and verifyRecord agree regardless of payload construction order
function canonicalJSON(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return JSON.stringify(payload);
    }
    const keys = Object.keys(payload).sort();
    const sorted = {};
    for (const k of keys) sorted[k] = payload[k];
    return JSON.stringify(sorted);
}

function signRecord(payload, user, dataKey) {
    if (!user?.encryptedEccPrivateKey || !dataKey) return null;
    const { eccPrivateKey } = getUserPrivateKeys(user, dataKey);
    return eccSign(canonicalJSON(payload), eccPrivateKey);
}

function verifyRecord(payload, signature, user) {
    if (!signature || !user?.eccPublicKey) return false;
    return eccVerify(canonicalJSON(payload), signature, user.eccPublicKey);
}

function encryptNote(plaintext, user) {
    if (!plaintext || !user?.rsaPublicKey) return null;
    return rsaEncrypt(plaintext, user.rsaPublicKey);
}

function decryptNote(ciphertext, user, dataKey) {
    if (!ciphertext || !user?.encryptedRsaPrivateKey || !dataKey) return null;
    const { rsaPrivateKey } = getUserPrivateKeys(user, dataKey);
    return rsaDecrypt(ciphertext, rsaPrivateKey);
}

module.exports = { signRecord, verifyRecord, encryptNote, decryptNote };
