'use strict';

/*
 * PBKDF2-SHA256 implemented from scratch (RFC 8018 §5.2).
 *
 * Why PBKDF2 exists at all
 * ─────────────────────────────────────────────────────────────────────────────
 * Naïvely storing a password as `sha256(password || salt)` is broken not
 * because the math is wrong, but because the math is *too fast*. SHA-256 is
 * designed to hash gigabytes per second. An attacker with a stolen database
 * row can try billions of password guesses per second per GPU, so any human-
 * memorable password gets cracked in minutes.
 *
 * PBKDF2's whole job is to make the hash function deliberately slow. It runs
 * the underlying primitive (HMAC-SHA256 in our case) `iterations` times in a
 * tight chain — 100,000 iterations means each guess costs the attacker 100,000
 * HMAC calls instead of one. That drags brute-forcing from billions/sec down
 * to thousands/sec on the same hardware. The user sees one verification at
 * login time (about 0.5 s for this pure-JS version at 100,000 iterations,
 * measured on an Intel i9-11900H with Node 24; a native implementation is
 * much faster), but the attacker sees a five-orders-of-magnitude tax on
 * every guess.
 *
 * The cost factor is configurable, which is the whole point: as hardware gets
 * faster, you bump `iterations` up to keep the verification time roughly
 * constant (the OWASP recommendation has crept from 1,000 in the 2000s to
 * 600,000+ today for SHA-256). Older stored hashes stay valid because the
 * iteration count travels with each record.
 *
 * Why we replaced bcrypt
 * ─────────────────────────────────────────────────────────────────────────────
 * Real bcrypt is built on the Eksblowfish key derivation, which abuses the
 * Blowfish block cipher's key schedule as a deliberate-slow-mixing function.
 * Implementing bcrypt from scratch means writing a full Blowfish, then
 * writing the modified key schedule on top of it — a substantial detour that
 * wouldn't reuse anything else in this folder.
 *
 * PBKDF2-SHA256 is not bcrypt, but it satisfies the same role for the
 * project's purposes: a slow, salted, parameterized password hash. And
 * crucially, it is built entirely on HMAC-SHA256, which we already have. The
 * project specification says "a cryptographic hash function combined with a
 * random salt" — PBKDF2-SHA256 is that, made deliberately slow via the
 * iteration parameter.
 *
 * (For a "modern" choice you would use Argon2id, which adds memory-hardness
 * on top. Argon2 is a multi-thousand-line algorithm in its own right and out
 * of scope for this folder.)
 *
 * Constant-time comparison in verifyPassword
 * ─────────────────────────────────────────────────────────────────────────────
 * The same reasoning as the GCM tag check: a byte-by-byte equality function
 * that exits on first mismatch leaks information about *which* byte
 * differed, via response timing. An attacker can use that signal to recover
 * the stored hash one byte at a time. We walk every byte unconditionally and
 * combine the results with bitwise OR so the loop body cost is independent
 * of where the strings start to differ.
 *
 * Allowed dependencies
 * ─────────────────────────────────────────────────────────────────────────────
 * `./hmacSha256` for the algorithm itself (the only require for the actual
 *   PBKDF2 work).
 * Node's `crypto.randomBytes` for entropy when generating the salt in
 *   hashPassword. The algorithm is still ours; we are only using the OS RNG.
 */

const { createHmacSha256 } = require('./hmacSha256');
const crypto               = require('crypto');   // randomBytes only — see hashPassword


// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/*
 * The output size of SHA-256 in bytes. RFC 8018 calls this `hLen`. PBKDF2
 * generates the requested key in chunks of this size and concatenates them.
 */
const HASH_OUTPUT_BYTES = 32;

/*
 * Defaults for hashPassword. The iteration count and 16-byte salt match
 * common PBKDF2-SHA256 deployments; 32 bytes of derived key gives a
 * sufficient-for-anything output size.
 */
