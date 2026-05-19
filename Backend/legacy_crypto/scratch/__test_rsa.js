'use strict';

/*
 * Round-trip test: scratch RSA-OAEP-SHA256 vs Node's crypto module.
 *
 * Strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * RSA key generation is the slow step (in scratch *or* in Node — Node is
 * just much faster). To avoid re-paying that cost N times we:
 *
 *   1. Generate ONE 2048-bit keypair using Node's crypto (~30 ms).
 *   2. Export both keys to JWK format. JWK gives us base64url-encoded
 *      big-endian byte representations of n, e, d directly — exactly the
 *      raw form our scratch implementation wants. We decode each into a
 *      BigInt via our own bigIntFromBuffer.
 *   3. Use the resulting BigInts to drive the scratch encrypt/decrypt
 *      against the same key the Node-key-objects represent.
 *
 * Then for 10 iterations we run two directions:
 *
 *   A. scratch ENCRYPT → Node DECRYPT
 *      Node's crypto.privateDecrypt with oaepHash='sha256' must accept
 *      our ciphertext and recover the original plaintext.
 *
 *   B. Node ENCRYPT → scratch DECRYPT
 *      crypto.publicEncrypt with oaepHash='sha256' produces a ciphertext
 *      that our rsaDecryptOAEP must accept and decode back to the
 *      original plaintext.
 *
 * Each iteration uses a fresh random message length in [0, 190] bytes
 * (the RSA-2048 OAEP-SHA256 maximum) and fresh random message contents.
 *
 * If JWK extraction throws (very old Node versions), we fall back to a
 * scratch-only self-consistency test over 10 iterations using a
 * scratch-generated keypair.
 */

const crypto = require('crypto');
const {
    bigIntFromBuffer,
    generateRSAKeyPair,
    rsaEncryptOAEP,
    rsaDecryptOAEP
} = require('./rsa');

const N           = 10;
const MAX_MSG_LEN = 190;       // 256 - 2*32 - 2 for RSA-2048 + OAEP-SHA256


// ─────────────────────────────────────────────────────────────────────────────
// Setup: generate one keypair via Node, mirror it as scratch BigInts via JWK
// ─────────────────────────────────────────────────────────────────────────────

function b64urlToBuffer(s) {
    // Restore standard alphabet, pad to multiple of 4, decode
    const standard = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded   = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
}

function b64urlToBigInt(s) {
    return bigIntFromBuffer(b64urlToBuffer(s));
}

console.log('generating Node RSA-2048 keypair...');
const t0 = Date.now();

let nodePublicKey, nodePrivateKey;
let scratchPub, scratchPriv;
let interopMode = false;

try {
    const pair      = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    nodePublicKey   = pair.publicKey;
    nodePrivateKey  = pair.privateKey;

    const pubJwk    = nodePublicKey.export({  format: 'jwk' });
    const privJwk   = nodePrivateKey.export({ format: 'jwk' });

    scratchPub  = { n: b64urlToBigInt(privJwk.n), e: b64urlToBigInt(privJwk.e) };
    scratchPriv = { n: b64urlToBigInt(privJwk.n), d: b64urlToBigInt(privJwk.d) };

    interopMode = true;
    console.log(`Node key generated + JWK extracted in ${Date.now() - t0}ms`);
} catch (err) {
    console.log(`JWK extraction failed (${err.message}) — falling back to scratch self-consistency`);
    console.log('generating scratch RSA-2048 keypair (this may take a few seconds)...');
    const k = generateRSAKeyPair(2048);
    scratchPub  = { n: k.n, e: k.e };
    scratchPriv = { n: k.n, d: k.d };
    console.log(`scratch key generated in ${Date.now() - t0}ms`);
}


// ─────────────────────────────────────────────────────────────────────────────
// Round-trip loop
// ─────────────────────────────────────────────────────────────────────────────

function fail(iter, reason, details) {
    console.error(`FAIL  iteration ${iter + 1}/${N}: ${reason}`);
    for (const [k, v] of Object.entries(details)) {
        const shown = Buffer.isBuffer(v) ? v.toString('hex') : v;
        console.error(`  ${k}: ${shown}`);
    }
    process.exit(1);
}

let pass = 0;
for (let i = 0; i < N; i++) {
    const msgLen  = Math.floor(Math.random() * (MAX_MSG_LEN + 1));
    const message = crypto.randomBytes(msgLen);

    if (interopMode) {
        // ── Direction A: scratch encrypt → Node decrypt ─────────────────
        const scratchCt = rsaEncryptOAEP(message, scratchPub);

        let nodeDecrypted;
        try {
            nodeDecrypted = crypto.privateDecrypt({
                key:      nodePrivateKey,
                oaepHash: 'sha256',
                padding:  crypto.constants.RSA_PKCS1_OAEP_PADDING
            }, scratchCt);
        } catch (err) {
            fail(i, 'A: Node rejected scratch ciphertext', {
                msgLen, message, scratchCt, error: err.message
            });
        }
        if (Buffer.compare(nodeDecrypted, message) !== 0) {
            fail(i, 'A: scratch→Node round-trip plaintext mismatch', {
                msgLen, message, nodeDecrypted
            });
        }

        // ── Direction B: Node encrypt → scratch decrypt ─────────────────
        const nodeCt = crypto.publicEncrypt({
            key:      nodePublicKey,
            oaepHash: 'sha256',
            padding:  crypto.constants.RSA_PKCS1_OAEP_PADDING
        }, message);

        let scratchDecrypted;
        try {
            scratchDecrypted = rsaDecryptOAEP(nodeCt, scratchPriv);
        } catch (err) {
            fail(i, 'B: scratch rejected Node ciphertext', {
                msgLen, message, nodeCt, error: err.message
            });
        }
        if (Buffer.compare(scratchDecrypted, message) !== 0) {
            fail(i, 'B: Node→scratch round-trip plaintext mismatch', {
                msgLen, message, scratchDecrypted
            });
        }
    } else {
        // ── Fallback: scratch encrypt → scratch decrypt ─────────────────
        const ct = rsaEncryptOAEP(message, scratchPub);
        const pt = rsaDecryptOAEP(ct, scratchPriv);
        if (Buffer.compare(pt, message) !== 0) {
            fail(i, 'self-consistency round-trip plaintext mismatch', {
                msgLen, message, pt
            });
        }
    }

    pass++;
}

const suffix = interopMode ? '' : ' (self-consistency only — JWK interop unavailable)';
console.log(`${pass}/${N} PASS${suffix}`);
