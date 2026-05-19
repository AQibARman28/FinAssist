/**
 * audit.js — fire-and-forget AuditLog writer.
 *
 * Usage:
 *   logAudit(req, 'login.success', user._id);
 *   logAudit(req, 'login.failure', null, { reason: 'unknown_email' });
 *
 * Behavior:
 *   - Returns immediately; the DB write happens asynchronously. Logging
 *     a security event must never block the user-facing response or
 *     surface a failure to the caller.
 *   - On write failure (Mongo down, schema mismatch), logs the error to
 *     stderr with the event name and request id so the operator can
 *     follow up.
 *   - Captures req.ip (Express resolves X-Forwarded-For when
 *     `app.set('trust proxy', ...)` is configured — see index.js) and
 *     User-Agent. Both fields are nullable in the schema for callers
 *     outside the HTTP path (jobs, scripts).
 */

const AuditLog = require('../models/AuditLog');

// Whitelist of events. Adding a new event in source must also be added
// here so a typo doesn't silently land in the table.
const KNOWN_EVENTS = new Set([
    'register',
    'login.success',
    'login.failure',
    'logout',
    'password.change',
    '2fa.enable',
    '2fa.disable',
    'profile.email_change',
    'refresh.rotate',
    'refresh.revoke',
    'email.verify',
    'category.create',
    'category.update',
    'category.archive',
    'category.delete',
    'income.create',
    'income.update',
    'income.delete',
]);

function logAudit(req, event, userId = null, metadata = null) {
    if (!KNOWN_EVENTS.has(event)) {
        console.error(`audit: refusing to log unknown event "${event}"`);
        return;
    }

    const doc = {
        userId,
        event,
        ip:        req?.ip || null,
        userAgent: req?.get?.('User-Agent') || null,
        metadata,
    };

    AuditLog.create(doc).catch((err) => {
        console.error(`audit: failed to write event="${event}" requestId=${req?.requestId || '-'}: ${err.message}`);
    });
}

module.exports = { logAudit, KNOWN_EVENTS };
