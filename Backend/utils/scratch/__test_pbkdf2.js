'use strict';

/*
 * Round-trip test: scratch pbkdf2() vs Node's crypto.pbkdf2Sync.
 *
 * 50 iterations, each with:
 *   - random password length in [4, 20] bytes  (typical user-password range)
 *   - random salt length in [8, 32] bytes      (covers common deployments)
 *   - iteration count chosen from {1000, 5000} (realistic but bounded)
 *   - keyLength chosen from {16, 32, 48} bytes (1, 2, and 1.5 output blocks)
 *
 * Why only 50 iterations: each PBKDF2 call is intentionally slow. With an
 * average of ~3,000 iterations and ~1.5 output blocks per call, 50 calls
 * is roughly 225,000 HMAC invocations against the scratch implementation
 * plus the same against Node's, which already takes a few seconds. Going
 * to 100 would add nothing meaningful and double the runtime.
 *
 * The keyLength choices are deliberately diverse: 16 = exactly half a block
 * (exercises the truncation path), 32 = exactly one block (exercises the
 * "no truncation" path), 48 = one and a half blocks (exercises both the
 * multi-block and truncation paths in the same call).
 *
 * On any mismatch we print every input and exit 1. On success we print
 * "50/50 PASS".
 */

const crypto       = require('crypto');
const { pbkdf2 }   = require('./pbkdf2');

const N = 50;

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomLengthInRange(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

let pass = 0;
for (let i = 0; i < N; i++) {
    const passwordLen = randomLengthInRange(4, 20);
    const saltLen     = randomLengthInRange(8, 32);
    const iterations  = pick([1000, 5000]);
    const keyLength   = pick([16, 32, 48]);

    const password = crypto.randomBytes(passwordLen);
    const salt     = crypto.randomBytes(saltLen);

    const expected = crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
    const actual   = pbkdf2(password, salt, iterations, keyLength);

    if (Buffer.compare(expected, actual) !== 0) {
        console.error(`FAIL  iteration ${i + 1}/${N}`);
        console.error(`  password (hex): ${password.toString('hex')}`);
        console.error(`  salt (hex):     ${salt.toString('hex')}`);
        console.error(`  iterations:     ${iterations}`);
        console.error(`  keyLength:      ${keyLength}`);
        console.error(`  expected (hex): ${expected.toString('hex')}`);
        console.error(`  got (hex):      ${actual.toString('hex')}`);
        process.exit(1);
    }
    pass++;
}

console.log(`${pass}/${N} PASS`);
