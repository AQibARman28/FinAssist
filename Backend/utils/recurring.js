/**
 * recurring.js — recurrence schedule + on-demand materialization.
 *
 * Two functions:
 *
 *   computeRecurringDates(anchorDate, frequency, fromDate, toDate) → Date[]
 *     Pure. Returns sorted Date objects in [fromDate, toDate] that match
 *     the schedule starting at anchorDate, INCLUDING anchorDate if it
 *     falls in the window. UTC arithmetic throughout (Mongo stores Dates
 *     as UTC).
 *
 *   materializeRecurring(Model, userId, fromDate, toDate) → { created }
 *     Side-effecting. Finds the user's recurring templates for the given
 *     Model (Income or Expense), figures out which schedule dates in the
 *     window need an instance, and inserts the missing ones. The template
 *     itself stands in for the anchor occurrence — instances are only
 *     created for schedule dates STRICTLY after the anchor.
 *
 * Important semantics
 * ───────────────────
 *   - Editing a template does NOT update existing generated instances.
 *     Once materialized, an instance is an independent row; the template's
 *     subsequent edits only affect FUTURE materializations.
 *   - Editing a generated instance is allowed and independent — it's just
 *     a normal record with parentRecurringId set.
 *   - Deleting a template stops future generation but leaves existing
 *     instances in place. The instances retain their parentRecurringId
 *     pointing at a now-gone _id; that's intentional and matches the
 *     "history is immutable" stance.
 *
 * Edge cases handled in date arithmetic
 * ─────────────────────────────────────
 *   - Monthly anchor on the 31st rolling into a 30-day month: clamps to
 *     the last day (e.g. Jan 31 → Feb 28/29, Mar 31, Apr 30, ...).
 *     Crucially, each occurrence is computed from the original anchor, NOT
 *     from the previous occurrence, so clamping doesn't compound.
 *   - Yearly anchor on Feb 29: clamps to Feb 28 on non-leap years.
 *
 * Performance note
 * ────────────────
 * materializeRecurring runs at the top of the list endpoints (getIncomes /
 * getExpenses). Per-request DB writes are tolerable at this scale but
 * worth revisiting if the list endpoint sees heavy traffic — easy
 * follow-ups: cache "last materialized window" per user, or move
 * materialization to a background worker keyed off user activity.
 */

// ── Schedule arithmetic ─────────────────────────────────────────────────────

const FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'yearly']);

// Compute the nth occurrence FROM the anchor (n=0 returns anchor itself).
// All math goes through UTC accessors so this is stable across server TZ.
function nthOccurrence(anchorDate, frequency, n) {
    const d = new Date(anchorDate);
    switch (frequency) {
        case 'weekly':
            d.setUTCDate(d.getUTCDate() + 7 * n);
            return d;
        case 'biweekly':
            d.setUTCDate(d.getUTCDate() + 14 * n);
            return d;
        case 'monthly': {
            const anchorDay  = anchorDate.getUTCDate();
            const absMonth   = anchorDate.getUTCFullYear() * 12 + anchorDate.getUTCMonth() + n;
            const targetYear = Math.floor(absMonth / 12);
            const targetMon  = absMonth - targetYear * 12;
            // Day 0 of (month+1) === last day of month.
            const daysInTarget = new Date(Date.UTC(targetYear, targetMon + 1, 0)).getUTCDate();
            d.setUTCDate(1);                         // safe-set so setting month doesn't overflow
            d.setUTCFullYear(targetYear, targetMon, Math.min(anchorDay, daysInTarget));
            return d;
        }
        case 'yearly': {
            const anchorMon  = anchorDate.getUTCMonth();
            const anchorDay  = anchorDate.getUTCDate();
            const targetYear = anchorDate.getUTCFullYear() + n;
            const daysInTarget = new Date(Date.UTC(targetYear, anchorMon + 1, 0)).getUTCDate();
            d.setUTCDate(1);
            d.setUTCFullYear(targetYear, anchorMon, Math.min(anchorDay, daysInTarget));
            return d;
        }
        default:
            throw new Error(`recurring: unknown frequency "${frequency}"`);
    }
}

function computeRecurringDates(anchorDate, frequency, fromDate, toDate) {
    if (!(anchorDate instanceof Date) || isNaN(anchorDate.getTime())) {
        throw new TypeError('computeRecurringDates: anchorDate must be a valid Date');
    }
    if (!FREQUENCIES.has(frequency)) {
        throw new Error(`computeRecurringDates: unknown frequency "${frequency}"`);
    }
    if (!(fromDate instanceof Date) || !(toDate instanceof Date)) {
        throw new TypeError('computeRecurringDates: fromDate and toDate must be Date objects');
    }
    if (fromDate.getTime() > toDate.getTime()) return [];

    const dates = [];
    // Cap is generous: ~1900 weeks ≈ 36 years for weekly, 100k months ≈ 8000
    // years for monthly. Real callers stop long before this.
    const SAFETY_CAP = 10_000;

    for (let n = 0; n < SAFETY_CAP; n++) {
        const d = nthOccurrence(anchorDate, frequency, n);
        if (d.getTime() > toDate.getTime()) break;
        if (d.getTime() >= fromDate.getTime()) dates.push(d);
    }

    return dates;
}

