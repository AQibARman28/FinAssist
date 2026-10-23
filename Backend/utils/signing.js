/**
 * signing.js — record attestations and encrypted notes.
 *
 * Attestations: the server signs the plaintext fields of a record (amount,
 * category, …) with the owner's ECDSA P-256 key, at creation and on every
 * update. attestationStatus() tells apart 'valid', 'missing' (the signature
 * was stripped, or the record predates signing) and 'invalid' (the fields
 * were changed outside the app), so controllers can flag the record instead
 * of quietly serving it.
 *
 * Notes: encrypted with the user's AES-256-GCM data key and bound to
 * owner + field (utils/encryption.js). The previous RSA-OAEP scheme could
 * hold at most 190 bytes, so longer notes crashed the request; notes written
 * with it still decrypt.
 */

const { rsaDecrypt, eccSign, eccVerify, getUserPrivateKeys } = require('./keyManagement');
const { encrypt, decrypt, fieldContext } = require('./encryption');

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

// 'valid' | 'missing' | 'invalid'
async function attestationStatus(payload, signature, user) {
    if (!signature) return 'missing';
    return (await verifyRecord(payload, signature, user)) ? 'valid' : 'invalid';
}

// `field` names the note's home, e.g. 'expense.note' — it becomes part of the
// AAD so a note can't be moved onto another user's record or another field.
async function encryptNote(plaintext, user, dataKey, field) {
    if (!plaintext) return null;
    if (!user?._id || !dataKey || !field) throw new TypeError('encryptNote: user, dataKey and field are required');
    return encrypt(plaintext, dataKey, fieldContext(field, user._id));
}

// Notes that fail authentication read as null with a warning rather than a
// 500, so one damaged note can't break a whole list.
async function decryptNote(ciphertext, user, dataKey, field) {
    if (!ciphertext || !user || !dataKey) return null;
    try {
        if (typeof ciphertext === 'string' && ciphertext.startsWith('v2:')) {
            return await decrypt(ciphertext, dataKey, fieldContext(field, user._id));
        }
        // Legacy RSA-OAEP note.
        const { rsaPrivateKey } = await getUserPrivateKeys(user, dataKey);
        return await rsaDecrypt(ciphertext, rsaPrivateKey);
    } catch (err) {
        console.warn(`decryptNote: unreadable note for user ${user?._id} — ${err.message}`);
        return null;
    }
}

module.exports = { signRecord, verifyRecord, attestationStatus, encryptNote, decryptNote, canonicalJSON };
