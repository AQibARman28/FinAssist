'use strict';

/*
 * SHA-256 implemented from scratch (FIPS PUB 180-4, section 6.2).
 *
 * This file deliberately avoids Node's `crypto.createHash` and any other
 * library hashing primitive. The only built-ins used are Buffer (for byte I/O)
 * and JavaScript's native bitwise operators.
 *
 * The algorithm at a glance:
 *
 *   1. Pad the message so its length in bits is congruent to 448 mod 512,
 *      then append the original bit-length as a 64-bit big-endian integer.
 *      (This guarantees the padded message is a whole number of 512-bit blocks.)
 *
 *   2. Set up an 8-word "hash state" H, initialized from a fixed constant.
 *
 *   3. For each 512-bit block:
 *        - Expand the 16 input words into a 64-word "message schedule".
 *        - Run 64 rounds of mixing — each round shuffles 8 working variables
 *          (a..h) using a few bit operations and adds in one schedule word
 *          plus one round constant.
 *        - Add the final working variables back into H.
 *
 *   4. Concatenate H[0..7] into a 32-byte output.
 *
 * A small but important JavaScript quirk: bitwise operators (& | ^ ~ << >>)
 * coerce their operands to *signed* 32-bit integers. We need *unsigned*
 * 32-bit arithmetic, so every arithmetic result gets piped through `>>> 0`
 * (zero-fill right shift by 0), which is the cheapest way to clamp to
 * unsigned 32-bit in JS.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/*
 * INITIAL_HASH (H0..H7).
 *
 * These are the first 32 bits of the fractional parts of the square roots
 * of the first eight primes (2, 3, 5, 7, 11, 13, 17, 19). They are arbitrary
 * "nothing-up-my-sleeve" numbers chosen by NIST so the algorithm cannot be
 * accused of having a back door hidden inside the seed.
 *
 * Example for prime 2: sqrt(2) = 1.41421356...; the fractional part is
 * 0.41421356...; multiplying by 2^32 and truncating gives 0x6a09e667.
 */
const INITIAL_HASH = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

/*
 * ROUND_CONSTANTS (K0..K63).
 *
 * These are the first 32 bits of the fractional parts of the *cube* roots
 * of the first 64 primes (2, 3, 5, 7, 11, 13, 17, 19, 23, ..., 311). Same
 * "nothing-up-my-sleeve" idea as the initial hash values. There is one
 * constant per round of the compression function; round t uses K[t].
 */
const ROUND_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];


// ─────────────────────────────────────────────────────────────────────────────
// Bit-level helper functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rotate the 32-bit word `x` to the right by `n` bits.
 *
 * Bits that fall off the right edge wrap around to the left.
 * Mathematically: ROTR(n, x) = (x >> n) OR (x << (32 - n)), modulo 2^32.
 *
 * Example: rotr(4, 0x12345678) = 0x81234567.
 */
function rotr(n, x) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Ch — the "choose" function.
 *
 * For each bit position: if the bit in `x` is 1, use the corresponding bit
 * from `y`; otherwise use the bit from `z`. Like a bitwise multiplexer.
 *
 *   Ch(x, y, z) = (x AND y) XOR (NOT x AND z)
 */
function Ch(x, y, z) {
    return ((x & y) ^ (~x & z)) >>> 0;
}

/**
 * Maj — the "majority" function.
 *
 * For each bit position: returns whichever bit value (0 or 1) appears in
 * the majority of x, y, z. Equivalent to a bitwise majority vote across
 * three inputs.
 *
 *   Maj(x, y, z) = (x AND y) XOR (x AND z) XOR (y AND z)
 */
function Maj(x, y, z) {
    return ((x & y) ^ (x & z) ^ (y & z)) >>> 0;
}

/**
 * Big sigma 0 — diffusion function applied to working variable `a`.
 *
 *   Σ0(x) = ROTR(2, x) XOR ROTR(13, x) XOR ROTR(22, x)
 *
 * Mixing three differently-rotated copies of x with XOR ensures every
 * input bit influences many output bit positions, which is key to the
 * avalanche property of the hash.
 */
