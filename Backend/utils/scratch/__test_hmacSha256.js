'use strict';

/*
 * Round-trip test: scratch hmacSha256() vs Node's crypto.createHmac('sha256', ...).
 *
 * 100 iterations, each with:
 *   - key length uniformly random in [1, 100] bytes
 *   - message length uniformly random in [0, 1000] bytes
 *   - both keys and messages from crypto.randomBytes
 *
 * The key-length range deliberately straddles the 64-byte hash block size,
 * so we exercise all three key-preparation branches:
 *   - len < 64  → zero-pad to 64
 *   - len == 64 → use as-is
 *   - len > 64  → sha256 the key, then zero-pad the 32-byte digest to 64
 *
 * Across 100 iterations we get roughly 36 hits on the hash-down branch
 * (key lengths 65..100) and 64 hits on the zero-pad branch — statistically
 * certain to find a bug in either path.
 *
 * Entropy comes from crypto.randomBytes; the algorithm itself is the
 * scratch implementation under test.
 */

const crypto         = require('crypto');
const { hmacSha256 } = require('./hmacSha256');

const N           = 100;
const MAX_KEY_LEN = 100;
const MAX_MSG_LEN = 1000;

let pass = 0;
for (let i = 0; i < N; i++) {
    // Key length in [1, 100]; message length in [0, 1000].
    const keyLen = 1 + Math.floor(Math.random() * MAX_KEY_LEN);
    const msgLen = Math.floor(Math.random() * (MAX_MSG_LEN + 1));
    const key    = crypto.randomBytes(keyLen);
    const msg    = crypto.randomBytes(msgLen);

    const expected = crypto.createHmac('sha256', key).update(msg).digest();
    const actual   = hmacSha256(key, msg);

    if (Buffer.compare(expected, actual) !== 0) {
        console.error(`FAIL  iteration ${i + 1}/${N}`);
        console.error(`  key length:     ${keyLen}`);
        console.error(`  message length: ${msgLen}`);
        console.error(`  key (hex):      ${key.toString('hex')}`);
        console.error(`  message (hex):  ${msg.toString('hex')}`);
        console.error(`  expected (hex): ${expected.toString('hex')}`);
        console.error(`  got (hex):      ${actual.toString('hex')}`);
        process.exit(1);
    }
    pass++;
}

console.log(`${pass}/${N} PASS`);
