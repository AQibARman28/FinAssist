'use strict';

/*
 * Round-trip test: scratch AES-256-GCM vs Node's crypto.
 *
 * 100 iterations, each with:
 *   - fresh random 32-byte key
 *   - fresh random 12-byte IV
 *   - random plaintext length in [0, 500] bytes
 *   - random AAD length in [0, 100] bytes
 *
 * For each iteration we run two interop checks:
 *
 *   A. scratch ENCRYPT → Node DECRYPT
 *      Tag-correct ciphertext from our implementation must be accepted by
 *      Node's crypto and decrypt to the original plaintext.
 *
 *   B. Node ENCRYPT → scratch DECRYPT
 *      Tag-correct ciphertext from Node must be accepted by ours and
 *      decrypt to the original plaintext.
 *
 * As a bonus, we assert that scratch and Node produce byte-identical
 * (ciphertext, tag) for the same inputs. They *must* — GCM is fully
 * deterministic for a fixed (key, iv, pt, aad). If round-tripping works
 * but byte-equality fails, that's a non-determinism bug we want to catch.
 *
 * On the first failure we print every input + both outputs and exit 1.
 * On success we print "100/100 PASS".
 */

const crypto = require('crypto');
const { aes256gcmEncrypt, aes256gcmDecrypt } = require('./aes256gcm');

const N           = 100;
const MAX_PT_LEN  = 500;
const MAX_AAD_LEN = 100;

let pass = 0;
for (let i = 0; i < N; i++) {
    const key       = crypto.randomBytes(32);
    const iv        = crypto.randomBytes(12);
    const ptLen     = Math.floor(Math.random() * (MAX_PT_LEN  + 1));
    const aadLen    = Math.floor(Math.random() * (MAX_AAD_LEN + 1));
    const plaintext = crypto.randomBytes(ptLen);
    const aad       = crypto.randomBytes(aadLen);

    // ── Direction A: scratch encrypt → Node decrypt ──────────────────────
    const { ciphertext: scratchCt, tag: scratchTag } =
        aes256gcmEncrypt(key, iv, plaintext, aad);

    let nodeDecrypted;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(scratchTag);
        nodeDecrypted = Buffer.concat([decipher.update(scratchCt), decipher.final()]);
    } catch (err) {
        fail(i, 'scratch→Node rejected by Node', {
            key, iv, plaintext, aad,
            scratchCt, scratchTag,
            error: err.message
        });
    }

    if (Buffer.compare(nodeDecrypted, plaintext) !== 0) {
        fail(i, 'scratch→Node round-trip plaintext mismatch', {
            key, iv, plaintext, aad,
            scratchCt, scratchTag,
            nodeDecrypted
        });
    }

    // ── Direction B: Node encrypt → scratch decrypt ──────────────────────
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const nodeCt  = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const nodeTag = cipher.getAuthTag();

    let scratchDecrypted;
    try {
        scratchDecrypted = aes256gcmDecrypt(key, iv, nodeCt, nodeTag, aad);
    } catch (err) {
        fail(i, 'Node→scratch rejected by scratch', {
            key, iv, plaintext, aad,
            nodeCt, nodeTag,
            error: err.message
        });
    }

    if (Buffer.compare(scratchDecrypted, plaintext) !== 0) {
        fail(i, 'Node→scratch round-trip plaintext mismatch', {
            key, iv, plaintext, aad,
            nodeCt, nodeTag,
            scratchDecrypted
        });
    }

    // ── Determinism: byte-identical outputs for the same inputs ──────────
    if (Buffer.compare(scratchCt, nodeCt) !== 0 ||
        Buffer.compare(scratchTag, nodeTag) !== 0) {
        fail(i, 'scratch and Node produced different (ciphertext, tag)', {
            key, iv, plaintext, aad,
            scratchCt, scratchTag,
            nodeCt, nodeTag
        });
    }

    pass++;
}

console.log(`${pass}/${N} PASS`);


function fail(iter, reason, details) {
    console.error(`FAIL  iteration ${iter + 1}/${N}: ${reason}`);
    for (const [k, v] of Object.entries(details)) {
        const shown = Buffer.isBuffer(v) ? v.toString('hex') : v;
        console.error(`  ${k}: ${shown}`);
    }
    process.exit(1);
}
