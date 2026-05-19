'use strict';

/*
 * Round-trip test: scratch JWT (HS256) vs the jsonwebtoken library.
 *
 * 100 iterations. Each iteration:
 *   - random secret (alphanumeric string of random length)
 *   - random payload (1..5 keys from a safe pool, with random
 *                     string/number/boolean/null values)
 *
 * Two directions are exercised:
 *
 *   A. scratch SIGN → library VERIFY
 *      The library must accept our token and reconstruct the payload
 *      byte-for-byte (key set + every value).
 *
 *   B. library SIGN → scratch VERIFY
 *      We must accept the library's token and reconstruct the payload
 *      identically. We sign with `noTimestamp: true` so the library
 *      doesn't auto-add an `iat` field, which would make the round-trip
 *      payload-comparison spuriously fail.
 *
 * If jsonwebtoken isn't installed (e.g., we're in a fresh checkout), the
 * test falls back to scratch sign + scratch verify and asserts payload
 * round-tripping against itself for 100 iterations. That's strictly weaker
 * than library interop but still catches a lot — including any base64url
 * round-tripping bug.
 *
 * Why the payload key pool is restricted
 * ─────────────────────────────────────────────────────────────────────────────
 * If we let random key names include strings like "exp" or "nbf", the
 * library's verify path interprets them as JWT timestamp claims and may
 * reject the token as expired (since a random small integer is always in
 * the distant past). We avoid that by drawing keys from a fixed safe pool
 * that doesn't collide with reserved JWT claim names.
 */

const { jwtSign, jwtVerify } = require('./jwtScratch');

// Optional dependency — fall back to self-consistency if absent.
let jsonwebtoken = null;
try { jsonwebtoken = require('jsonwebtoken'); } catch { /* not installed */ }

const N = 100;
const SAFE_KEYS = ['userId', 'role', 'org', 'team', 'level', 'city', 'lang', 'tier', 'plan', 'group'];
const ALPHANUM  = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomString(minLen, maxLen) {
    const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
    return s;
}

function randomValue() {
    const r = Math.random();
    if (r < 0.40) return randomString(1, 16);
    if (r < 0.70) return Math.floor(Math.random() * 10000);
    if (r < 0.90) return Math.random() > 0.5;
    return null;
}

function randomPayload() {
    const numKeys = 1 + Math.floor(Math.random() * 5);
    const keys    = new Set();
    while (keys.size < numKeys) keys.add(SAFE_KEYS[Math.floor(Math.random() * SAFE_KEYS.length)]);

    const obj = {};
    for (const k of keys) obj[k] = randomValue();
    return obj;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object') return false;

    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return false;
        if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
}

function fail(iter, reason, details) {
    console.error(`FAIL  iteration ${iter + 1}/${N}: ${reason}`);
    for (const [k, v] of Object.entries(details)) {
        const shown = typeof v === 'string' ? v : JSON.stringify(v);
        console.error(`  ${k}: ${shown}`);
    }
    process.exit(1);
}

let pass = 0;

if (!jsonwebtoken) {
    // ── Fallback: scratch sign + scratch verify only ────────────────────
    console.log('library not installed — using self-consistency only');
    for (let i = 0; i < N; i++) {
        const secret  = randomString(8, 32);
        const payload = randomPayload();

        const token   = jwtSign(payload, secret);
        const decoded = jwtVerify(token, secret);

        if (!deepEqual(payload, decoded)) {
            fail(i, 'self-consistency mismatch', { secret, payload, decoded, token });
        }
        pass++;
    }
} else {
    // ── Full library interop, both directions ───────────────────────────
    for (let i = 0; i < N; i++) {
        const secret  = randomString(8, 32);
        const payload = randomPayload();

        // A. scratch sign → library verify
        const scratchToken = jwtSign(payload, secret);
        let libDecoded;
        try {
            libDecoded = jsonwebtoken.verify(scratchToken, secret, { algorithms: ['HS256'] });
        } catch (err) {
            fail(i, 'A: library rejected scratch-signed token', {
                secret, payload, scratchToken, error: err.message
            });
        }
        if (!deepEqual(payload, libDecoded)) {
            fail(i, 'A: payload mismatch after scratch→library', {
                secret, payload, libDecoded, scratchToken
            });
        }

        // B. library sign → scratch verify
        const libToken = jsonwebtoken.sign(payload, secret, {
            algorithm:   'HS256',
            noTimestamp: true       // suppress the library's auto-added `iat`
        });
        let scratchDecoded;
        try {
            scratchDecoded = jwtVerify(libToken, secret);
        } catch (err) {
            fail(i, 'B: scratch rejected library-signed token', {
                secret, payload, libToken, error: err.message
            });
        }
        if (!deepEqual(payload, scratchDecoded)) {
            fail(i, 'B: payload mismatch after library→scratch', {
                secret, payload, scratchDecoded, libToken
            });
        }

        pass++;
    }
}

console.log(`${pass}/${N} PASS`);
