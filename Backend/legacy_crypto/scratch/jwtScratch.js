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
 * Decode a base64url string back to a Buffer — STRICTLY.
 *
 * Node's base64 decoder is *lenient*: it silently skips characters that
 * aren't in the alphabet, accepts '=' padding, accepts the standard '+'/'/'
 * alphabet as well as '-'/'_', and ignores non-zero "spare" bits in the
 * last character. That means many different strings decode to the same
 * bytes — e.g. a JWT whose signature ends in "...Xk" also "verifies" with
 * "...Xl". A token must have exactly one valid spelling, so we reject:
 *   - any character outside [A-Za-z0-9_-] (this includes '=', '+', '/',
 *     whitespace);
 *   - a length ≡ 1 (mod 4), which no byte string encodes to;
 *   - non-canonical trailing bits, detected by re-encoding the decoded
 *     bytes and requiring the result to equal the input exactly.
 */
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

function base64urlDecode(input) {
    if (typeof input !== 'string') {
        throw new TypeError('base64urlDecode: input must be a string');
    }
    if (!BASE64URL_RE.test(input)) {
        throw new Error('base64urlDecode: invalid base64url (only A-Z a-z 0-9 - _ allowed, no padding)');
    }
    if (input.length % 4 === 1) {
        throw new Error('base64urlDecode: invalid base64url length');
    }
    // Restore standard alphabet and pad to a multiple of 4 for Buffer.from.
    // (4 - n % 4) % 4 handles n % 4 == 0 gracefully: it gives 0, not 4.
    const standard = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding  = '='.repeat((4 - (standard.length % 4)) % 4);
    const decoded  = Buffer.from(standard + padding, 'base64');

    // Canonical form: the only accepted spelling is the one we would emit.
    if (base64urlEncode(decoded) !== input) {
        throw new Error('base64urlDecode: non-canonical base64url (non-zero trailing bits)');
    }
    return decoded;
}

/**
 * Reject an empty or missing HMAC secret. HMAC with an empty key is still
 * "valid" HMAC, so without this check a misconfigured deployment (unset
 * JWT_SECRET → '') would happily sign and verify tokens anyone can forge.
 */
function assertSecret(secret, fnName) {
    const ok = (typeof secret === 'string' && secret.length > 0) ||
               (Buffer.isBuffer(secret) && secret.length > 0);
    if (!ok) {
        throw new TypeError(`${fnName}: secret must be a non-empty string or Buffer`);
    }
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
    assertSecret(secret, 'jwtSign');

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
 *   6. Require an `exp` claim (unless options.allowMissingExp) and reject
 *      if we're past it. A present-but-non-numeric `exp` is always an error.
 *
 * All three segments go through the strict base64url decoder, so a token
 * has exactly one accepted spelling.
 *
 * @param {string}        token
 * @param {string|Buffer} secret                    — must be non-empty
 * @param {object}        [options]
 * @param {boolean}       [options.allowMissingExp=false] — accept tokens with
 *        no `exp` claim (non-expiring). Off by default: a token that never
 *        expires is a permanent credential if it leaks.
 * @param {number}        [options.clockTimestamp] — "now" in seconds since
 *        the epoch (defaults to the system clock). Useful for tests and for
 *        checking historical vectors such as RFC 7515 A.1.
 * @returns {object} decoded payload
 * @throws on any malformed input, signature mismatch, missing/invalid exp,
 *         or expired token
 */
function jwtVerify(token, secret, options = {}) {
    assertSecret(secret, 'jwtVerify');
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
    // The attacker-controlled alg value is deliberately NOT echoed in the
    // message (it may end up in logs or an HTTP response).
    if (header.alg !== 'HS256') {
        throw new Error('jwtVerify: unsupported algorithm (only HS256 is accepted)');
    }

    // ── Step 2: verify the signature ────────────────────────────────────
    const signingInput      = `${headerB64}.${payloadB64}`;
    const expectedSignature = hmacSha256(secret, signingInput);
    let providedSignature;
    try {
        providedSignature = base64urlDecode(signatureB64);
    } catch {
        throw new Error('jwtVerify: signature is not valid base64url');
    }

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

    // ── Step 4: enforce `exp` ───────────────────────────────────────────
    if (Object.prototype.hasOwnProperty.call(payload, 'exp')) {
        if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
            throw new Error('jwtVerify: exp claim must be a number');
        }
        const now = options.clockTimestamp !== undefined
            ? options.clockTimestamp
            : Math.floor(Date.now() / 1000);
        if (typeof now !== 'number' || !Number.isFinite(now)) {
            throw new TypeError('jwtVerify: options.clockTimestamp must be a finite number');
        }
        if (now >= payload.exp) {
            throw new Error('jwtVerify: token expired');
        }
    } else if (options.allowMissingExp !== true) {
        throw new Error('jwtVerify: token has no exp claim (pass { allowMissingExp: true } to accept non-expiring tokens)');
    }

    return payload;
}


