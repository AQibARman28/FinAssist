/**
 * totpGuard.js — TOTP rate-limit + replay-protection helper extracted from
 * twoFactorController.js so it can be unit-tested in isolation. Mutates the
 * passed-in user document; caller is responsible for save() outside replay
 * detection (the helper itself only saves on a failed-attempt path, since
 * lockout counters must persist atomically).
 *
 * Policy (SEC-1 Phase 4):
 *   - Replay window: a successful TOTP code is recorded for 90 seconds. If
 *     the same code is submitted again inside that window, reject as replay.
 *   - Rate limit: 5 failures inside a 5-minute sliding window locks the
 *     user's TOTP verification for 5 minutes.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, status: 423 }
 *   { ok: false, status: 401, replay: true }
 *   { ok: false, status: 401 }
 */

const native = require('./nativeCrypto');
const { decrypt } = require('./encryption');

const REPLAY_WINDOW_MS = 90 * 1000;
const RATE_WINDOW_MS   = 5 * 60 * 1000;
const FAIL_LIMIT       = 5;
const LOCKOUT_MS       = 5 * 60 * 1000;

function isTotpLocked(user) {
    return user.totpLockedUntil && user.totpLockedUntil.getTime() > Date.now();
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
    if (typeof user.save === 'function') await user.save();
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
    const secret = user.twoFactorSecret ? await decrypt(user.twoFactorSecret, dataKey) : null;
    const valid = secret ? native.verifyTotp(secret, code) : false;
    if (!valid) {
        await recordTotpFailure(user);
        return { ok: false, status: 401 };
    }
    user.recentTotpCodes.push({ code, usedAt: new Date() });
    clearTotpFailures(user);
    if (typeof user.save === 'function') await user.save();
    return { ok: true };
}

module.exports = {
    checkAndRecordTotp,
    // exported for tests
    _internals: { REPLAY_WINDOW_MS, RATE_WINDOW_MS, FAIL_LIMIT, LOCKOUT_MS },
};