const HASH_PASSWORD_ITERATIONS  = 100000;
const HASH_PASSWORD_KEY_LENGTH  = 32;
const HASH_PASSWORD_SALT_LENGTH = 16;

/*
 * Upper bounds. verifyPassword reads the iteration count and the derived-
 * key length out of the stored string, so without a cap a corrupted or
 * hostile record ("pbkdf2-sha256$999999999999$...") turns one login into
 * hours of CPU. The caps are far above any sane setting:
 *   - MAX_ITERATIONS = 10,000,000 (~16× OWASP 2023's 600,000 for
 *     PBKDF2-HMAC-SHA256);
 *   - MAX_KEY_LENGTH = 1024 bytes (32 output blocks; every extra 32-byte
 *     block re-runs all the iterations, and password hashing needs 32).
 */
const MAX_ITERATIONS = 10000000;
const MAX_KEY_LENGTH = 1024;


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerce `input` to a Buffer. Strings become UTF-8; Buffers pass through.
 * The `label` argument only flavours the error message.
 */
function toBuffer(input, label) {
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === 'string') return Buffer.from(input, 'utf8');
    throw new TypeError(`pbkdf2: ${label} must be a string or Buffer`);
}

/**
 * Encode a non-negative integer `n` as a 4-byte big-endian Buffer.
 *
 * RFC 8018 calls this `INT(i)`. PBKDF2 appends INT(blockIndex) to the salt
 * for the first HMAC call of each block, so different output blocks are
 * derived from different inputs — they aren't just copies of the same hash.
 */
function int32BE(n) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(n, 0);
    return buf;
}

/**
 * Constant-time byte comparison.
 *
 * Returns true iff `a` and `b` are byte-identical. The runtime depends on
 * the *length* of the inputs but not on their contents, so an attacker
 * cannot use response timing to learn which byte first differed.
 *
 * (Length mismatch returns false immediately — there is no way to make the
 * comparison time independent of length without picking a fixed length to
 * pad to, and the length of a stored derived key is not itself secret.)
 */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// Core derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute one 32-byte output block T_i of PBKDF2 — RFC 8018 §5.2 step 3.
 *
 *   U_1     = HMAC(password, salt || INT32_BE(blockIndex))
 *   U_j     = HMAC(password, U_{j-1})    for j = 2..iterations
 *   T_i     = U_1 XOR U_2 XOR ... XOR U_iterations
 *
 * Note that the chain is sequential — U_j depends on U_{j-1} — so all
 * `iterations` HMACs must run in order. This is what makes PBKDF2 slow:
 * an attacker cannot parallelize within a single guess, only across guesses.
 *
 * `prf` is HMAC-SHA256 with the password's key state already prepared
 * (createHmacSha256(password)), so the password is processed once per
 * derivation instead of once per iteration.
 */
function deriveBlock(prf, salt, iterations, blockIndex) {
    // Seed for U_1: salt with the 4-byte block counter appended.
    const seed = Buffer.concat([salt, int32BE(blockIndex)]);

    // U_1 = HMAC(password, seed)
    let U = prf(seed);

    // Initialize the running XOR accumulator with U_1.
    // Buffer.from(U) makes an independent copy — mutating T must not touch U.
    const T = Buffer.from(U);

    // Iterations 2..n: chain HMACs and XOR each into T.
    for (let j = 2; j <= iterations; j++) {
        U = prf(U);
        for (let k = 0; k < HASH_OUTPUT_BYTES; k++) {
            T[k] ^= U[k];
        }
    }

    return T;
}

/**
 * PBKDF2-SHA256 — derive `keyLength` bytes from (password, salt) using
 * `iterations` rounds.
 *
 * @param {string|Buffer} password
 * @param {string|Buffer} salt
 * @param {number}        iterations  — integer in [1, MAX_ITERATIONS]
 * @param {number}        keyLength   — output bytes, integer in [1, MAX_KEY_LENGTH]
 * @returns {Buffer} `keyLength` bytes of derived key
 */