function bigSigma0(x) {
    return (rotr(2, x) ^ rotr(13, x) ^ rotr(22, x)) >>> 0;
}

/**
 * Big sigma 1 — diffusion function applied to working variable `e`.
 *
 *   Σ1(x) = ROTR(6, x) XOR ROTR(11, x) XOR ROTR(25, x)
 */
function bigSigma1(x) {
    return (rotr(6, x) ^ rotr(11, x) ^ rotr(25, x)) >>> 0;
}

/**
 * Small sigma 0 — diffusion function used when expanding the message schedule.
 *
 *   σ0(x) = ROTR(7, x) XOR ROTR(18, x) XOR (x >> 3)
 *
 * Note the non-circular right shift in the third term — that bit pattern is
 * what distinguishes the small sigmas from the big sigmas.
 */
function smallSigma0(x) {
    return (rotr(7, x) ^ rotr(18, x) ^ (x >>> 3)) >>> 0;
}

/**
 * Small sigma 1 — diffusion function used when expanding the message schedule.
 *
 *   σ1(x) = ROTR(17, x) XOR ROTR(19, x) XOR (x >> 10)
 */
function smallSigma1(x) {
    return (rotr(17, x) ^ rotr(19, x) ^ (x >>> 10)) >>> 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// Input handling and padding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerce the input message to a Buffer of bytes.
 *
 * Strings are encoded as UTF-8 (the standard convention for hashing text).
 * Buffers are returned as-is. Anything else is rejected.
 */
function toBuffer(message) {
    if (Buffer.isBuffer(message)) return message;
    if (typeof message === 'string') return Buffer.from(message, 'utf8');
    throw new TypeError('sha256: message must be a string or Buffer');
}

/**
 * Apply FIPS 180-4 padding to bring the message to a whole number of
 * 512-bit (64-byte) blocks.
 *
 * The padding rule:
 *   1. Append a single `1` bit to the message.
 *   2. Append `0` bits until the bit-length ≡ 448 (mod 512).
 *   3. Append the *original* message bit-length as a 64-bit big-endian integer.
 *
 * Because messages are already byte-aligned, step 1 is just appending the
 * byte 0x80 (which is binary 1000_0000 — one `1` followed by seven `0`s,
 * accounting for the first 7 zero bits of step 2 in the same byte).
 */
function pad(bytes) {
    const originalByteLen = bytes.length;
    const originalBitLen  = originalByteLen * 8;

    // After padding, total length must be a multiple of 64 bytes.
    // Layout: [original bytes] [0x80] [zero bytes] [8-byte length]
    // We need (originalByteLen + 1 + zeroBytes + 8) % 64 === 0.
    // Solving: zeroBytes = (55 - originalByteLen) mod 64.
    // The double-mod (`% 64 + 64) % 64`) handles the case where the
    // intermediate value is negative (JS `%` can produce negative results).
    const zeroBytes = (((55 - originalByteLen) % 64) + 64) % 64;

    const padded = Buffer.alloc(originalByteLen + 1 + zeroBytes + 8);
    bytes.copy(padded, 0);
    padded[originalByteLen] = 0x80;
    // The Buffer was allocated zero-filled, so we don't need to write the
    // intermediate zero bytes explicitly.

    // Write the original bit-length as a 64-bit big-endian integer in the
    // last 8 bytes. JavaScript numbers are exact up to 2^53, so for any
    // realistic input (well below 2^50 bytes / 1 PiB) we can split the
    // bit-length into a high and low 32-bit half safely.
    const lenHi = Math.floor(originalBitLen / 0x100000000);
    const lenLo = originalBitLen >>> 0;
    padded.writeUInt32BE(lenHi, padded.length - 8);
    padded.writeUInt32BE(lenLo, padded.length - 4);

    return padded;
}


// ─────────────────────────────────────────────────────────────────────────────
// Main hash routine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 digest of a message.
 *
 * @param {string|Buffer} message — UTF-8 string or raw bytes
 * @returns {Buffer} 32-byte digest
 */
function sha256(message) {
    const bytes  = toBuffer(message);
    const padded = pad(bytes);

    // Working copy of the hash state. We mutate this through every block.
    const H = INITIAL_HASH.slice();

    // Reusable scratch space for the 64-word message schedule. Reusing one
    // array (instead of allocating per block) is one of the few concessions
    // to performance — the algorithm itself is unchanged.
    const W = new Array(64);

    const numBlocks = padded.length / 64;

    for (let block = 0; block < numBlocks; block++) {
        const blockOffset = block * 64;

        // ── Step 1: build the 64-word message schedule W[0..63] ──────────
        //
        // The first 16 words come straight from the block, read as
        // big-endian 32-bit unsigned integers.
        for (let t = 0; t < 16; t++) {
            W[t] = padded.readUInt32BE(blockOffset + t * 4);
        }
        // The remaining 48 words are computed from earlier ones using the
        // small-sigma diffusion functions. This is the "message expansion"
        // step — it scrambles the original 64 input bytes into 256 bytes
        // of well-mixed schedule data.
        for (let t = 16; t < 64; t++) {
            W[t] = (
                smallSigma1(W[t - 2]) +
                W[t - 7] +
                smallSigma0(W[t - 15]) +
                W[t - 16]
            ) >>> 0;
        }

        // ── Step 2: initialize working variables a..h from the hash state ──
        let a = H[0], b = H[1], c = H[2], d = H[3];
        let e = H[4], f = H[5], g = H[6], h = H[7];

        // ── Step 3: 64 rounds of compression ──────────────────────────────
        //
        // Each round computes two temporary values and shifts everyone down
        // the register chain by one. Conceptually a..h is a sliding pipeline:
        //   new a = T1 + T2
        //   new b = old a
        //   new c = old b
        //   ...
        //   new e = old d + T1   (note the extra T1 injection — this and the
        //                          assignment to `a` are the two places the
        //                          message word + round constant enter the state)
        for (let t = 0; t < 64; t++) {
            const T1 = (h + bigSigma1(e) + Ch(e, f, g) + ROUND_CONSTANTS[t] + W[t]) >>> 0;
            const T2 = (bigSigma0(a) + Maj(a, b, c)) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + T1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (T1 + T2) >>> 0;
        }

        // ── Step 4: fold the compressed working variables into the hash state ──
        //
        // Adding (mod 2^32) — not assigning — is what makes the function
        // one-way: the previous state is mixed in, so you cannot run the
        // compression backwards.
        H[0] = (H[0] + a) >>> 0;
        H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0;
        H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0;
        H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0;
        H[7] = (H[7] + h) >>> 0;
    }

    // ── Step 5: serialize H[0..7] as big-endian into a 32-byte buffer ────
    const out = Buffer.alloc(32);
    for (let i = 0; i < 8; i++) {
        out.writeUInt32BE(H[i], i * 4);
    }
    return out;
}

/**
 * Convenience wrapper — returns the digest as a 64-character hex string.
 */
function sha256Hex(message) {
    return sha256(message).toString('hex');
}

/**
 * Alias for `sha256` with an explicit name. Useful when a reader skimming
 * an import list wants it spelled out that the return type is bytes.
 */
const sha256Bytes = sha256;


module.exports = { sha256, sha256Hex, sha256Bytes };


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node sha256.js
// Three FIPS 180-4 known-answer test vectors. All three should print PASS.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const vectors = [
        {
            input:    '',
            expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        },
        {
            input:    'abc',
            expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        },
        {
            input:    'The quick brown fox jumps over the lazy dog',
            expected: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
        }
    ];

    let allPass = true;
    for (const { input, expected } of vectors) {
        const got  = sha256Hex(input);
        const pass = got === expected;
        if (!pass) allPass = false;

        const shown = input.length > 30 ? input.slice(0, 27) + '...' : input;
        console.log(`${pass ? 'PASS' : 'FAIL'}  sha256(${JSON.stringify(shown)})`);
        if (!pass) {
            console.log(`        expected: ${expected}`);
            console.log(`        got:      ${got}`);
        }
    }

    process.exit(allPass ? 0 : 1);
}
