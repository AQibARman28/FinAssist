/**
 * AuditLog — security-relevant events for after-the-fact forensics.
 *
 * Brief constraints (SEC-1 Phase 5):
 *   - userId, event, ip, userAgent, createdAt
 *   - "No PII beyond userId"
 *
 * We add an optional `metadata` blob for low-cardinality facts that aid
 * triage (e.g. { reason: 'wrong_password' }, { revokedTokenHashPrefix: ... }).
 * Anything that could identify a person beyond what userId already does
 * MUST stay out — emails, names, IPs of OTHER users, etc.
 *
 * For login-failure events the actor may not be a known user (unknown
 * email). In those cases userId is null and the event still records ip/UA.
 */

const mongoose = require('mongoose');

// Retention: IP addresses and user agents are personal data, so entries
// expire after AUDIT_RETENTION_DAYS (default 180) via a TTL index. Existing
// databases pick up the new index with `npm run migrate:audit-retention`.
const RETENTION_DAYS = Math.max(1, parseInt(process.env.AUDIT_RETENTION_DAYS || '180', 10));

const auditLogSchema = new mongoose.Schema({
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    event:     { type: String, required: true, index: true },
    ip:        { type: String, default: null },
    userAgent: { type: String, default: null },
    metadata:  { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date,   default: Date.now, index: { expireAfterSeconds: RETENTION_DAYS * 24 * 3600 } },
});

// Compound index used by "show me this user's recent security events".
auditLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
