'use strict';

/*
 * Round-trip test: scratch ECDSA P-256 vs Node's crypto module.
 *
 * Strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Generate ONE EC keypair via Node's crypto, then mirror it as scratch
 * BigInts via JWK extraction. JWK gives base64url-encoded big-endian byte
 * representations of x, y (public point) and d (private scalar) — exactly
 * what bigIntFromBuffer wants.
 *
 * For 20 iterations, run two directions:
 *
 *   A. scratch SIGN → Node VERIFY
 *      Node's crypto.createVerify('SHA256').verify(publicKey, derSig) must
 *      accept our DER-encoded signature.
 *
 *   B. Node SIGN → scratch VERIFY
 *      crypto.createSign('SHA256').sign(privateKey) returns a DER-encoded
 *      ECDSA signature. Our verifyECDSADER must accept it.
 *
 * Each iteration uses a fresh random message (length 1–100 bytes). On any
 * failure we print all inputs in hex and exit 1.
 *
 * If JWK extraction throws (very old Node), we fall back to scratch
 * self-consistency over 20 iterations and label the output accordingly.
 */

const crypto = require('crypto');
const {
    bigIntFromBuffer,
    generateECCKeyPair,
    signECDSADER,
    verifyECDSADER
} = require('./ecdsaP256');

const N = 20;


// ─────────────────────────────────────────────────────────────────────────────
// Setup: generate one keypair, mirror it across both implementations
// ─────────────────────────────────────────────────────────────────────────────

function b64urlToBuffer(s) {
    const standard = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded   = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
}

function b64urlToBigInt(s) {
    return bigIntFromBuffer(b64urlToBuffer(s));
}

console.log('generating Node EC keypair (prime256v1)...');
const t0 = Date.now();

let nodePublicKey, nodePrivateKey;
let scratchPub, scratchPriv;
let interopMode = false;

try {
    const pair      = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    nodePublicKey   = pair.publicKey;
    nodePrivateKey  = pair.privateKey;

    const privJwk   = nodePrivateKey.export({ format: 'jwk' });
    // privJwk has { kty: 'EC', crv: 'P-256', x, y, d } — all base64url
    scratchPub      = { x: b64urlToBigInt(privJwk.x), y: b64urlToBigInt(privJwk.y) };
    scratchPriv     = b64urlToBigInt(privJwk.d);

    interopMode = true;
    console.log(`Node EC key generated + JWK extracted in ${Date.now() - t0}ms`);
} catch (err) {
    console.log(`JWK extraction failed (${err.message}) — falling back to scratch self-consistency`);
    const k = generateECCKeyPair();
    scratchPub  = k.Q;
    scratchPriv = k.d;
    console.log(`scratch keypair generated in ${Date.now() - t0}ms`);
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
    const msgLen  = 1 + Math.floor(Math.random() * 100);
    const message = crypto.randomBytes(msgLen);

    if (interopMode) {
        // ── Direction A: scratch sign → Node verify ─────────────────────
        const scratchSig = signECDSADER(message, scratchPriv);
        const nodeOk = crypto.createVerify('SHA256')
            .update(message)
            .verify(nodePublicKey, scratchSig);

        if (!nodeOk) {
            fail(i, 'A: Node rejected scratch-signed DER signature', {
                msgLen, message, scratchSig
            });
        }

        // ── Direction B: Node sign → scratch verify ─────────────────────
        const nodeSigDer = crypto.createSign('SHA256')
            .update(message)
            .sign(nodePrivateKey);

        const scratchOk = verifyECDSADER(message, nodeSigDer, scratchPub);
        if (!scratchOk) {
            fail(i, 'B: scratch rejected Node-signed DER signature', {
                msgLen, message, nodeSigDer
            });
        }
    } else {
        // ── Fallback: scratch self-consistency ──────────────────────────
        const sig = signECDSADER(message, scratchPriv);
        const ok  = verifyECDSADER(message, sig, scratchPub);
        if (!ok) {
            fail(i, 'self-consistency round-trip failed', { msgLen, message, sig });
        }
    }

    pass++;
}

const suffix = interopMode ? '' : ' (self-consistency only — JWK interop unavailable)';
console.log(`${pass}/${N} PASS${suffix}`);
