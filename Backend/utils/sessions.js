/**
 * sessions.js — session token + cookie management for SEC-1 Phase 3.
 *
 * Two-cookie scheme:
 *   fa_access  — short-lived (ACCESS_TTL) JWT carrying { id }, HS256.
 *   fa_refresh — long-lived opaque random token (REFRESH_TTL_DAYS days).
 *                Plaintext lives only in the cookie. The DB holds
 *                sha256(plaintext) as RefreshToken.tokenHash.
 *
 * Plus an optional fa_temp cookie used as the 2FA gate (5-minute JWT,
 * payload type=temp_2fa). It is set by /auth/login when 2FA is enabled
 * and cleared by /auth/2fa/verify on success or failure.
 *
 * All cookies:
 *   httpOnly:        true      (browser JS cannot read them — kills XSS-to-token theft)
 *   sameSite:        'strict'  (browser refuses to send on cross-site requests)
 *   secure:          true in production, false in dev (allows http://localhost)
 *   path:            '/'
 *
 * Rotation policy (refresh):
 *   On every successful /auth/refresh:
 *     1. Look up RefreshToken by sha256(cookie value).
 *     2. Reject if not found, or revokedAt set, or expiresAt past.
 *     3. Mark old row revokedAt = now.
 *     4. Mint a new plaintext token + insert a new RefreshToken row.
 *     5. Replace the fa_refresh cookie with the new plaintext.
 *     6. Mint a new fa_access cookie.
 */

const crypto = require('node:crypto');
const native = require('./nativeCrypto');
const RefreshToken = require('../models/RefreshToken');

const ACCESS_TTL       = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL_DAYS = 7;
const TEMP_2FA_TTL     = '5m';

const COOKIE_ACCESS  = 'fa_access';
const COOKIE_REFRESH = 'fa_refresh';
const COOKIE_TEMP    = 'fa_temp';

function _isProd() { return process.env.NODE_ENV === 'production'; }

function _cookieOpts(maxAgeMs) {
    return {
        httpOnly: true,
        secure:   _isProd(),
        sameSite: 'strict',
        path:     '/',
        ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
    };
}

function _hashRefreshToken(plaintext) {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
}

// ── Mint ────────────────────────────────────────────────────────────────────

function mintAccessToken(userId) {
    return native.signJwt({ id: userId.toString() }, process.env.JWT_SECRET, ACCESS_TTL);
}

function mintTempToken(userId) {
    return native.signJwt({ id: userId.toString(), type: 'temp_2fa' }, process.env.JWT_SECRET, TEMP_2FA_TTL);
}

async function mintRefreshToken(userId) {
    const plaintext = crypto.randomBytes(32).toString('base64url');
    const tokenHash = _hashRefreshToken(plaintext);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await RefreshToken.create({ userId, tokenHash, expiresAt });
    return { plaintext, expiresAt };
}

// ── Rotate / revoke ─────────────────────────────────────────────────────────

// Returns null if the provided refresh-cookie value does not correspond to a
// live (not-revoked, not-expired) refresh token. Otherwise: revokes the old
// row, mints a fresh access+refresh pair, returns the userId and new tokens.
async function rotateRefreshToken(plaintextRefresh) {
    if (typeof plaintextRefresh !== 'string' || plaintextRefresh.length === 0) return null;

    const tokenHash = _hashRefreshToken(plaintextRefresh);
    const row = await RefreshToken.findOne({ tokenHash });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;

    row.revokedAt = new Date();
    await row.save();

    const fresh = await mintRefreshToken(row.userId);
    const accessToken = mintAccessToken(row.userId);
    return { userId: row.userId, accessToken, refreshToken: fresh.plaintext, refreshExpiresAt: fresh.expiresAt };
}

async function revokeRefreshToken(plaintextRefresh) {
    if (typeof plaintextRefresh !== 'string' || plaintextRefresh.length === 0) return;
    const tokenHash = _hashRefreshToken(plaintextRefresh);
    await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

// ── Cookie set / clear ──────────────────────────────────────────────────────

function setAccessCookie(res, accessToken) {
    // Access cookie maxAge intentionally omitted — short-lived; the JWT's exp
    // is authoritative. Browser treats it as a session cookie that's still
    // re-sent on every same-site request.
    res.cookie(COOKIE_ACCESS, accessToken, _cookieOpts());
}

function setRefreshCookie(res, refreshToken, expiresAt) {
    res.cookie(COOKIE_REFRESH, refreshToken, _cookieOpts(expiresAt.getTime() - Date.now()));
}

function setTempCookie(res, tempToken) {
    // 5-minute TTL on the cookie matches the JWT exp inside.
    res.cookie(COOKIE_TEMP, tempToken, _cookieOpts(5 * 60 * 1000));
}

function clearSessionCookies(res) {
    const opts = { ..._cookieOpts(0), maxAge: undefined };
    res.clearCookie(COOKIE_ACCESS,  opts);
    res.clearCookie(COOKIE_REFRESH, opts);
    res.clearCookie(COOKIE_TEMP,    opts);
}

function clearTempCookie(res) {
    res.clearCookie(COOKIE_TEMP, { ..._cookieOpts(0), maxAge: undefined });
}

// Convenience: mint + set both cookies after a fresh authentication.
async function establishSession(res, userId) {
    const accessToken = mintAccessToken(userId);
    const refresh     = await mintRefreshToken(userId);
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refresh.plaintext, refresh.expiresAt);
}

module.exports = {
    COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_TEMP,
    mintAccessToken, mintTempToken, mintRefreshToken,
    rotateRefreshToken, revokeRefreshToken,
    setAccessCookie, setRefreshCookie, setTempCookie,
    clearSessionCookies, clearTempCookie,
    establishSession,
};
