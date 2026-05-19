'use strict';

/*
 * Round-trip test: scratch TOTP (SHA-256) vs the otplib library (SHA-256 mode).
 *
 * 50 iterations. Each iteration:
 *   - random 20-byte secret
 *   - random timestamp in the next 10 years (covers a wide range of counters)
 *
 * Two directions are exercised:
 *
 *   A. scratch GENERATE → library VERIFY
 *      The library must accept our token and report valid=true at the
 *      same timestamp.
 *
 *   B. library GENERATE → scratch VERIFY
 *      We must accept the library's token at the same timestamp.
 *
 * Note on the otplib v13 API
 * ─────────────────────────────────────────────────────────────────────────────
 *   - The library exports `generateSync` / `verifySync` as top-level functions
 *     (not `authenticator.generate` / `authenticator.check` like older docs
 *     describe).
 *   - The secret format is base32; we encode our random 20 bytes via the
 *     library's own ScureBase32Plugin so there's no encoder mismatch.
 *   - `period` (not `step`) is the option name.
 *   - `epoch` is in SECONDS — not milliseconds, despite what some docs say.
 *   - verifySync returns { valid: bool, ... }; we check `.valid`.
 *
 * If otplib isn't available the test falls back to scratch self-consistency
 * (generate at T, verify at T → must accept; verify at T+90 → must reject).
 */

const crypto = require('crypto');
const { generateTOTP, verifyTOTP } = require('./totp');

let otplib    = null;
let b32Plugin = null;
try {
    otplib    = require('otplib');
    b32Plugin = new otplib.ScureBase32Plugin();
} catch { /* not installed */ }

const N = 50;

function randomFutureTimestamp() {
    const now = Math.floor(Date.now() / 1000);
    const tenYears = 10 * 365 * 24 * 3600;
    return now + Math.floor(Math.random() * tenYears);
}

function fail(iter, reason, details) {
    console.error(`FAIL  iteration ${iter + 1}/${N}: ${reason}`);
    for (const [k, v] of Object.entries(details)) {
        const shown = Buffer.isBuffer(v) ? v.toString('hex') : v;
        console.error(`  ${k}: ${shown}`);
    }
    process.exit(1);
}

let pass = 0;

if (!otplib) {
    // ── Fallback: scratch self-consistency only ─────────────────────────
    console.log('library not installed — using self-consistency only');
    for (let i = 0; i < N; i++) {
        const secret    = crypto.randomBytes(20);
        const timestamp = randomFutureTimestamp();

        const code = generateTOTP(secret, { timestamp });

        // Verify at exactly the generation time → must accept
        if (!verifyTOTP(code, secret, { timestamp, window: 0 })) {
            fail(i, 'scratch self-consistency: same-time verify rejected', { secret, timestamp, code });
        }

        // Verify 90 seconds later with window=1 → must reject (3 steps off)
        if (verifyTOTP(code, secret, { timestamp: timestamp + 90, window: 1 })) {
            fail(i, 'scratch self-consistency: stale code accepted at +90s', { secret, timestamp, code });
        }
        pass++;
    }
} else {
    // ── Full library interop, both directions ───────────────────────────
    for (let i = 0; i < N; i++) {
        const secretBuf = crypto.randomBytes(20);
        const secretB32 = b32Plugin.encode(secretBuf);
        const timestamp = randomFutureTimestamp();

        // A. scratch generate → otplib verify
        const scratchToken = generateTOTP(secretBuf, { timestamp });
        const libVerify = otplib.verifySync({
            token:     scratchToken,
            secret:    secretB32,
            algorithm: 'sha256',
            period:    30,
            digits:    6,
            epoch:     timestamp
        });
        if (!libVerify.valid) {
            fail(i, 'A: otplib rejected scratch-generated token', {
                secretBuf, secretB32, timestamp, scratchToken, libResult: JSON.stringify(libVerify)
            });
        }

        // B. otplib generate → scratch verify
        const libToken = otplib.generateSync({
            secret:    secretB32,
            algorithm: 'sha256',
            period:    30,
            digits:    6,
            epoch:     timestamp
        });
        const scratchAccepts = verifyTOTP(libToken, secretBuf, { timestamp, window: 0 });
        if (!scratchAccepts) {
            // Also confirm the two libraries even agree on the same code at
            // the same timestamp — useful diagnostic if things diverge.
            const scratchToken2 = generateTOTP(secretBuf, { timestamp });
            fail(i, 'B: scratch rejected otplib-generated token', {
                secretBuf, secretB32, timestamp,
                libToken, scratchTokenForSameInputs: scratchToken2
            });
        }

        pass++;
    }
}

console.log(`${pass}/${N} PASS`);