function pbkdf2(password, salt, iterations, keyLength) {
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
        throw new RangeError(`pbkdf2: iterations must be an integer from 1 to ${MAX_ITERATIONS}`);
    }
    if (!Number.isInteger(keyLength) || keyLength < 1 || keyLength > MAX_KEY_LENGTH) {
        throw new RangeError(`pbkdf2: keyLength must be an integer from 1 to ${MAX_KEY_LENGTH}`);
    }

    const passwordBuf = toBuffer(password, 'password');
    const saltBuf     = toBuffer(salt,     'salt');

    // Prepare the HMAC key state (K' XOR ipad, K' XOR opad) ONCE. Long
    // passwords are hashed here a single time, not on every iteration.
    const prf = createHmacSha256(passwordBuf);

    // Number of 32-byte chunks needed; we'll truncate the last one if the
    // requested keyLength is not a multiple of HASH_OUTPUT_BYTES.
    const numBlocks = Math.ceil(keyLength / HASH_OUTPUT_BYTES);
    const output    = Buffer.alloc(numBlocks * HASH_OUTPUT_BYTES);

    // T_1, T_2, ..., T_l — each block independent of the others (they
    // differ only in the INT32_BE(i) appended to the salt for U_1).
    for (let i = 1; i <= numBlocks; i++) {
        const T = deriveBlock(prf, saltBuf, iterations, i);
        T.copy(output, (i - 1) * HASH_OUTPUT_BYTES);
    }

    // Truncate to the requested length. subarray returns a view that shares
    // memory; for our return value that's fine because output is local.
    return Buffer.from(output.subarray(0, keyLength));
}


// ─────────────────────────────────────────────────────────────────────────────
// Storage-format wrappers
// ─────────────────────────────────────────────────────────────────────────────

/*
 * Stored password format:
 *
 *   pbkdf2-sha256$<iterations>$<saltHex>$<derivedKeyHex>
 *
 * A single dollar-separated string per record. The format is:
 *   - "pbkdf2-sha256"   — algorithm tag, makes future migrations possible
 *   - <iterations>      — decimal integer, lets us bump cost over time
 *                         without invalidating older stored hashes
 *   - <saltHex>         — the random per-record salt, hex-encoded
 *   - <derivedKeyHex>   — the PBKDF2 output, hex-encoded
 *
 * Every column needed to verify the password is in this one string, so the
 * database column can be a simple TEXT/VARCHAR. Mirrors the established
 * "passlib" convention used by Django, Werkzeug, etc.
 */

/**
 * Hash a password for storage.
 *
 * Generates a fresh 16-byte random salt, runs PBKDF2 with 100,000 iterations
 * and a 32-byte output, and returns the dollar-separated storage string.
 *
 * The salt comes from `crypto.randomBytes`, which the project policy permits
 * (entropy only — the algorithm above is still ours). Without a fresh salt
 * per password, two users picking the same password would have identical
 * stored hashes, which lets an attacker target many users' rows with a
 * single brute-force run.
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(HASH_PASSWORD_SALT_LENGTH);
    const dk   = pbkdf2(password, salt, HASH_PASSWORD_ITERATIONS, HASH_PASSWORD_KEY_LENGTH);
    return `pbkdf2-sha256$${HASH_PASSWORD_ITERATIONS}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

/**
 * Verify a password against a previously-stored hash string.
 *
 * Parses the dollar-separated format, re-derives the key with the same salt
 * and iteration count, and constant-time-compares against the stored
 * derived key. Returns false on any parse failure or any mismatch — never
 * throws, so caller code can treat the boolean as the only signal.
 */
