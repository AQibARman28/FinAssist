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
 * Rotation policy (refresh), per OAuth 2.0 Security BCP §4.14:
 *   1. Atomically claim the live row for sha256(cookie value): one
 *      findOneAndUpdate sets revokedAt, so two parallel refreshes can't both
 *      win the same row.
 *   2. Mint a new token in the same family, carrying "remember me".
 *   3. If the row was already rotated:
 *        - within ROTATION_GRACE_MS, a parallel tab raced us: issue it a
 *          sibling token in the same family;
 *        - after that, the token is being replayed (likely stolen): revoke the
 *          whole family and report reuse.
 *      Tokens revoked by logout or password change are never revived.
 */

const crypto = require('node:crypto');
const native = require('./nativeCrypto');
const RefreshToken = require('../models/RefreshToken');

const ACCESS_TTL          = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL_DAYS         = 7;    // default session
const REFRESH_TTL_DAYS_REMEMBER = 30;  // "remember me" session
const TEMP_2FA_TTL        = '5m';
const ROTATION_GRACE_MS   = 10 * 1000; // parallel tabs refreshing at once

const COOKIE_ACCESS  = 'fa_access';
const COOKIE_REFRESH = 'fa_refresh';
const COOKIE_TEMP    = 'fa_temp';

function _isProd() { return process.env.NODE_ENV === 'production'; }

// Secrets a session JWT may be signed with: the current one, plus the previous
// one while a JWT_SECRET rotation is rolling out. New tokens always use the
// current secret.
function jwtSecrets() {
    return [process.env.JWT_SECRET, process.env.JWT_SECRET_PREVIOUS].filter(Boolean);
}

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

async function mintRefreshToken(userId, rememberMe = false, familyId = crypto.randomUUID()) {
    const plaintext = crypto.randomBytes(32).toString('base64url');
    const tokenHash = _hashRefreshToken(plaintext);
    const days = rememberMe ? REFRESH_TTL_DAYS_REMEMBER : REFRESH_TTL_DAYS;
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
    await RefreshToken.create({ userId, tokenHash, familyId, rememberMe: !!rememberMe, expiresAt });
    return { plaintext, expiresAt };
}

// ── Rotate / revoke ─────────────────────────────────────────────────────────

async function _issueRotated(row) {
    // Rows from before families existed join a fresh family on first rotation.
    const fresh = await mintRefreshToken(row.userId, row.rememberMe, row.familyId || crypto.randomUUID());
    return {
        userId: row.userId,
        accessToken: mintAccessToken(row.userId),
        refreshToken: fresh.plaintext,
        refreshExpiresAt: fresh.expiresAt,
    };
}

// Returns:
//   { userId, accessToken, refreshToken, refreshExpiresAt }  on success
//   { reuseDetected: true, userId }                          on replay
//   null                                                     otherwise
async function rotateRefreshToken(plaintextRefresh) {
    if (typeof plaintextRefresh !== 'string' || plaintextRefresh.length === 0) return null;

    const tokenHash = _hashRefreshToken(plaintextRefresh);
    const now = new Date();

    const claimed = await RefreshToken.findOneAndUpdate(
        { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now, revokedReason: 'rotated' } },
    );
    if (claimed) return _issueRotated(claimed);

    // Only a token retired by rotation can be a parallel-tab race or a replay;
    // one revoked by logout or a password change simply stays dead.
    const row = await RefreshToken.findOne({ tokenHash });
    if (!row || !row.revokedAt || row.revokedReason !== 'rotated') return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;

    if (now.getTime() - row.revokedAt.getTime() <= ROTATION_GRACE_MS) return _issueRotated(row);

    // Replay of a rotated token: whoever holds the newer token may be an
    // attacker or the user — we can't tell, so the whole family signs out.
    const filter = row.familyId ? { familyId: row.familyId } : { userId: row.userId };
    await RefreshToken.updateMany({ ...filter, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'reuse' } });
    return { reuseDetected: true, userId: row.userId };
}

async function revokeRefreshToken(plaintextRefresh) {
    if (typeof plaintextRefresh !== 'string' || plaintextRefresh.length === 0) return;
    const tokenHash = _hashRefreshToken(plaintextRefresh);
    await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
}

// Revoke every live refresh token for a user — used after a password change
// or reset so any other/old sessions (including an attacker's) re-authenticate.
async function revokeAllForUser(userId) {
    await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'revoke_all' } });
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
// rememberMe extends the refresh token to 30 days (vs 7).
async function establishSession(res, userId, { rememberMe = false } = {}) {
    const accessToken = mintAccessToken(userId);
    const refresh     = await mintRefreshToken(userId, rememberMe);
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refresh.plaintext, refresh.expiresAt);
}

module.exports = {
    COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_TEMP,
    jwtSecrets,
    mintAccessToken, mintTempToken, mintRefreshToken,
    rotateRefreshToken, revokeRefreshToken, revokeAllForUser,
    setAccessCookie, setRefreshCookie, setTempCookie,
    clearSessionCookies, clearTempCookie,
    establishSession,
};
