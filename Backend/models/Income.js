/**
 * Income — user-owned income records, mirrors Expense but with the extras
 * the brief calls out:
 *   - isRecurring + recurringFrequency for streams (Part 6 will materialize
 *     occurrences from the recurring source).
 *   - isPostTax for downstream net/gross reporting.
 *   - parentRecurringId — set on materialized occurrences pointing back to
 *     the recurring "template" row. Declared NOW so Part 6 doesn't have to
 *     do another schema change.
 *
 * serverAttestation is signed over a richer payload than Expense — it
 * includes date, user, and createdAt — so direct-DB tampering of any of
 * those fields is detectable on read. Created on insert; NOT regenerated
 * on update (same decision as the other record types — see
 * docs/decisions/SEC-1-ecdsa.md).
 */

const mongoose = require('mongoose');

const RECURRING_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'yearly'];

const incomeSchema = new mongoose.Schema({
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true, index: true },
    amount:   { type: Number, required: [true, 'Amount is required'], min: [0, 'Amount must be positive'] },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },

    // AES-256-GCM encrypted via the per-user dataKey.
    description: { type: String, required: [true, 'Description is required'] },
    date:        { type: Date,   required: [true, 'Date is required'] },

    isRecurring:        { type: Boolean, default: false },
    recurringFrequency: { type: String, enum: RECURRING_FREQUENCIES },

    isPostTax: { type: Boolean, default: true },

    // RSA-2048-OAEP encrypted, optional.
    note: { type: String },

    // Part 6 will set this on materialized occurrences pointing back to the
    // recurring source row. Always null for one-off entries and for the
    // template rows themselves.
    parentRecurringId: { type: mongoose.Schema.Types.ObjectId, ref: 'Income', default: null },

    // ECDSA-P256 server-attestation over canonical
    //   { amount, category, date, user, createdAt }
    // Set on creation; NOT regenerated on update.
    serverAttestation: { type: String },
}, { timestamps: true });

incomeSchema.index({ user: 1, date: -1 });

const Income = mongoose.model('Income', incomeSchema);
Income.RECURRING_FREQUENCIES = RECURRING_FREQUENCIES;
module.exports = Income;
