/**
 * integrity.js — check record attestations on the way out.
 *
 * Each record whose ECDSA attestation is 'missing' or 'invalid' comes back
 * with `integrity: 'missing' | 'invalid'` so the client can flag it, and the
 * request writes one `integrity.attestation_failure` audit event naming up to
 * 20 of the affected ids. Before this, a failed check only printed a console
 * warning and a stripped attestation wasn't noticed at all.
 */

const { attestationStatus } = require('./signing');
const { logAudit } = require('./audit');

// Returns Map(recordId -> 'missing' | 'invalid') for records that aren't valid.
// `payloadOf` may return a list of candidate payloads (e.g. a migrated row
// signed under its old shape); the record is valid if any candidate verifies.
async function checkRecords(req, kind, records, payloadOf) {
    const issues = new Map();
    for (const r of records) {
        let status = 'invalid';
        for (const payload of [].concat(payloadOf(r))) {
            status = await attestationStatus(payload, r.serverAttestation, req.user);
            if (status !== 'invalid') break;
        }
        if (status !== 'valid') issues.set(String(r._id), status);
    }
    if (issues.size) {
        logAudit(req, 'integrity.attestation_failure', req.user._id, {
            kind,
            count: issues.size,
            ids: [...issues.keys()].slice(0, 20),
        });
    }
    return issues;
}

// Copies the integrity flag onto a response object when there is one.
function flag(obj, issues) {
    const status = issues.get(String(obj._id));
    if (status) obj.integrity = status;
    return obj;
}

module.exports = { checkRecords, flag };
