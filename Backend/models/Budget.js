const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // G1: a reference to the user's own Category (type 'expense' or 'both'),
    // i.e. the same id Expense.category stores — so a budget's spend is the
    // sum of the expenses in that category for the month. Was a String enum
    // of 8 names that never matched an expense. The controller runs
    // utils/categoryGuard before insert; scripts/migrate-budget-categories.js
    // converts legacy rows.
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: [true, 'Category is required'] },

    limit:  { type: Number, required: [true, 'Budget limit is required'], min: [0, 'Must be positive'] },
    month:  { type: Number, required: true, min: 1, max: 12 },
    year:   { type: Number, required: true, min: 2020 },
    alertThreshold: { type: Number, default: 80, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },

    // No stored `spent`: it is computed on read from the expenses collection
    // (services/budgetSpend.js) so it cannot drift from the real expenses.

    // ECDSA-P256 server-attestation over canonical {category, limit, month, year},
    // base64-DER (category as its hex id string). Set on creation; NOT
    // regenerated on update. See docs/decisions/SEC-1-ecdsa.md.
    serverAttestation: { type: String },

    // Set only by scripts/migrate-budget-categories.js: the enum name the row
    // had before G1. Its serverAttestation was signed over that name, so the
    // controller verifies against it when the id-based payload doesn't match.
    legacyCategory: { type: String },
}, { timestamps: true });

budgetSchema.index({ user: 1, category: 1, month: 1, year: 1 }, { unique: true });

budgetSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Budget', budgetSchema);
