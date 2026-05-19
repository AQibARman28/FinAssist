'use strict';

/*
 * JWT (JSON Web Token) signing and verification with HS256, from scratch.
 *
 * The three-part anatomy of a JWT
 * ─────────────────────────────────────────────────────────────────────────────
 * A JWT is just a string with two dots in it:
 *
 *   <base64url(headerJSON)>.<base64url(payloadJSON)>.<base64url(signature)>
 *
 *   - The header is a tiny JSON object naming the signature algorithm and
 *     declaring the type, e.g. {"alg":"HS256","typ":"JWT"}.
 *   - The payload is whatever JSON object the issuer wants to vouch for —
 *     conventionally including `iat` (issued-at), `exp` (expiry), and a few
 *     standard "claims" defined in RFC 7519.
 *   - The signature is bytes computed by the issuer over the header+payload.
 *
 * Header and payload are NOT encrypted. They are base64url-encoded JSON,
 * plainly readable by anyone who can copy-paste the token into jwt.io. Do
 * not put secrets inside a JWT payload — put them server-side and reference
 * them by id. The signature is what proves the token was issued by someone
 * who held the secret; without it, the token is a free-form claim that
 * anyone could have manufactured.
 *
 * HS256 specifically
 * ─────────────────────────────────────────────────────────────────────────────
 * "HS256" means HMAC-SHA256 over the *ASCII bytes* of the string
 *
 *     "<base64url(header)>.<base64url(payload)>"
 *
 * — that is, the literal first two parts of the token, joined by a dot,
 * read as text. The signature is NOT computed over the raw JSON bytes or
 * over the raw header/payload buffers; it's over the dotted base64url
 * string. Getting that detail wrong is the easiest way to produce a JWT
 * implementation that round-trips with itself but fails to verify
 * library-issued tokens.
 *
 * The alg=none attack — and what we do about it
 * ─────────────────────────────────────────────────────────────────────────────
 * The original JWT spec optionally allowed an "alg":"none" header, meaning
 * "no signature, the token is unsigned". Several early libraries
 * implemented verify() by reading the alg field from the header and
 * dispatching to the matching verifier — including the "none" verifier,
 * which simply returned true.
 *
 * The exploit: an attacker took any token they had captured, swapped the
 * header for {"alg":"none","typ":"JWT"}, dropped the signature segment to
 * an empty string, and submitted it. Naïve verifiers accepted it. The
 * stolen token now had whatever payload the attacker wanted — privilege
 * escalation in one HTTP request.
 *
 * The fix is structural: jwtVerify never trusts the header's `alg` field as
 * a signal of which algorithm to use. We hard-require alg === "HS256"; any
 * other value (including "none") is rejected outright before signature
 * work begins. This single check defeats both the alg=none attack and the
 * related "algorithm confusion" attack (where an attacker swaps an
 * RS256-issued token's header to HS256 and uses the public key as the HMAC
 * secret).
 *
 * Constant-time signature comparison
 * ─────────────────────────────────────────────────────────────────────────────
 * Identical reasoning to the GCM tag check and the PBKDF2 stored-hash
 * compare: if signature comparison short-circuits on the first byte
 * mismatch, an attacker can use response timing to learn how many leading
 * bytes of their forged signature were correct, and reconstruct the real
 * signature one byte at a time. We walk every byte unconditionally and
 * combine the differences with bitwise OR.
 *
 * Allowed dependencies
 * ─────────────────────────────────────────────────────────────────────────────
 * The only require() is `./hmacSha256`. No JWT libraries; no `crypto.*`
 * cipher or hash calls. Buffer's built-in base64 encoding is used as a
 * byte-utility primitive (same status as utf8 or hex) — that is not the
 * algorithm.
 */

const { hmacSha256 } = require('./hmacSha256');


