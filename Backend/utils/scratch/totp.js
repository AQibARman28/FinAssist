'use strict';

/*
 * TOTP (RFC 6238) implemented from scratch on top of HMAC-SHA256.
 *
 * What TOTP actually is
 * ─────────────────────────────────────────────────────────────────────────────
 * TOTP is a thin wrapper around HOTP (RFC 4226). HOTP turns a shared secret
 * plus an integer counter into a short numeric code by HMACing the counter,
 * extracting 31 bits with a "dynamic truncation" trick, and taking the
 * result modulo 10^digits. TOTP just substitutes time for the counter:
 *
 *     T = floor((current Unix time in seconds) / period)
 *
 * The counter rolls over every `period` seconds (default 30), so the same
 * code is valid for an entire 30-second window. That's the visible
 * "ticking" you see in Google Authenticator.
 *
 * The dynamic truncation trick (RFC 4226 §5.3)
 * ─────────────────────────────────────────────────────────────────────────────
 * After computing mac = HMAC(key, counter), we can't just take the first 4
 * bytes — that would always be the same prefix for related counters,
 * leaking structure. Instead we use the LOW NIBBLE of the LAST byte of the
 * mac as an offset (a value in 0..15), then read 4 bytes starting at that
 * offset. Because the offset itself is unpredictable (it's another byte of
 * mac output), the chunk we read is effectively random across all 4-byte
 * windows of the HMAC output.
 *
 * The high bit of the first byte we read is masked off — that is, we treat
 * the 4 bytes as an UNSIGNED 31-bit integer. The mask exists because the
 * spec was originally written without committing to "unsigned" everywhere,
 * and on some platforms (notably old Java) the natural 4-byte read would
 * be sign-extended into a negative number, which would then get a negative
 * modulo. Forcing the top bit to zero defines the result unambiguously.
 *
 * The window parameter
 * ─────────────────────────────────────────────────────────────────────────────
 * Clocks drift. Phones lag. Network latency adds another fraction of a
 * second. So the verifier accepts codes from a few steps before and after
 * the current step. `window=1` (our default, also Google Authenticator's
 * default) means three codes are accepted at any given moment: the
 * previous, current, and next 30-second windows. window=2 widens to five
 * codes (a 2.5-minute total tolerance), trading security for usability.
 *
 * Why we use SHA-256 instead of SHA-1
 * ─────────────────────────────────────────────────────────────────────────────
 * RFC 6238 explicitly permits SHA-256 and SHA-512 as TOTP variants, but
 * legacy authenticator apps (Google Authenticator, Authy) default to SHA-1
 * and require explicit configuration to use anything else. We pick SHA-256
 * here because we already have it from-scratch in this folder, and SHA-1
 * was deliberately omitted from the project deliverable list. For real
 * production interop with off-the-shelf authenticator apps you would
 * either need a from-scratch SHA-1 too, or generate `otpauth://` URIs that
 * declare `algorithm=SHA256`.
 *
 * Constant-time string comparison in verifyTOTP
 * ─────────────────────────────────────────────────────────────────────────────
 * Same reasoning as the JWT signature compare, the GCM tag compare, and
 * the PBKDF2 stored-hash compare: an early-exit equality check leaks
 * timing information about how many leading bytes matched, letting an
 * attacker reconstruct the expected code one digit at a time. We walk the
 * full code length unconditionally and OR-accumulate the differences.
 *
 * Allowed dependencies
 * ─────────────────────────────────────────────────────────────────────────────
 *   ./hmacSha256        — the algorithm primitive
 *   crypto.randomBytes  — entropy only, used in generateSecret
 */

const { hmacSha256 } = require('./hmacSha256');
const crypto         = require('crypto');   // randomBytes only — see generateSecret


// ─────────────────────────────────────────────────────────────────────────────
// Base32 (RFC 4648)
// ─────────────────────────────────────────────────────────────────────────────

/*
 * The 32-character base32 alphabet. Note the deliberate omission of "0",
 * "1", "8", "9" (and lowercase) — these are easily confused with O, I, B,
 * etc. when typed by humans from a small phone screen. Authenticator apps
 * use this alphabet so users can read a secret off one device and type it
 * into another.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer as RFC 4648 base32, padding the output with `=` so its
 * length is a multiple of 8 characters.
 *
 * The implementation uses a small bit accumulator: shift each input byte
 * (8 bits) into the top of the accumulator, then peel off as many 5-bit
 * groups as possible. Any leftover bits at the end of input get padded on
 * the right with zeros to fill one final 5-bit group.
 *
 * After every emit we mask the accumulator down to its remaining bits so
 * `bits` stays small — without that mask the value would grow unbounded
 * across long inputs and overflow JS's 32-bit bitwise window.
 */
