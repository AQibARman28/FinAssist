'use strict';

/*
 * HMAC-SHA256 implemented from scratch (RFC 2104, with SHA-256 as the inner hash).
 *
 * Why HMAC exists at all
 * ─────────────────────────────────────────────────────────────────────────────
 * The naive way to authenticate a message with a shared secret would be to
 * compute `sha256(secret || message)` and ship the digest along with the
 * message. That is broken. SHA-256 (and every other Merkle-Damgård hash) is
 * vulnerable to a *length-extension attack*: given the digest of an unknown
 * input, an attacker can compute the digest of that input concatenated with
 * arbitrary trailing bytes, *without ever learning the secret*. So if a server
 * accepts `sha256(secret || message)` as proof that `message` came from
 * someone holding `secret`, an attacker who saw one valid (message, tag) pair
 * can forge tags for `message || extra` for any extra they like.
 *
 * The HMAC construction
 * ─────────────────────────────────────────────────────────────────────────────
 * HMAC defeats this by wrapping the hash twice with two different padded
 * versions of the key:
 *
 *   HMAC(K, m) = H( (K' XOR opad) || H( (K' XOR ipad) || m ) )
 *
 * The inner H still has the length-extension weakness, but its output is fed
 * straight into the outer H — and an attacker who only sees the outer
 * digest gets no foothold to extend it, because the outer hash's input
 * (K' XOR opad || inner digest) is fixed-length and unknown to them.
 *
 * Key preparation (the K' step)
 * ─────────────────────────────────────────────────────────────────────────────
 * Both XOR steps need a key that is exactly one block of the hash function
 * (B = 64 bytes for SHA-256). So we normalize:
 *   - If the key is longer than B, replace it with sha256(key) — 32 bytes —
 *     and zero-pad to 64. (A long key is "summarized" by hashing.)
 *   - If the key is shorter than B, right-pad with zeros to 64 bytes.
 *   - If the key is already exactly B, use it unchanged.
 *
 * Why ipad = 0x36 and opad = 0x5c specifically
 * ─────────────────────────────────────────────────────────────────────────────
 * The two pad bytes are 0x36 = 0011_0110 and 0x5C = 0101_1100. Their bitwise
 * XOR is 0110_1010 — exactly 4 of 8 bits differ, the maximum possible
 * "spread" between two byte values. That means K' XOR ipad and K' XOR opad
 * differ in *half* of all bit positions of the prepared key, so the inner
 * and outer hash inputs are well separated even when the underlying key is
 * the same. This is what gives HMAC its security proof.
 *
 * Allowed dependencies
 * ─────────────────────────────────────────────────────────────────────────────
 * The only require() in this file is `./sha256` (our from-scratch SHA-256).
 * No `crypto.createHmac`, no `crypto.createHash`, no library hashing
 * primitives — the algorithm is hand-rolled end to end.
 */

const { sha256 } = require('./sha256');


// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/*
 * BLOCK_SIZE is the underlying hash function's block size, not its output
 * size. SHA-256 processes data in chunks of 64 bytes (512 bits) — that is
 * the value we need here, regardless of the fact that SHA-256's *digest* is
 * 32 bytes. Mixing these two up is one of the classic HMAC implementation
 * bugs.
 */
const BLOCK_SIZE = 64;

/*
 * IPAD_BYTE — the byte value the prepared key gets XORed with for the inner
 * hash. 0x36 = 0011_0110.
 */
const IPAD_BYTE = 0x36;

/*
 * OPAD_BYTE — the byte value the prepared key gets XORed with for the outer
 * hash. 0x5C = 0101_1100. As noted above, ipad and opad were chosen to
 * differ in 4 of 8 bit positions for maximum separation.
 */
const OPAD_BYTE = 0x5c;


// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerce `input` to a Buffer.
 *
 * Strings are UTF-8 encoded; Buffers are returned unchanged. The `label`
 * argument is used purely for the error message so that a wrong-typed
 * `key` complains about the key (not the message) and vice versa.
 */
function toBuffer(input, label) {
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === 'string') return Buffer.from(input, 'utf8');
    throw new TypeError(`hmacSha256: ${label} must be a string or Buffer`);
}

