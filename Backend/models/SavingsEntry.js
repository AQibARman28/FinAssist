const mongoose = require('mongoose');

/**
 * SavingsEntry — the standalone Savings account ledger (separate from goals).
 *
 *   deposit  → money moved Wallet → Savings (set aside; leaves the spendable Wallet)
 *   withdraw → money moved Savings → Wallet (back into the pocket)
 *
 * Savings balance = Σ(deposit) − Σ(withdraw).
 * Wallet (spendable) subtracts the NET savings (deposits − withdrawals), the same
 * way it subtracts goal contributions — see services/balance.js.
 *
 * `source` distinguishes a manual save from a month-rollover "move to savings".
 * Amounts/dates are plaintext (not PII), consistent with Goal.contributions.
 */
const savingsEntrySchema = new mongoose.Schema({
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount:    { type: Number, required: true, min: [0.01, 'Amount must be positive'] },
    direction: { type: String, required: true, enum: ['deposit', 'withdraw'] },
    source:    { type: String, default: 'manual', enum: ['manual', 'rollover'] },
    note:      { type: String, trim: true },
    date:      { type: Date, default: Date.now },
}, { timestamps: true });

savingsEntrySchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('SavingsEntry', savingsEntrySchema);