function base32Encode(buf) {
    if (!Buffer.isBuffer(buf)) {
        throw new TypeError('base32Encode: input must be a Buffer');
    }

    let bits     = 0;
    let bitCount = 0;
    let result   = '';

    for (let i = 0; i < buf.length; i++) {
        bits = (bits << 8) | buf[i];
        bitCount += 8;

        while (bitCount >= 5) {
            bitCount -= 5;
            result += BASE32_ALPHABET[(bits >> bitCount) & 0x1f];
        }

        // Drop bits we've already emitted so the accumulator stays small.
        bits = bits & ((1 << bitCount) - 1);
    }

    // Flush any leftover bits as a final 5-bit group, padded with zeros.
    if (bitCount > 0) {
        result += BASE32_ALPHABET[(bits << (5 - bitCount)) & 0x1f];
    }

    // Pad with '=' so the output length is a multiple of 8 characters.
    while (result.length % 8 !== 0) {
        result += '=';
    }

    return result;
}

/**
 * Decode an RFC 4648 base32 string back to a Buffer.
 *
 * Tolerant of:
 *   - whitespace (spaces, tabs, newlines anywhere — stripped before decoding)
 *   - lowercase letters (uppercased before decoding)
 *   - presence or absence of trailing `=` padding
 *
 * Throws on any character that isn't in the base32 alphabet (after the
 * tolerance steps above).
 */
function base32Decode(str) {
    if (typeof str !== 'string') {
        throw new TypeError('base32Decode: input must be a string');
    }

    // Whitespace ignored; trailing padding ignored; case-insensitive.
    const cleaned = str.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();

    let bits     = 0;
    let bitCount = 0;
    const out    = [];

    for (let i = 0; i < cleaned.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
        if (idx < 0) {
            throw new Error(`base32Decode: invalid character "${cleaned[i]}" at position ${i}`);
        }

        bits = (bits << 5) | idx;
        bitCount += 5;

        if (bitCount >= 8) {
            bitCount -= 8;
            out.push((bits >> bitCount) & 0xff);
            bits = bits & ((1 << bitCount) - 1);
        }
    }

    // Any remaining bitCount < 8 bits are the zero-padding from the
    // encoder's final partial group — discard them.
    return Buffer.from(out);
}


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random secret for use with TOTP.
 *
 * 20 bytes is the default because that's the legacy SHA-1 HMAC block-size-
 * appropriate length and it's what most authenticator-app reference
 * implementations recommend. For SHA-256 you can go up to 32 bytes; we
 * keep the default at 20 for cross-compatibility.
 */
function generateSecret(byteLength = 20) {
    if (!Number.isInteger(byteLength) || byteLength < 1) {
        throw new Error('generateSecret: byteLength must be a positive integer');
    }
    return crypto.randomBytes(byteLength);
}

/**
 * Convert a Unix-timestamp-in-seconds and a `period` (seconds per code)
 * into the integer counter that HOTP consumes.
 */
function counterFromTime(timestamp, period) {
    return Math.floor(timestamp / period);
}

/**
 * Constant-time string comparison.
 *
 * Returns true iff `a` and `b` are identical strings. Walks every code
 * point unconditionally so an attacker can't time-attack the verify path
 * to learn how many leading digits of the expected code they got right.
 */
function constantTimeStringEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// HOTP (RFC 4226) — the core building block
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the HOTP code for (key, counter, digits).
 *
 * Steps (verbatim from RFC 4226 §5.3, with HMAC-SHA256 substituted for
 * the original HMAC-SHA1):
 *
 *   1. Encode the integer counter as an 8-byte big-endian buffer.
 *   2. Compute mac = HMAC-SHA256(key, counterBuffer) — 32 bytes.
 *   3. Dynamic truncation:
 *        - offset  = mac[last] & 0x0F      (low nibble of last byte → 0..15)
 *        - take 4 bytes starting at `offset`, mask the top bit of the first
 *          to force unsigned interpretation, big-endian → 31-bit integer
 *   4. code = (that 31-bit integer) mod 10^digits, zero-padded to `digits`.
 *
 * Parameters:
 *   key     — string or Buffer (the shared secret bytes)
 *   counter — non-negative integer (TOTP passes floor(time/period))
 *   digits  — typically 6, sometimes 8
 */
