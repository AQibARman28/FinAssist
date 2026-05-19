const { rsaEncrypt, rsaDecrypt, eccSign, eccVerify, getUserPrivateKeys } = require('./keyManagement');

// Sort top-level keys so signRecord and verifyRecord agree regardless of
// payload construction order.
function canonicalJSON(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return JSON.stringify(payload);
    }
    const keys = Object.keys(payload).sort();
    const sorted = {};
    for (const k of keys) sorted[k] = payload[k];
    return JSON.stringify(sorted);
}

async function signRecord(payload, user, dataKey) {
    if (!user?.encryptedEccPrivateKey || !dataKey) return null;
    const { eccPrivateKey } = await getUserPrivateKeys(user, dataKey);
    return await eccSign(canonicalJSON(payload), eccPrivateKey);
}

async function verifyRecord(payload, signature, user) {
    if (!signature || !user?.eccPublicKey) return false;
    return await eccVerify(canonicalJSON(payload), signature, user.eccPublicKey);
}

async function encryptNote(plaintext, user) {
    if (!plaintext || !user?.rsaPublicKey) return null;
    return await rsaEncrypt(plaintext, user.rsaPublicKey);
}

// Graceful: old notes (encrypted with a pre-migration RSA key) cannot decrypt
// against the new PEM private key. Catch and return null with a warning so
// listing a record with a legacy note doesn't surface a 500 to the user.
// Bounded surface: only applies to notes encrypted before the key migration
// at login.
async function decryptNote(ciphertext, user, dataKey) {
    if (!ciphertext || !user?.encryptedRsaPrivateKey || !dataKey) return null;
    try {
        const { rsaPrivateKey } = await getUserPrivateKeys(user, dataKey);
        return await rsaDecrypt(ciphertext, rsaPrivateKey);
    } catch (err) {
        console.warn(`decryptNote: legacy or corrupt note for user ${user?._id} — ${err.message}`);
        return null;
    }
}

module.exports = { signRecord, verifyRecord, encryptNote, decryptNote };