// ─────────────────────────────────────────────────────────────────────────────
// base64url helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode bytes (or a UTF-8 string) as base64url.
 *
 * base64url is just standard base64 with three changes that make the result
 * URL- and form-safe (no characters that need percent-encoding):
 *   '+'  →  '-'
 *   '/'  →  '_'
 *   trailing '=' padding stripped
 *
 * The padding stripping is allowed because the original byte length can
 * always be recovered from the base64url length mod 4.
 */
function base64urlEncode(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    return buf.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/,  '');
}

/**
 * Decode a base64url string back to a Buffer.
 *
 * Reverse of base64urlEncode: restore the standard '+' and '/' alphabet,
 * pad the length back to a multiple of 4 with '=', then run a normal
 * base64 decode.
 *
 * Note: Node's base64 decoder is *lenient* — it silently ignores bytes
 * that aren't in the base64 alphabet rather than throwing. Our caller
 * (jwtVerify) catches malformed input downstream when the result fails to
 * parse as JSON or fails the signature compare.
 */
function base64urlDecode(input) {
    if (typeof input !== 'string') {
        throw new TypeError('base64urlDecode: input must be a string');
    }
    // Restore standard alphabet
    const standard = input.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' to a multiple of 4. (4 - n % 4) % 4 handles n % 4 == 0
    // gracefully: it gives 0, not 4.
    const padding  = '='.repeat((4 - (standard.length % 4)) % 4);
    return Buffer.from(standard + padding, 'base64');
}


// ─────────────────────────────────────────────────────────────────────────────
// expiresIn parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an `expiresIn` option value into seconds.
 *
 * Accepted shapes:
 *   - number               — taken as a literal seconds count (negative
 *                            allowed, useful for tests that need an
 *                            already-expired token)
 *   - string "<n>s"        — n seconds
 *   - string "<n>m"        — n minutes
 *   - string "<n>h"        — n hours
 *   - string "<n>d"        — n days
 *
 * Anything else throws. We deliberately do NOT support fractional values
 * like "1.5h" — keeps the parser simple and matches typical usage.
 */
function parseExpiresIn(input) {
    if (typeof input === 'number') {
        if (!Number.isFinite(input)) {
            throw new Error('expiresIn: numeric value must be finite');
        }
        return Math.floor(input);
    }
    if (typeof input !== 'string') {
        throw new TypeError('expiresIn: must be a number (seconds) or a string like "30d"');
    }

    const match = /^(-?\d+)([smhd])$/.exec(input);
    if (!match) {
        throw new Error(`expiresIn: invalid format "${input}" (expected e.g. "60s", "15m", "1h", "30d")`);
    }
    const n    = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * multipliers[unit];
}


// ─────────────────────────────────────────────────────────────────────────────
// Constant-time byte comparison
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constant-time byte comparison.
 *
 * Returns true iff `a` and `b` are byte-identical. Walks every byte of the
 * inputs unconditionally so the comparison time depends only on length,
 * not on contents — defeats timing-based byte-by-byte signature recovery.
 */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// Sign and verify
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign a JWT with HS256.
 *
 * @param {object}        payload  — claims object; will be JSON-encoded
 * @param {string|Buffer} secret   — shared HMAC secret
 * @param {object}        [options]
 * @param {number|string} [options.expiresIn] — when set, adds `iat` (now)
 *        and `exp` (= iat + parsed seconds) to the payload before signing
 * @returns {string} compact-form JWT
 */
function jwtSign(payload, secret, options = {}) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new TypeError('jwtSign: payload must be a plain object');
    }

    // Copy the payload so we don't mutate the caller's object when we
    // splice in iat/exp below.
    const claims = { ...payload };

    if (options.expiresIn !== undefined) {
        const expiresInSec = parseExpiresIn(options.expiresIn);
        const now          = Math.floor(Date.now() / 1000);
        claims.iat = now;
        claims.exp = now + expiresInSec;
    }

    const header = { alg: 'HS256', typ: 'JWT' };

    const headerB64  = base64urlEncode(JSON.stringify(header));
    const payloadB64 = base64urlEncode(JSON.stringify(claims));

    // The thing we sign is the *string* "<headerB64>.<payloadB64>" interpreted
    // as ASCII bytes — not the raw JSON, not the decoded buffers.
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature    = hmacSha256(secret, signingInput);
    const signatureB64 = base64urlEncode(signature);

    return `${signingInput}.${signatureB64}`;
}