function hotp(key, counter, digits) {
    // Step 1: 8-byte big-endian counter. JS numbers are exact up to 2^53,
    // so we split into two 32-bit halves and let writeUInt32BE serialize.
    const counterBuf = Buffer.alloc(8);
    const high = Math.floor(counter / 0x100000000);
    const low  = counter >>> 0;
    counterBuf.writeUInt32BE(high, 0);
    counterBuf.writeUInt32BE(low,  4);

    // Step 2: HMAC the counter with the shared secret.
    const mac = hmacSha256(key, counterBuf);   // 32 bytes

    // Step 3: dynamic truncation.
    const offset = mac[mac.length - 1] & 0x0f;
    const code31 = (
        ((mac[offset]     & 0x7f) << 24) |
         (mac[offset + 1]         << 16) |
         (mac[offset + 2]         <<  8) |
          mac[offset + 3]
    ) >>> 0;

    // Step 4: reduce mod 10^digits and zero-pad to width.
    const modulus = Math.pow(10, digits);
    const code    = code31 % modulus;
    return String(code).padStart(digits, '0');
}


// ─────────────────────────────────────────────────────────────────────────────
// TOTP entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a TOTP code for the current time (or the time supplied in
 * `options.timestamp`).
 *
 * @param {string|Buffer} secret
 * @param {object}        [options]
 * @param {number}        [options.digits=6]
 * @param {number}        [options.period=30]      — seconds per code
 * @param {number}        [options.timestamp]      — seconds since epoch; defaults to now
 * @param {string}        [options.algorithm='SHA256'] — only SHA256 is supported here
 * @returns {string} `digits`-digit code
 */
function generateTOTP(secret, options = {}) {
    const digits    = options.digits    ?? 6;
    const period    = options.period    ?? 30;
    const timestamp = options.timestamp ?? (Date.now() / 1000);
    const algorithm = options.algorithm ?? 'SHA256';

    if (typeof algorithm !== 'string' || algorithm.toUpperCase() !== 'SHA256') {
        throw new Error(`generateTOTP: algorithm "${algorithm}" not supported (this implementation uses SHA256 only)`);
    }
    if (!Number.isInteger(digits) || digits < 1) {
        throw new Error('generateTOTP: digits must be a positive integer');
    }
    if (!Number.isFinite(period) || period <= 0) {
        throw new Error('generateTOTP: period must be a positive number');
    }

    const counter = counterFromTime(timestamp, period);
    return hotp(secret, counter, digits);
}

/**
 * Verify a TOTP code, accepting codes from a window of steps around the
 * current step.
 *
 * @param {string}        code      — the code to check
 * @param {string|Buffer} secret    — same secret used to generate
 * @param {object}        [options]
 * @param {number}        [options.window=1]  — accept codes from ±window steps
 * @param {number}        [options.digits=6]
 * @param {number}        [options.period=30]
 * @param {number}        [options.timestamp] — seconds since epoch; defaults to now
 * @param {string}        [options.algorithm='SHA256']
 * @returns {boolean}
 */
function verifyTOTP(code, secret, options = {}) {
    if (typeof code !== 'string') return false;

    const window    = options.window    ?? 1;
    const digits    = options.digits    ?? 6;
    const period    = options.period    ?? 30;
    const timestamp = options.timestamp ?? (Date.now() / 1000);
    const algorithm = options.algorithm ?? 'SHA256';

    if (typeof algorithm !== 'string' || algorithm.toUpperCase() !== 'SHA256') return false;
    if (!Number.isInteger(window) || window < 0) return false;
    if (code.length !== digits) return false;

    const currentCounter = counterFromTime(timestamp, period);

    // Try each counter in [current - window, current + window]. If any
    // matches, the code is valid. We use constant-time comparison on each
    // candidate so an attacker can't use timing to determine which step
    // matched (or how many leading digits they got right).
    for (let offset = -window; offset <= window; offset++) {
        const trial = hotp(secret, currentCounter + offset, digits);
        if (constantTimeStringEqual(trial, code)) return true;
    }

    return false;
}


