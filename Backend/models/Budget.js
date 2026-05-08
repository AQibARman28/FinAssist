const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: {
        type: String, required: [true, 'Category is required'],
        enum: ['Food', 'Transport', 'Entertainment', 'Shopping', 'Bills', 'Healthcare', 'Education', 'Other']
    },
    limit:  { type: Number, required: [true, 'Budget limit is required'], min: [0, 'Must be positive'] },
    spent:  { type: Number, default: 0, min: [0, 'Cannot be negative'] },
    month:  { type: Number, required: true, min: 1, max: 12 },
    year:   { type: Number, required: true, min: 2020 },
    alertThreshold: { type: Number, default: 80, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },

    // HMAC-SHA256 over {limit, category, month, year, userId}
    hmac: { type: String },

    // ECDSA-P256 signature over {category, limit, month, year} — set on creation only, never regenerated on update
    signature: { type: String },
}, { timestamps: true });

budgetSchema.index({ user: 1, category: 1, month: 1, year: 1 }, { unique: true });

budgetSchema.virtual('remainingAmount').get(function () { return Math.max(0, this.limit - this.spent); });
budgetSchema.virtual('usagePercentage').get(function () { return this.limit > 0 ? Math.round((this.spent / this.limit) * 100) : 0; });
budgetSchema.virtual('isOverLimit').get(function ()    { return this.spent > this.limit; });
budgetSchema.virtual('isNearLimit').get(function ()    { return (this.spent / this.limit) * 100 >= this.alertThreshold; });
budgetSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Budget', budgetSchema);