/**
 * Verify a JWT and return its decoded payload.
 *
 * Verification order is deliberate:
 *   1. Split into three parts.
 *   2. Decode the header and check `alg === "HS256"`. (Reject alg=none and
 *      other algorithms here, BEFORE doing any signature work, so we never
 *      execute different code paths for different alg values.)
 *   3. Recompute the signature over <headerB64>.<payloadB64> with our secret.
 *   4. Constant-time compare against the supplied signature; if mismatch,
 *      throw — never look at the payload contents.
 *   5. Only now decode the payload (we know the issuer authorized exactly
 *      this byte sequence).
 *   6. If the payload has an `exp` claim, reject if we're past it.
 *
 * @param {string}        token
 * @param {string|Buffer} secret
 * @returns {object} decoded payload
 * @throws on any malformed input, signature mismatch, or expired token
 */
function jwtVerify(token, secret) {
    if (typeof token !== 'string') {
        throw new Error('jwtVerify: token must be a string');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('jwtVerify: malformed token (expected 3 dot-separated parts)');
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    // ── Step 1: decode and validate the header ──────────────────────────
    let header;
    try {
        header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
    } catch {
        throw new Error('jwtVerify: header is not valid base64url-encoded JSON');
    }
    if (typeof header !== 'object' || header === null) {
        throw new Error('jwtVerify: header must be a JSON object');
    }
    // Hard reject anything other than HS256. This is the alg=none defense.
    if (header.alg !== 'HS256') {
        throw new Error(`jwtVerify: unsupported algorithm "${header.alg}" (only HS256 is accepted)`);
    }

    // ── Step 2: verify the signature ────────────────────────────────────
    const signingInput      = `${headerB64}.${payloadB64}`;
    const expectedSignature = hmacSha256(secret, signingInput);
    const providedSignature = base64urlDecode(signatureB64);

    if (!constantTimeEqual(expectedSignature, providedSignature)) {
        throw new Error('jwtVerify: signature mismatch');
    }

    // ── Step 3: only now decode the payload (signature confirmed) ───────
    let payload;
    try {
        payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
    } catch {
        throw new Error('jwtVerify: payload is not valid base64url-encoded JSON');
    }
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('jwtVerify: payload must be a JSON object');
    }

    // ── Step 4: enforce `exp` if present ────────────────────────────────
    if (typeof payload.exp === 'number') {
        const now = Math.floor(Date.now() / 1000);
        if (now >= payload.exp) {
            throw new Error('jwtVerify: token expired');
        }
    }

    return payload;
}


