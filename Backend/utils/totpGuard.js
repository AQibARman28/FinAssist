/**
 * totpGuard.js — second-factor checks with rate limiting and replay
 * protection, shared by sign-in, enable/disable and sensitive profile changes.
 * Mutates the passed-in user document and saves it on every outcome that
 * changes counters, so lockout state persists.
 *
 * Policy (SEC-1 Phase 4):
 *   - Replay window: a successful TOTP code is recorded for 90 seconds. If
 *     the same code is submitted again inside that window, reject as replay.
 *   - Rate limit: 5 failures inside a 5-minute sliding window locks the
 *     user's second-factor verification for 5 minutes. Recovery-code guesses
 *     count toward the same limit.
 *   - Recovery codes are single-use and compared as sha256 hashes in
 *     constant time.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, status: 423 }
 *   { ok: false, status: 401, replay: true }
 *   { ok: false, status: 401 }
 */

const crypto = require('node:crypto');
const native = require('./nativeCrypto');
const { decrypt, fieldContext, FIELDS } = require('./encryption');

const REPLAY_WINDOW_MS = 90 * 1000;
const RATE_WINDOW_MS   = 5 * 60 * 1000;
const FAIL_LIMIT       = 5;
const LOCKOUT_MS       = 5 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function isTotpLocked(user) {
    return user.totpLockedUntil && user.totpLockedUntil.getTime() > Date.now();
}

async function _save(user) {
    if (typeof user.save === 'function') await user.save();
}

async function recordTotpFailure(user) {
    const now = new Date();
    if (!user.firstFailedTotpAt || (now - user.firstFailedTotpAt) > RATE_WINDOW_MS) {
        user.firstFailedTotpAt = now;
        user.failedTotpAttempts = 1;
    } else {
        user.failedTotpAttempts += 1;
    }
    if (user.failedTotpAttempts >= FAIL_LIMIT) {
        user.totpLockedUntil    = new Date(now.getTime() + LOCKOUT_MS);
        user.failedTotpAttempts = 0;
        user.firstFailedTotpAt  = null;
    }
    await _save(user);
}

function clearTotpFailures(user) {
    user.failedTotpAttempts = 0;
    user.firstFailedTotpAt  = null;
    user.totpLockedUntil    = null;
}

function pruneRecentCodes(user) {
    const cutoff = Date.now() - REPLAY_WINDOW_MS;
    user.recentTotpCodes = (user.recentTotpCodes || []).filter(e => e.usedAt.getTime() > cutoff);
}

function isReplayed(user, code) {
    pruneRecentCodes(user);
    return (user.recentTotpCodes || []).some(e => e.code === code);
}

async function checkAndRecordTotp(user, dataKey, code) {
    if (isTotpLocked(user)) {
        return { ok: false, status: 423 };
    }
    if (isReplayed(user, code)) {
        await recordTotpFailure(user);
        return { ok: false, status: 401, replay: true };
    }
    const context = user._id ? fieldContext(FIELDS.userTotpSecret, user._id) : null;
    const secret = user.twoFactorSecret ? await decrypt(user.twoFactorSecret, dataKey, context) : null;
    const valid = secret ? native.verifyTotp(secret, code, user.twoFactorAlgorithm || 'sha256') : false;
    if (!valid) {
        await recordTotpFailure(user);
        return { ok: false, status: 401 };
    }
    user.recentTotpCodes.push({ code, usedAt: new Date() });
    clearTotpFailures(user);
    await _save(user);
    return { ok: true };
}

// ── Recovery codes ──────────────────────────────────────────────────────────

const _normalize = (code) => String(code).replace(/-/g, '').toUpperCase();
const _hashCode  = (code) => crypto.createHash('sha256').update(_normalize(code)).digest('hex');

// 10 codes of 10 base32 characters (50 bits each), shown once as ABCDE-FGHIJ.
function generateRecoveryCodes() {
    const codes = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        let s = '';
        for (const b of crypto.randomBytes(10)) s += BASE32[b & 31];
        codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
    }
    return { codes, hashes: codes.map((c) => ({ hash: _hashCode(c), usedAt: null })) };
}

async function checkAndConsumeRecoveryCode(user, code) {
    if (isTotpLocked(user)) return { ok: false, status: 423 };
    const candidate = Buffer.from(_hashCode(code), 'hex');
    let match = null;
    for (const entry of user.twoFactorRecoveryCodes || []) {
        const stored = Buffer.from(entry.hash, 'hex');
        // Scan every entry so the time taken doesn't reveal a match position.
        if (stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate) && !entry.usedAt && !match) {
            match = entry;
        }
    }
    if (!match) {
        await recordTotpFailure(user);
        return { ok: false, status: 401 };
    }
    match.usedAt = new Date();
    clearTotpFailures(user);
    await _save(user);
    return { ok: true, remaining: user.twoFactorRecoveryCodes.filter((e) => !e.usedAt).length };
}

// Accepts { token } or { recoveryCode } — whichever the client sent.
async function checkSecondFactor(user, dataKey, { token, recoveryCode } = {}) {
    if (recoveryCode) return checkAndConsumeRecoveryCode(user, recoveryCode);
    return checkAndRecordTotp(user, dataKey, token);
}

module.exports = {
    checkAndRecordTotp,
    checkAndConsumeRecoveryCode,
    checkSecondFactor,
    generateRecoveryCodes,
    // exported for tests
    _internals: { REPLAY_WINDOW_MS, RATE_WINDOW_MS, FAIL_LIMIT, LOCKOUT_MS, RECOVERY_CODE_COUNT },
};