/**
 * Normalize the user-supplied key to exactly BLOCK_SIZE bytes.
 *
 * Per RFC 2104:
 *   1. If the key is longer than the block size, replace it with the hash
 *      of the original key. This produces a 32-byte buffer for SHA-256,
 *      which is then zero-padded up to 64 bytes by step 2.
 *   2. If the (possibly hashed) key is shorter than the block size, pad
 *      it with zero bytes on the right until it is exactly BLOCK_SIZE bytes.
 */
function prepareKey(key) {
    let k = toBuffer(key, 'key');

    // Step 1: hash long keys down to 32 bytes.
    if (k.length > BLOCK_SIZE) {
        k = sha256(k);
    }

    // Step 2: right-pad short keys with zeros up to BLOCK_SIZE.
    // Buffer.alloc returns a zero-filled buffer, so we just have to copy
    // the existing key bytes into the start of it.
    if (k.length < BLOCK_SIZE) {
        const padded = Buffer.alloc(BLOCK_SIZE);
        k.copy(padded, 0);
        k = padded;
    }

    return k;  // exactly BLOCK_SIZE bytes
}

/**
 * Return a new buffer where every byte of `buf` has been XORed with the
 * scalar byte value `b`.
 *
 * This is the core operation used to produce K_ipad and K_opad from the
 * prepared key.
 */
function xorWithByte(buf, b) {
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
        out[i] = buf[i] ^ b;
    }
    return out;
}


// ─────────────────────────────────────────────────────────────────────────────
// Main HMAC routine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 of `message` under shared secret `key`.
 *
 *   HMAC(K, m) = sha256( (K' XOR opad) || sha256( (K' XOR ipad) || m ) )
 *
 * @param {string|Buffer} key      — the shared secret
 * @param {string|Buffer} message  — the message to authenticate
 * @returns {Buffer} 32-byte authentication tag
 */
function hmacSha256(key, message) {
    const msgBuf = toBuffer(message, 'message');

    // Bring the key to exactly one hash block (64 bytes).
    const k = prepareKey(key);

    // Build the two padded keys by XORing the prepared key with the constants.
    const kIpad = xorWithByte(k, IPAD_BYTE);
    const kOpad = xorWithByte(k, OPAD_BYTE);

    // Inner hash: takes the message itself, prefixed with the ipad-key.
    // Length-extension attacks against this inner output are possible, but
    // that's fine — only the outer hash is ever published.
    const innerInput = Buffer.concat([kIpad, msgBuf]);
    const innerHash  = sha256(innerInput);

    // Outer hash: a fixed 64+32 = 96 byte input — opad-key concatenated with
    // the inner digest. This is what we return as the HMAC.
    const outerInput = Buffer.concat([kOpad, innerHash]);
    return sha256(outerInput);
}

/**
 * Convenience wrapper — returns the HMAC as a 64-character hex string.
 */
function hmacSha256Hex(key, message) {
    return hmacSha256(key, message).toString('hex');
}


module.exports = { hmacSha256, hmacSha256Hex };


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node hmacSha256.js
// Three RFC 4231 known-answer test vectors. All three should print PASS.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const vectors = [
        {
            name:     'RFC 4231 #1 (key=0x0b×20, msg="Hi There")',
            key:      Buffer.alloc(20, 0x0b),
            message:  'Hi There',
            expected: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
        },
        {
            name:     'RFC 4231 #2 (key="Jefe", msg="what do ya want for nothing?")',
            key:      'Jefe',
            message:  'what do ya want for nothing?',
            expected: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
        },
        {
            name:     'RFC 4231 #3 (key=0xaa×20, msg=0xdd×50)',
            key:      Buffer.alloc(20, 0xaa),
            message:  Buffer.alloc(50, 0xdd),
            expected: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe'
        }
    ];

    let allPass = true;
    for (const { name, key, message, expected } of vectors) {
        const got  = hmacSha256Hex(key, message);
        const pass = got === expected;
        if (!pass) allPass = false;

        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
        if (!pass) {
            console.log(`        expected: ${expected}`);
            console.log(`        got:      ${got}`);
        }
    }

    process.exit(allPass ? 0 : 1);
}
