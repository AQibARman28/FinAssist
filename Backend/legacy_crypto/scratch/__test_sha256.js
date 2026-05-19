'use strict';

/*
 * Round-trip test: scratch sha256() vs Node's crypto.createHash('sha256').
 *
 * We pick 100 random byte strings of random lengths in [0, 1000] bytes and
 * verify that the from-scratch implementation produces a byte-identical
 * digest to Node's reference implementation. On the first mismatch we print
 * the offending input, the expected digest, and the actual digest, then exit
 * non-zero so this is usable in CI.
 *
 * Entropy comes from crypto.randomBytes — this is permitted; the constraint
 * is only that the *algorithm* is hand-rolled.
 */

const crypto       = require('crypto');
const { sha256 }   = require('./sha256');

const N       = 100;
const MAX_LEN = 1000;

let pass = 0;
for (let i = 0; i < N; i++) {
    // Random length in [0, 1000] inclusive.
    const len   = Math.floor(Math.random() * (MAX_LEN + 1));
    const input = crypto.randomBytes(len);

    const expected = crypto.createHash('sha256').update(input).digest();
    const actual   = sha256(input);

    if (Buffer.compare(expected, actual) !== 0) {
        console.error(`FAIL  iteration ${i + 1}/${N}, input length ${len}`);
        console.error(`  input (hex):    ${input.toString('hex')}`);
        console.error(`  expected (hex): ${expected.toString('hex')}`);
        console.error(`  got (hex):      ${actual.toString('hex')}`);
        process.exit(1);
    }
    pass++;
}

console.log(`${pass}/${N} PASS`);
