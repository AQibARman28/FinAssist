'use strict';

/*
 * Round-trip test: scratch TOTP (SHA-256) vs the speakeasy library
 * (SHA-256 mode) — the TOTP library FinAssist's production code uses
 * (Backend/utils/nativeCrypto.js).
 *
 * 50 iterations. Each iteration:
 *   - random 20-byte secret, base32-encoded with the SCRATCH encoder and
 *     handed to speakeasy as `encoding: 'base32'` (production's setting),
 *     so the two base32 implementations are cross-checked as well
 *   - random timestamp in the next 10 years (covers a wide range of counters)
 *
 * Two directions are exercised:
 *
 *   A. scratch GENERATE → library VERIFY
 *      speakeasy.totp.verify must accept our token at the same timestamp.
 *
 *   B. library GENERATE → scratch VERIFY
 *      We must accept speakeasy's token at the same timestamp.
 *
 * Note on the speakeasy 2.x API
 * ─────────────────────────────────────────────────────────────────────────────
 *   - `algorithm` defaults to 'sha1'; we pass 'sha256' explicitly.
 *   - `time` is in SECONDS; `step` (not `period`) is the step size.
 *   - speakeasy.totp.verify returns a boolean.
 *
 * If speakeasy isn't available the test falls back to scratch
 * self-consistency (generate at T, verify at T → must accept; verify at
 * T+90 → must reject).
 */

const crypto = require('crypto');
const { generateTOTP, verifyTOTP, base32Encode } = require('./totp');

let speakeasy = null;
try { speakeasy = require('speakeasy'); } catch { /* not installed */ }

const N = 50;
const LIB_OPTS = Object.freeze({ encoding: 'base32', algorithm: 'sha256', step: 30, digits: 6 });

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

if (!speakeasy) {
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
        const secretB32 = base32Encode(secretBuf);
        const timestamp = randomFutureTimestamp();

        // A. scratch generate → speakeasy verify
        const scratchToken = generateTOTP(secretBuf, { timestamp });
        const libAccepts = speakeasy.totp.verify({
            ...LIB_OPTS, secret: secretB32, token: scratchToken, time: timestamp, window: 0
        });
        if (libAccepts !== true) {
            fail(i, 'A: speakeasy rejected scratch-generated token', {
                secretBuf, secretB32, timestamp, scratchToken
            });
        }

        // B. speakeasy generate → scratch verify
        const libToken = speakeasy.totp({ ...LIB_OPTS, secret: secretB32, time: timestamp });
        const scratchAccepts = verifyTOTP(libToken, secretBuf, { timestamp, window: 0 });
        if (!scratchAccepts) {
            // Also report what scratch generates for the same inputs —
            // useful diagnostic if the implementations diverge.
            fail(i, 'B: scratch rejected speakeasy-generated token', {
                secretBuf, secretB32, timestamp,
                libToken, scratchTokenForSameInputs: generateTOTP(secretBuf, { timestamp })
            });
        }

        pass++;
    }
}

console.log(`${pass}/${N} PASS${speakeasy ? ' (vs speakeasy)' : ''}`);