function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;

    const parts = stored.split('$');
    if (parts.length !== 4)             return false;
    if (parts[0] !== 'pbkdf2-sha256')   return false;
    if (!/^\d+$/.test(parts[1]))        return false;

    const iterations = Number.parseInt(parts[1], 10);
    if (iterations < 1)                 return false;
    if (iterations > MAX_ITERATIONS)    return false;   // also catches 1e21-style overflow

    const salt     = Buffer.from(parts[2], 'hex');
    const expected = Buffer.from(parts[3], 'hex');
    if (salt.length === 0)              return false;
    if (expected.length === 0)          return false;
    if (expected.length > MAX_KEY_LENGTH) return false;

    const actual = pbkdf2(password, salt, iterations, expected.length);
    return constantTimeEqual(actual, expected);
}


module.exports = { pbkdf2, hashPassword, verifyPassword, MAX_ITERATIONS, MAX_KEY_LENGTH };


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node pbkdf2.js
// The two RFC 7914 §11 PBKDF2-HMAC-SHA-256 vectors, a hashPassword /
// verifyPassword round-trip, a long-password cost check and the bounds
// check. Test #2 runs 80,000 iterations × 2 blocks (about 0.9 s measured on
// the dev machine, Node 24); each test prints a "running..." line first so
// the terminal does not look frozen.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    let allPass = true;

    // ── Test 1 — RFC 7914 §11 vector (c=1) ──────────────────────────────
    // (RFC 6070's vectors are for PBKDF2-HMAC-SHA1; these are SHA-256.)
    {
        const password   = 'passwd';
        const salt       = 'salt';
        const iterations = 1;
        const keyLength  = 64;
        const expected   =
            '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc' +
            '49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783';

        process.stdout.write('  running Test 1 (1 iteration, 64 bytes)... ');
        const got  = pbkdf2(password, salt, iterations, keyLength).toString('hex');
        const pass = got === expected;
        if (!pass) allPass = false;
        console.log(pass ? 'PASS' : 'FAIL');
        if (!pass) {
            console.log(`        expected: ${expected}`);
            console.log(`        got:      ${got}`);
        }
    }

    // ── Test 2 — RFC 7914 §11 vector (80,000 iterations, slow) ──────────
    {
        const password   = 'Password';
        const salt       = 'NaCl';
        const iterations = 80000;
        const keyLength  = 64;
        const expected   =
            '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56' +
            'a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d';

        process.stdout.write('  running Test 2 (80,000 iterations, 64 bytes — slow)... ');
        const t0   = Date.now();
        const got  = pbkdf2(password, salt, iterations, keyLength).toString('hex');
        const ms   = Date.now() - t0;
        const pass = got === expected;
        if (!pass) allPass = false;
        console.log(`${pass ? 'PASS' : 'FAIL'} (${(ms / 1000).toFixed(1)}s)`);
        if (!pass) {
            console.log(`        expected: ${expected}`);
            console.log(`        got:      ${got}`);
        }
    }

    // ── Test 3 — hashPassword / verifyPassword round-trip ───────────────
    {
        process.stdout.write('  running Test 3 (hashPassword + verifyPassword)... ');
        const t0     = Date.now();
        const stored = hashPassword('hunter2');
        const acceptCorrect = verifyPassword('hunter2', stored);
        const rejectWrong   = verifyPassword('wrong',   stored) === false;
        const ms     = Date.now() - t0;

        const pass = acceptCorrect && rejectWrong && /^pbkdf2-sha256\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(stored);
        if (!pass) allPass = false;
        console.log(`${pass ? 'PASS' : 'FAIL'} (${(ms / 1000).toFixed(1)}s)`);
        if (!pass) {
            console.log(`        stored format:    ${stored}`);
            console.log(`        accepts correct:  ${acceptCorrect}`);
            console.log(`        rejects wrong:    ${rejectWrong}`);
        }
    }

    // ── Test 4 — long passwords cost (almost) the same as short ones ────
    {
        // HMAC hashes any key longer than 64 bytes down to sha256(key). If
        // that key preparation is redone for every one of the `iterations`
        // HMAC calls, a 64 KiB password costs ~250× a short one. With the
        // key state prepared once per derivation, the extra cost is a
        // single 64 KiB hash.
        //
        // Correctness check without an external reference: for |P| > 64,
        // HMAC(P, ·) == HMAC(sha256(P), ·), hence
        // PBKDF2(P) == PBKDF2(sha256(P)) — a known PBKDF2-HMAC property.
        process.stdout.write('  running Test 4 (64 KiB password vs 8-byte password, 2,000 iterations)... ');
        const { sha256 } = require('./sha256');
        const longPw  = Buffer.alloc(64 * 1024, 0x61);
        const shortPw = 'hunter22';
        const time = (fn) => { const t0 = process.hrtime.bigint(); const out = fn(); return [out, Number(process.hrtime.bigint() - t0) / 1e6]; };
        const [, shortMs]   = time(() => pbkdf2(shortPw, 'NaCl', 2000, 32));
        const [dkLong, longMs] = time(() => pbkdf2(longPw, 'NaCl', 2000, 32));
        const dkHashed = pbkdf2(sha256(longPw), 'NaCl', 2000, 32);
        const sameAsHashed = Buffer.compare(dkLong, dkHashed) === 0;
        // Generous bound: the fixed cost is one 64 KiB hash (~1–2 ms here).
        const fastEnough = longMs < 3 * shortMs + 25;
        const pass = sameAsHashed && fastEnough;
        if (!pass) allPass = false;
        console.log(`${pass ? 'PASS' : 'FAIL'} (short ${shortMs.toFixed(0)} ms, long ${longMs.toFixed(0)} ms)`);
        if (!pass) console.log(`        sameAsHashed=${sameAsHashed} fastEnough=${fastEnough}`);
    }

    // ── Test 5 — iteration count and output length are bounded ──────────
    {
        process.stdout.write('  running Test 5 (iteration / output-length bounds)... ');
        const throws = (fn) => { try { fn(); return false; } catch { return true; } };
        const salt16 = '00112233445566778899aabbccddeeff';
        const dk32   = '00'.repeat(32);
        const checks = {
            // output length: MAX_KEY_LENGTH accepted (1 iteration keeps it fast), +1 rejected
            maxKeyLenOk:      !throws(() => pbkdf2('pw', 'salt', 1, MAX_KEY_LENGTH)),
            keyLenTooBig:     throws(() => pbkdf2('pw', 'salt', 1, MAX_KEY_LENGTH + 1)),
            // stored hash with an oversized derived key → false, no derivation
            verifyHugeDk:     verifyPassword('pw', `pbkdf2-sha256$1$${salt16}$${'00'.repeat(MAX_KEY_LENGTH + 1)}`) === false,
            // iterations: MAX_ITERATIONS + 1 rejected before any work is done
            itersTooBig:      throws(() => pbkdf2('pw', 'salt', MAX_ITERATIONS + 1, 32)),
            itersUnsafeInt:   throws(() => pbkdf2('pw', 'salt', 2 ** 53, 32)),
            // stored hash with an absurd iteration count → false immediately
            verifyHugeIters:  verifyPassword('pw', `pbkdf2-sha256$${MAX_ITERATIONS + 1}$${salt16}$${dk32}`) === false,
            verifyHugeIters2: verifyPassword('pw', `pbkdf2-sha256$999999999999999999999$${salt16}$${dk32}`) === false
        };
        const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
        const pass = failed.length === 0;
        if (!pass) allPass = false;
        console.log(pass ? `PASS (MAX_ITERATIONS=${MAX_ITERATIONS}, MAX_KEY_LENGTH=${MAX_KEY_LENGTH})` : 'FAIL');
        if (!pass) console.log(`        failed: ${failed.join(', ')}`);
    }

    process.exit(allPass ? 0 : 1);
}