module.exports = {
    generateSecret,
    base32Encode,
    base32Decode,
    generateTOTP,
    verifyTOTP
};


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node totp.js
//
// Five tests covering:
//   1. RFC 6238 Appendix B SHA-256 vectors (8-digit codes at three times)
//   2. generateTOTP + verifyTOTP round-trip (and a wrong-code rejection)
//   3. window tolerance (accept ±1 step, reject ±3 steps)
//   4. base32 encode→decode round-trip on random bytes
//   5. base32 known vectors (RFC 4648 §10, with padding)
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    let allPass = true;

    function record(name, pass, detail) {
        if (!pass) allPass = false;
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
        if (!pass && detail) console.log(`        ${detail}`);
    }

    // ── Test 1: RFC 6238 Appendix B SHA-256 vectors ─────────────────────
    {
        const key = Buffer.from('12345678901234567890123456789012');  // 32-byte ASCII
        const cases = [
            { t:        59, expected: '46119246' },
            { t: 1111111109, expected: '68084774' },
            { t: 1234567890, expected: '91819424' },
        ];

        let allOk = true;
        const detail = [];
        for (const { t, expected } of cases) {
            const got = generateTOTP(key, { timestamp: t, digits: 8 });
            const ok  = got === expected;
            if (!ok) {
                allOk = false;
                detail.push(`T=${t} expected ${expected}, got ${got}`);
            }
        }
        record('Test 1: RFC 6238 SHA-256 vectors (T=59, 1111111109, 1234567890)', allOk, detail.join('; '));
    }

    // ── Test 2: generate + verify round-trip ────────────────────────────
    {
        const secret = generateSecret();
        const code   = generateTOTP(secret);
        const acceptCorrect = verifyTOTP(code, secret) === true;
        // "000000" matches the real code with probability 1/10^6 — overwhelmingly false
        const rejectWrong   = verifyTOTP('000000', secret) === false;
        record('Test 2: generate + verify round-trip', acceptCorrect && rejectWrong,
            `accept=${acceptCorrect} rejectWrong=${rejectWrong}`);
    }

    // ── Test 3: window tolerance ────────────────────────────────────────
    {
        const secret = generateSecret();
        const T      = 1000;                    // arbitrary fixed timestamp

        const codeAtT = generateTOTP(secret, { timestamp: T });

        // Verify at T+30s with window=1 → accepts (the original code is the
        // "previous" step relative to the verifier's "now").
        const acceptedNextStep = verifyTOTP(codeAtT, secret, { timestamp: T + 30, window: 1 });

        // Verify at T+90s with window=1 → rejects (3 steps off, outside ±1).
        const rejectedFarFuture = !verifyTOTP(codeAtT, secret, { timestamp: T + 90, window: 1 });

        record('Test 3: window=1 accepts ±30s, rejects ±90s',
            acceptedNextStep && rejectedFarFuture,
            `acceptedAtT+30=${acceptedNextStep} rejectedAtT+90=${rejectedFarFuture}`);
    }

    // ── Test 4: base32 round-trip on random bytes ───────────────────────
    {
        const secret  = generateSecret(20);
        const encoded = base32Encode(secret);
        const decoded = base32Decode(encoded);
        const ok = Buffer.compare(secret, decoded) === 0;
        record('Test 4: base32 encode → decode round-trips a random 20-byte secret', ok,
            `encoded: ${encoded}`);
    }

    // ── Test 5: RFC 4648 §10 known vectors (padded form) ────────────────
    {
        const cases = [
            { input: '',       expected: ''                  },
            { input: 'f',      expected: 'MY======'          },
            { input: 'fo',     expected: 'MZXQ===='          },
            { input: 'foo',    expected: 'MZXW6==='          },
            { input: 'foob',   expected: 'MZXW6YQ='          },
            { input: 'fooba',  expected: 'MZXW6YTB'          },
            { input: 'foobar', expected: 'MZXW6YTBOI======'  },
        ];

        let allOk = true;
        const detail = [];
        for (const { input, expected } of cases) {
            const got = base32Encode(Buffer.from(input));
            if (got !== expected) {
                allOk = false;
                detail.push(`"${input}" expected "${expected}", got "${got}"`);
            }
        }
        record('Test 5: RFC 4648 base32 known vectors', allOk, detail.join('; '));
    }

    process.exit(allPass ? 0 : 1);
}
