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

    // HMAC-SHA256 over {amount, category, plaintext-description, date, userId}
    hmac: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);