// ── Materialization ─────────────────────────────────────────────────────────

// Lazy requires to avoid circular dependencies (User → encryption → recurring → ...).
function _deps() {
    return {
        User:          require('../models/User'),
        masterDecrypt: require('./encryption').masterDecrypt,
        signRecord:    require('./signing').signRecord,
    };
}

// Identity of one materialized occurrence: template id + exact date.
const occurrenceKey = (templateId, date) => `${String(templateId)}:${date.getTime()}`;

// Set of occurrenceKey for every instance of `templateIds` dated in
// [fromDate, toDate] — one query, however many occurrences the window holds.
async function materializedDates(Model, userId, templateIds, fromDate, toDate) {
    const rows = await Model.find({
        user:              userId,
        parentRecurringId: { $in: templateIds },
        date:              { $gte: fromDate, $lte: toDate },
    }).select('parentRecurringId date').lean();
    return new Set(rows.map((r) => occurrenceKey(r.parentRecurringId, r.date)));
}

async function materializeRecurring(Model, userId, fromDate, toDate) {
    // Templates: rows authored as recurring AND that are themselves the
    // anchor (parentRecurringId === null). Templates whose anchor is in
    // the future relative to the window can't produce any instances IN the
    // window, so skip them.
    const templates = await Model.find({
        user:              userId,
        isRecurring:       true,
        parentRecurringId: null,
        date:              { $lte: toDate },
    });
    if (templates.length === 0) return { created: 0 };

    const due = [];
    for (const template of templates) {
        const freq = template.recurringFrequency;
        if (!freq || !FREQUENCIES.has(freq)) continue;          // skip malformed

        for (const occurrenceDate of computeRecurringDates(template.date, freq, fromDate, toDate)) {
            // The template stands in for its own anchor occurrence — don't
            // generate a separate instance for that date.
            if (occurrenceDate.getTime() === template.date.getTime()) continue;
            due.push({ template, occurrenceDate });
        }
    }
    if (due.length === 0) return { created: 0 };

    // Idempotency: only insert occurrences that have no instance yet for
    // their template at that exact date.
    const existing = await materializedDates(Model, userId, templates.map((t) => t._id), fromDate, toDate);
    const missing = due.filter(({ template, occurrenceDate }) => !existing.has(occurrenceKey(template._id, occurrenceDate)));
    if (missing.length === 0) return { created: 0 };

    // Load the user-side material needed to re-sign serverAttestation on
    // each new instance — only now that there is something to write. If the
    // user is missing or pre-encryption, we silently skip — the list endpoint
    // still works, just without freshly-materialized rows for that user.
    const { User, masterDecrypt, signRecord } = _deps();
    const user = await User.findById(userId).select(
        'encryptedDataKey rsaPublicKey encryptedRsaPrivateKey eccPublicKey encryptedEccPrivateKey'
    );
    if (!user?.encryptedDataKey) return { created: 0 };

    const rawKey  = await masterDecrypt(user.encryptedDataKey);
    const dataKey = Buffer.from(rawKey, 'hex');

    const rows = [];
    for (const { template, occurrenceDate } of missing) {
        // Deep clone the template, then strip the fields that should
        // change or get re-managed by Mongoose on insert.
        const tpl = template.toObject();
        delete tpl._id;
        delete tpl.updatedAt;
        delete tpl.__v;

        // Snapshotting the encrypted description / note is intentional
        // — the instance preserves the template's encrypted payload as
        // of materialization. Re-encrypting would not change the
        // plaintext (same dataKey + same plaintext); the only delta
        // would be a fresh IV per row, which doesn't buy anything
        // here because the parentRecurringId already publicly links
        // the rows.

        tpl.isRecurring        = false;
        tpl.recurringFrequency = undefined;        // only the template carries the cadence
        tpl.parentRecurringId  = template._id;
        tpl.date               = occurrenceDate;

        // createdAt is set explicitly so it makes it into the signed
        // payload — same pattern as incomeController.createIncome.
        tpl.createdAt = new Date();

        // Same payload shape the income controller checks on read.
        tpl.serverAttestation = await signRecord(require('./attestationPayloads').income(tpl), user, dataKey);
        rows.push(tpl);
    }

    // One write for the whole window instead of one round trip per row.
    await Model.insertMany(rows);
    return { created: rows.length };
}

module.exports = { computeRecurringDates, materializeRecurring, materializedDates, occurrenceKey };
