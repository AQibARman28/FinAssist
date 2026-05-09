const { encrypt, decrypt } = require('./encryption');
const { callPython } = require('./pyCrypto');


// ── Helpers (private) ────────────────────────────────────────────────────────

/**
 * Encode a non-negative BigInt as an even-length lowercase hex string
 * (no '0x' prefix). Even length matters because Buffer.from(..., 'hex')
 * silently drops a trailing odd digit; everything in this file expects to
 * round-trip through Buffer cleanly if needed.
 */
function bigIntToHex(n) {
    if (typeof n !== 'bigint') throw new TypeError('bigIntToHex: input must be a BigInt');
    if (n < 0n) throw new RangeError('bigIntToHex: input must be non-negative');
    let hex = n.toString(16);
    if (hex.length % 2 === 1) hex = '0' + hex;
    return hex;
}

/**
 * Decode a hex string (with or without '0x' prefix) into a BigInt.
 * An empty string decodes to 0n.
 */
function hexToBigInt(s) {
    if (typeof s !== 'string') throw new TypeError('hexToBigInt: input must be a string');
    const cleaned = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
    if (cleaned.length === 0) return 0n;
    if (!/^[0-9a-fA-F]+$/.test(cleaned)) throw new Error('hexToBigInt: invalid hex characters');
    return BigInt('0x' + cleaned);
}

/**
 * Coerce a key argument into a plain object with BigInt fields, accepting:
 *   - a JSON string (e.g. user.rsaPublicKey straight from MongoDB) — parsed
 *     and every string field hex-decoded;
 *   - an object whose fields are already BigInts (e.g. the result of
 *     getUserPrivateKeys) — used as-is;
 *   - an object with hex-string fields — fields hex-decoded.
 *
 * This is the polymorphism that lets signing.js stay unchanged across the
 * swap: every entry point below just calls normalizeKey on whatever it
 * receives.
 */
function normalizeKey(key) {
    let obj = key;
    if (typeof key === 'string') obj = JSON.parse(key);
    if (typeof obj !== 'object' || obj === null) {
        throw new TypeError('keyManagement: key must be a JSON string or an object');
    }
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'bigint') {
            out[k] = v;
        } else if (typeof v === 'string') {
            out[k] = hexToBigInt(v);
        } else {
            throw new TypeError(`keyManagement: key field "${k}" must be a BigInt or hex string`);
        }
    }
    return out;
}


// ── RSA-2048 (key wrapping, payload encryption) ───────────────────────────────

async function generateRSAKeyPair() {
    const { public_json, private_json } = await callPython('rsa_generate_keypair', {});
    return { publicKey: public_json, privateKey: private_json };
}

async function rsaEncrypt(plaintext, publicKey) {
    const publicJson = (typeof publicKey === 'string') ? publicKey : JSON.stringify(publicKey);
    const result = await callPython('rsa_oaep_encrypt', {
        public_json: publicJson,
        plaintext_b64: Buffer.from(plaintext, 'utf8').toString('base64')
    });
    return result.ciphertext_b64;
}

async function rsaDecrypt(ciphertext, privateKey) {
    const privateJson = (typeof privateKey === 'string') ? privateKey : JSON.stringify(privateKey);
    const result = await callPython('rsa_oaep_decrypt', {
        private_json: privateJson,
        ciphertext_b64: ciphertext
    });
    return Buffer.from(result.plaintext_b64, 'base64').toString('utf8');
}


// ── ECC P-256 (digital signatures for data integrity) ────────────────────────

async function generateECCKeyPair() {
    const { public_json, private_json } = await callPython('ecdsa_generate_keypair', {});
    return { publicKey: public_json, privateKey: private_json };
}

async function eccSign(data, privateKey) {
    const privateJson = (typeof privateKey === 'string') ? privateKey : JSON.stringify(privateKey);
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    const result = await callPython('ecdsa_sign', {
        private_json: privateJson,
        message_b64: Buffer.from(message, 'utf8').toString('base64')
    });
    return result.signature_b64;
}

async function eccVerify(data, signature, publicKey) {
    try {
        const publicJson = (typeof publicKey === 'string') ? publicKey : JSON.stringify(publicKey);
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        const result = await callPython('ecdsa_verify', {
            public_json: publicJson,
            message_b64: Buffer.from(message, 'utf8').toString('base64'),
            signature_b64: signature
        });
        return result.ok;
    } catch {
        return false;
    }
}


// ── Key bundle generation (called at registration) ────────────────────────────

async function generateUserKeyBundle(dataKey) {
    const rsa = await generateRSAKeyPair();
    const ecc = await generateECCKeyPair();
    return {
        rsaPublicKey:           rsa.publicKey,
        encryptedRsaPrivateKey: await encrypt(rsa.privateKey, dataKey),
        eccPublicKey:           ecc.publicKey,
        encryptedEccPrivateKey: await encrypt(ecc.privateKey, dataKey)
    };
}

// Decrypt private keys from stored ciphertext.
//
// Return shape: each value is the raw decrypted JSON storage string
// ({"n":"<hex>",...} for RSA, {"d":"<hex>"} for ECDSA). Callers (currently
// just signing.js) hand these strings straight to rsaDecrypt / eccSign,
// which forward them to the Python dispatcher's *_json args without
// further parsing.
async function getUserPrivateKeys(user, dataKey) {
    return {
        rsaPrivateKey: await decrypt(user.encryptedRsaPrivateKey, dataKey),
        eccPrivateKey: await decrypt(user.encryptedEccPrivateKey, dataKey)
    };
}


// ── Key rotation ──────────────────────────────────────────────────────────────
// Re-encrypts the user's dataKey with the new master key.
// (Call after rotating MASTER_ENCRYPTION_KEY.)
async function rotateUserDataKey(user, oldMasterDecrypt, newMasterEncrypt) {
    const rawKey = await oldMasterDecrypt(user.encryptedDataKey);
    return {
        encryptedDataKey: await newMasterEncrypt(rawKey),
        keyVersion: (user.keyVersion || 1) + 1
    };
}


module.exports = {
    generateRSAKeyPair, rsaEncrypt, rsaDecrypt,
    generateECCKeyPair, eccSign, eccVerify,
    generateUserKeyBundle, getUserPrivateKeys,
    rotateUserDataKey
};