module.exports = { jwtSign, jwtVerify };


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node jwtScratch.js
//
// Seven tests, including the two security-critical "must reject" cases
// (tampered payload and the alg=none attack). Test #7 is skipped if the
// jsonwebtoken library isn't installed.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    let allPass = true;
    const SECRET = 'my-test-secret-key';

    // Tiny inline base64url helper for the hand-crafted attack tests below.
    // (We don't export the file's internal base64url helpers — they're
    // implementation detail of sign/verify.)
    const b64url = (str) =>
        Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    function record(name, pass, detail) {
        if (!pass) allPass = false;
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
        if (!pass && detail) console.log(`        ${detail}`);
    }

    // ── Test 1: sign + verify round-trip ────────────────────────────────
    {
        const token   = jwtSign({ userId: 'abc123', role: 'user' }, SECRET);
        const decoded = jwtVerify(token, SECRET);
        const ok = decoded.userId === 'abc123' && decoded.role === 'user';
        record('Test 1: sign + verify round-trip', ok, `decoded: ${JSON.stringify(decoded)}`);
    }

    // ── Test 2: sign + verify with expiresIn = "1h" ─────────────────────
    {
        const before = Math.floor(Date.now() / 1000);
        const token  = jwtSign({ userId: 'abc' }, SECRET, { expiresIn: '1h' });
        const after  = Math.floor(Date.now() / 1000);
        const decoded = jwtVerify(token, SECRET);

        const iatLooksRight = decoded.iat >= before && decoded.iat <= after;
        const expIsIatPlus1h = decoded.exp === decoded.iat + 3600;
        const ok = decoded.userId === 'abc' && iatLooksRight && expIsIatPlus1h;
        record('Test 2: expiresIn "1h" sets iat + exp correctly', ok,
            `iat=${decoded.iat} exp=${decoded.exp} window=[${before},${after}]`);
    }

    // ── Test 3: wrong secret must be rejected ───────────────────────────
    {
        const token = jwtSign({ userId: 'abc' }, 'secret-A');
        let threw = false, msg = '';
        try { jwtVerify(token, 'secret-B'); }
        catch (e) { threw = true; msg = e.message; }
        const ok = threw && /signature mismatch/i.test(msg);
        record('Test 3: wrong secret rejected', ok, `error: "${msg}"`);
    }

    // ── Test 4: tampered payload must be rejected ───────────────────────
    {
        const token  = jwtSign({ userId: 'user' }, SECRET);
        const parts  = token.split('.');
        // Substitute a different payload but leave the signature alone —
        // the signature was bound to the original payload, so the
        // recomputed signature must not match.
        const tamperedPayload = b64url(JSON.stringify({ userId: 'admin' }));
        const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

        let threw = false, msg = '';
        try { jwtVerify(tampered, SECRET); }
        catch (e) { threw = true; msg = e.message; }
        const ok = threw && /signature mismatch/i.test(msg);
        record('Test 4: tampered payload rejected', ok, `error: "${msg}"`);
    }

    // ── Test 5: alg=none attack must be rejected ────────────────────────
    {
        // Construct a token that an attacker would forge: alg=none header,
        // any payload they like, and an empty signature.
        const fakeHeader  = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
        const fakePayload = b64url(JSON.stringify({ userId: 'admin' }));
        const fakeToken   = `${fakeHeader}.${fakePayload}.`;

        let threw = false, msg = '';
        try { jwtVerify(fakeToken, SECRET); }
        catch (e) { threw = true; msg = e.message; }
        const ok = threw && /unsupported algorithm/i.test(msg);
        record('Test 5: alg=none attack rejected', ok, `error: "${msg}"`);
    }

    // ── Test 6: expired token must be rejected ──────────────────────────
    {
        // expiresIn: -10 means exp = now - 10 → expired 10 seconds ago.
        const token = jwtSign({ userId: 'abc' }, SECRET, { expiresIn: -10 });
        let threw = false, msg = '';
        try { jwtVerify(token, SECRET); }
        catch (e) { threw = true; msg = e.message; }
        const ok = threw && /expired/i.test(msg);
        record('Test 6: expired token rejected', ok, `error: "${msg}"`);
    }

    // ── Test 7: interop — accept a token signed by jsonwebtoken ─────────
    {
        let lib = null;
        try { lib = require('jsonwebtoken'); } catch { /* not installed */ }

        if (!lib) {
            console.log('SKIP  Test 7: interop with jsonwebtoken (library not installed)');
        } else {
            const libToken = lib.sign({ userId: 'abc' }, SECRET, { algorithm: 'HS256', noTimestamp: true });
            const decoded  = jwtVerify(libToken, SECRET);
            const ok = decoded.userId === 'abc';
            record('Test 7: jsonwebtoken-issued token verified by scratch', ok,
                `token: ${libToken}, decoded: ${JSON.stringify(decoded)}`);
        }
    }

    process.exit(allPass ? 0 : 1);
}
