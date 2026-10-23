/**
 * loginThrottle.js — per-account sign-in throttling that is independent of
 * the client IP (so a forged X-Forwarded-For can't dodge it) and identical
 * for existing and non-existing accounts (so it can't enumerate them).
 *
 * Policy: 5 failures inside 15 minutes lock the key for 15 min × 2^n, where n
 * counts earlier lockouts, capped at 1 hour. A successful sign-in or a
 * password reset clears the row.
 */

const LoginThrottle = require('../models/LoginThrottle');

const WINDOW_MS   = 15 * 60 * 1000;
const FAIL_LIMIT  = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS  = 60 * 60 * 1000;

async function isThrottled(key) {
    const row = await LoginThrottle.findOne({ key }).lean();
    return Boolean(row && row.lockedUntil && row.lockedUntil.getTime() > Date.now());
}

async function recordFailure(key) {
    const now = new Date();
    const row = await LoginThrottle.findOne({ key });
    const doc = row || new LoginThrottle({ key });

    if (!doc.windowStart || now - doc.windowStart > WINDOW_MS) {
        doc.windowStart = now;
        doc.failures = 1;
    } else {
        doc.failures += 1;
    }
    if (doc.failures >= FAIL_LIMIT) {
        const lockMs = Math.min(BASE_LOCK_MS * 2 ** (doc.lockouts || 0), MAX_LOCK_MS);
        doc.lockedUntil = new Date(now.getTime() + lockMs);
        doc.lockouts = (doc.lockouts || 0) + 1;
        doc.failures = 0;
        doc.windowStart = null;
    }
    doc.updatedAt = now;
    await doc.save();
}

async function clear(key) {
    await LoginThrottle.deleteOne({ key });
}

module.exports = { isThrottled, recordFailure, clear, _policy: { WINDOW_MS, FAIL_LIMIT, BASE_LOCK_MS, MAX_LOCK_MS } };
