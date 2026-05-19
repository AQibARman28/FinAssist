const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
    amount: { type: Number, required: [true, 'Amount is required'], min: [0, 'Amount must be positive'] },

    // Part 3: category is now a reference to the user-owned Category
    // collection (was a String enum in earlier phases). The controller
    // calls utils/categoryGuard.assertCategoryOwnedAndTyped before insert
    // to verify the referenced row exists, belongs to the requesting user,
    // is not archived, and has type 'expense' (or 'both').
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },

    // Stored AES-256-GCM encrypted.
    description: { type: String, required: [true, 'Description is required'] },
    date:        { type: Date,   required: true, default: Date.now },

    // ECDSA-P256 server-attestation over canonical {amount, category} —
    // category serializes as its hex string via Mongoose ObjectId.toJSON,
    // so sign and verify produce identical canonical forms. Set on
    // creation; NOT regenerated on update. See docs/decisions/SEC-1-ecdsa.md.
    serverAttestation: { type: String },

    // RSA-2048-OAEP encrypted with the user's RSA public key (optional).
    note: { type: String },

    // Part 6: present so utils/recurring.materializeRecurring can mark
    // generated instances. Existing one-off rows leave this null. A future
    // part may add isRecurring/recurringFrequency to Expense — declaring
    // this now avoids a second schema change at that point.
    parentRecurringId: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', default: null },
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);
