const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Stored AES-256-GCM encrypted
    title:       { type: String, required: [true, 'Goal title is required'] },
    description: { type: String },

    targetAmount:  { type: Number, required: [true, 'Target amount is required'], min: [1, 'Must be positive'] },
    currentAmount: { type: Number, default: 0, min: [0, 'Cannot be negative'] },

    // The savings cadence a goal belongs to. Drives the Monthly/Yearly toggle
    // on the goals page and which savings pool an allocation draws from.
    period: { type: String, enum: ['monthly', 'yearly'], required: true, default: 'monthly' },

    // Optional now (was required). A free-named goal needs neither a fixed type
    // nor an explicit deadline — targetDate is auto-derived (end of period) on
    // create and used only for display/forecast. goalType defaults to 'Other'
    // and is retained for back-compat + the ECDSA attestation payload.
    targetDate:    { type: Date },
    goalType: {
        type: String, default: 'Other',
        enum: ['Emergency Fund', 'Vacation', 'Car', 'House', 'Education', 'Investment', 'Other']
    },
    status: { type: String, enum: ['Active', 'Completed', 'Paused'], default: 'Active' },

    // GOAL-1: user-set rank used as a tiebreaker when allocating surplus
    // across goals (higher = funded sooner within a tier). Default 0.
    priority: { type: Number, default: 0, min: 0 },
    contributions: [{
        amount: { type: Number, required: true, min: [0, 'Must be positive'] },
        date:   { type: Date, default: Date.now },
        note:   { type: String, trim: true }
    }],

    // ECDSA-P256 server-attestation over canonical
    // {goalType, targetAmount, title-plaintext}, base64-DER. Set on creation;
    // NOT regenerated on update. See docs/decisions/SEC-1-ecdsa.md.
    serverAttestation: { type: String },

    // Top-level private note, RSA-2048-OAEP encrypted with the user's RSA public key (optional)
    note: { type: String },
}, { timestamps: true });

goalSchema.pre('save', function (next) {
    this.currentAmount = this.contributions.reduce((t, c) => t + c.amount, 0);
    if (this.currentAmount >= this.targetAmount && this.status === 'Active') this.status = 'Completed';
    next();
});

goalSchema.virtual('progressPercentage').get(function () {
    return this.targetAmount > 0 ? Math.min(100, Math.round((this.currentAmount / this.targetAmount) * 100)) : 0;
});
goalSchema.virtual('remainingAmount').get(function () { return Math.max(0, this.targetAmount - this.currentAmount); });
goalSchema.virtual('daysRemaining').get(function () {
    if (!this.targetDate) return null;
    return Math.ceil((this.targetDate.getTime() - Date.now()) / (1000 * 3600 * 24));
});
goalSchema.virtual('isOverdue').get(function () {
    if (!this.targetDate) return false;
    return Date.now() > this.targetDate && this.status !== 'Completed';
});
goalSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Goal', goalSchema);
