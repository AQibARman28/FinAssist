const { encrypt, decrypt } = require('./encryption');
const scratchRSA   = require('./scratch/rsa');
const scratchECDSA = require('./scratch/ecdsaP256');


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

function generateRSAKeyPair() {
    const { n, e, d, p, q } = scratchRSA.generateRSAKeyPair(2048);
    const publicKey  = JSON.stringify({ n: bigIntToHex(n), e: bigIntToHex(e) });
    const privateKey = JSON.stringify({
        n: bigIntToHex(n), e: bigIntToHex(e),
        d: bigIntToHex(d), p: bigIntToHex(p), q: bigIntToHex(q)
    });
    return { publicKey, privateKey };
}

function rsaEncrypt(plaintext, publicKey) {
    const { n, e } = normalizeKey(publicKey);
    const ctBuf = scratchRSA.rsaEncryptOAEP(plaintext, { n, e });
    return ctBuf.toString('base64');
}

function rsaDecrypt(ciphertext, privateKey) {
    const { n, d } = normalizeKey(privateKey);
    const ctBuf = Buffer.from(ciphertext, 'base64');
    const ptBuf = scratchRSA.rsaDecryptOAEP(ctBuf, { n, d });
    return ptBuf.toString('utf8');
}


// ── ECC P-256 (digital signatures for data integrity) ────────────────────────

function generateECCKeyPair() {
    const { d, Q } = scratchECDSA.generateECCKeyPair();
    const publicKey  = JSON.stringify({ x: bigIntToHex(Q.x), y: bigIntToHex(Q.y) });
    const privateKey = JSON.stringify({ d: bigIntToHex(d) });
    return { publicKey, privateKey };
}

function eccSign(data, privateKey) {
    const { d } = normalizeKey(privateKey);
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    const sigBuf = scratchECDSA.signECDSADER(message, d);
    return sigBuf.toString('base64');
}

function eccVerify(data, signature, publicKey) {
    try {
        const { x, y } = normalizeKey(publicKey);
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        const sigBuf  = Buffer.from(signature, 'base64');
        return scratchECDSA.verifyECDSADER(message, sigBuf, { x, y });
    } catch {
        return false;
    }
}


// ── Key bundle generation (called at registration) ────────────────────────────

function generateUserKeyBundle(dataKey) {
    const rsa = generateRSAKeyPair();
    const ecc = generateECCKeyPair();
    return {
        rsaPublicKey:           rsa.publicKey,
        encryptedRsaPrivateKey: encrypt(rsa.privateKey, dataKey),
        eccPublicKey:           ecc.publicKey,
        encryptedEccPrivateKey: encrypt(ecc.privateKey, dataKey)
    };
}

// Decrypt private keys from stored ciphertext.
//
// Return shape: each value is now a PARSED OBJECT with BigInt fields, not
// a PEM string as in the pre-swap implementation. Callers (currently just
// signing.js) hand these objects to the rsaDecrypt / eccSign / etc.
// entry points, which accept either an object or a JSON string via
// normalizeKey — so call sites need no changes.
function getUserPrivateKeys(user, dataKey) {
    return {
        rsaPrivateKey: normalizeKey(decrypt(user.encryptedRsaPrivateKey, dataKey)),
        eccPrivateKey: normalizeKey(decrypt(user.encryptedEccPrivateKey, dataKey))
    };
}


// ── Key rotation ──────────────────────────────────────────────────────────────
// Re-encrypts the user's dataKey with the new master key.
// (Call after rotating MASTER_ENCRYPTION_KEY.)
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