module.exports = { jwtSign, jwtVerify };


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node jwtScratch.js
//
// Twelve tests, including the security-critical "must reject" cases
// (tampered payload, alg=none, altered base64url, empty secret, missing
// exp) and the RFC 7515 Appendix A.1 known-answer vector. Test #7 is
// skipped if the jsonwebtoken library isn't installed.
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
        // No expiresIn → no `exp` claim, so verification needs the explicit
        // opt-in (exp is required by default; see Test 11).
        const token   = jwtSign({ userId: 'abc123', role: 'user' }, SECRET);
        const decoded = jwtVerify(token, SECRET, { allowMissingExp: true });
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
            const libToken = lib.sign({ userId: 'abc' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
            const decoded  = jwtVerify(libToken, SECRET);
            const ok = decoded.userId === 'abc' && typeof decoded.exp === 'number';
            record('Test 7: jsonwebtoken-issued token verified by scratch', ok,
                `token: ${libToken}, decoded: ${JSON.stringify(decoded)}`);
        }
    }

    // Helper: run fn, return { threw, msg }.
    const attempt = (fn) => {
        try { fn(); return { threw: false, msg: '' }; }
        catch (e) { return { threw: true, msg: e.message }; }
    };

    // ── RFC 7515 Appendix A.1 — "Example JWS Using HMAC SHA-256" ────────
    // Source: https://www.rfc-editor.org/rfc/rfc7515.txt — Appendix A.1.1.
    // The JWK "k" value (the HMAC key, base64url), the JWS Signing Input
    // (BASE64URL(header) || '.' || BASE64URL(payload)), and the expected
    // BASE64URL(JWS Signature). Note the protected header and payload JSON
    // contain CRLF line breaks; the base64url strings below encode them.
    const RFC7515_A1 = {
        k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75' +
           'aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
        signingInput: 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
                      '.' +
                      'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFt' +
                      'cGxlLmNvbS9pc19yb290Ijp0cnVlfQ',
        signature: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        exp: 1300819380            // the payload's exp claim (March 2011)
    };
    const rfcKey   = base64urlDecode(RFC7515_A1.k);
    const rfcToken = `${RFC7515_A1.signingInput}.${RFC7515_A1.signature}`;
    const rfcClock = { clockTimestamp: RFC7515_A1.exp - 1 };   // 1 s before expiry

    // ── Test 8: RFC 7515 A.1 known answer ───────────────────────────────
    {
        const sigB64  = base64urlEncode(hmacSha256(rfcKey, RFC7515_A1.signingInput));
        const kat     = sigB64 === RFC7515_A1.signature && rfcKey.length === 64;
        let payload = null;
        try { payload = jwtVerify(rfcToken, rfcKey, rfcClock); } catch { /* reported below */ }
        const verifies = payload !== null && payload.iss === 'joe' &&
                         payload.exp === RFC7515_A1.exp &&
                         payload['http://example.com/is_root'] === true;
        const expiredNow = attempt(() => jwtVerify(rfcToken, rfcKey));
        const ok = kat && verifies && expiredNow.threw && /expired/i.test(expiredNow.msg);
        record('Test 8: RFC 7515 A.1 HS256 vector (signature KAT, verify at exp-1, expired now)', ok,
            `sig=${sigB64} kat=${kat} verifies=${verifies} expiredNow="${expiredNow.msg}"`);
    }

    // ── Test 9: strict base64url — altered signature strings rejected ───
    {
        // Every variant below decodes to the SAME 32 signature bytes under a
        // lenient decoder, so only a strict decoder can reject them.
        const [h, p, s] = rfcToken.split('.');
        const variants = {
            'non-canonical trailing bits (k→l)': `${h}.${p}.${s.slice(0, -1)}l`,
            "'=' padding appended":               `${h}.${p}.${s}=`,
            "standard-alphabet '+' for '-'":      `${h}.${p}.${s.replace('-', '+')}`,
            "standard-alphabet '/' for '_'":      `${h}.${p}.${s.replace('_', '/')}`,
            'embedded space':                     `${h}.${p}.${s.slice(0, 10)} ${s.slice(10)}`
        };
        const failures = [];
        for (const [label, tok] of Object.entries(variants)) {
            const r = attempt(() => jwtVerify(tok, rfcKey, rfcClock));
            if (!r.threw || !/base64url/i.test(r.msg)) failures.push(`${label}: threw=${r.threw} msg="${r.msg}"`);
        }
        // Header/payload segments are strict too.
        const badHeader = attempt(() => jwtVerify(`${h}=.${p}.${s}`, rfcKey, rfcClock));
        if (!badHeader.threw) failures.push('header with = padding accepted');
        // And the untouched vector still verifies.
        const stillOk = !attempt(() => jwtVerify(rfcToken, rfcKey, rfcClock)).threw;
        record(`Test 9: strict base64url — ${Object.keys(variants).length} altered signature encodings rejected`,
            failures.length === 0 && stillOk, `${failures.join('; ')} stillOk=${stillOk}`);
    }

    // ── Test 10: empty or missing secret rejected (sign and verify) ─────
    {
        const good = jwtSign({ userId: 'abc' }, SECRET, { expiresIn: '1h' });
        const cases = {
            'sign, empty string':  () => jwtSign({ a: 1 }, ''),
            'sign, empty Buffer':  () => jwtSign({ a: 1 }, Buffer.alloc(0)),
            'sign, undefined':     () => jwtSign({ a: 1 }),
            'verify, empty string': () => jwtVerify(good, ''),
            'verify, null':        () => jwtVerify(good, null),
            'verify, undefined':   () => jwtVerify(good)
        };
        const failures = [];
        for (const [label, fn] of Object.entries(cases)) {
            const r = attempt(fn);
            if (!r.threw || !/secret/i.test(r.msg)) failures.push(`${label}: threw=${r.threw} msg="${r.msg}"`);
        }
        record('Test 10: empty or missing secret rejected by jwtSign and jwtVerify',
            failures.length === 0, failures.join('; '));
    }

    // ── Test 11: exp required unless explicitly allowed ─────────────────
    {
        const noExp = jwtSign({ userId: 'abc' }, SECRET);
        const rejectedByDefault = attempt(() => jwtVerify(noExp, SECRET));
        const allowed = attempt(() => jwtVerify(noExp, SECRET, { allowMissingExp: true }));
        // A present-but-non-numeric exp is never skipped silently.
        const strExp = jwtSign({ userId: 'abc', exp: '9999999999' }, SECRET);
        const strExpRejected = attempt(() => jwtVerify(strExp, SECRET, { allowMissingExp: true }));
        const ok = rejectedByDefault.threw && /exp/i.test(rejectedByDefault.msg) &&
                   !allowed.threw && strExpRejected.threw;
        record('Test 11: token without exp rejected by default, accepted with allowMissingExp; string exp rejected', ok,
            `default="${rejectedByDefault.msg}" allowed=${!allowed.threw} strExp="${strExpRejected.msg}"`);
    }

    // ── Test 12: attacker-supplied alg is not echoed in the error ───────
    {
        const evilAlg   = 'HS256"><script>alert(1)</script>';
        const evilToken = `${b64url(JSON.stringify({ alg: evilAlg, typ: 'JWT' }))}.${b64url('{}')}.`;
        const r = attempt(() => jwtVerify(evilToken, SECRET));
        const ok = r.threw && /unsupported algorithm/i.test(r.msg) && !r.msg.includes('script');
        record('Test 12: unsupported alg rejected without echoing the attacker-supplied value', ok,
            `msg="${r.msg}"`);
    }

    process.exit(allPass ? 0 : 1);
}
