const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount:   { type: Number, required: [true, 'Amount is required'], min: [0, 'Amount must be positive'] },
    category: {
        type: String, required: [true, 'Category is required'],
        enum: ['Food', 'Transport', 'Entertainment', 'Shopping', 'Bills', 'Healthcare', 'Education', 'Other']
    },
    // Stored AES-256-GCM encrypted
    description: { type: String, required: [true, 'Description is required'] },
    date:         { type: Date, required: true, default: Date.now },
    isAutoCategories: { type: Boolean, default: false },

    // ECDSA-P256 signature over canonical {amount, category}, base64-DER.
    // Set on creation; NOT regenerated on update — see docs/decisions/SEC-1-ecdsa.md.
    // This is server-attestation (server holds the private key), not user
    // non-repudiation. Phase 2 renamed from `signature` to make that honest.
    serverAttestation: { type: String },

    // RSA-2048-OAEP encrypted with the user's RSA public key (optional)
    note: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);
