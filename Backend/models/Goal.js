const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: [true, 'Goal title is required'],
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    targetAmount: {
        type: Number,
        required: [true, 'Target amount is required'],
        min: [1, 'Target amount must be positive']
    },
    currentAmount: {
        type: Number,
        default: 0,
        min: [0, 'Current amount cannot be negative']
    },
    targetDate: {
        type: Date,
        required: [true, 'Target date is required']
    },
    goalType: {
        type: String,
        required: [true, 'Goal type is required'],
        enum: ['Emergency Fund', 'Vacation', 'Car', 'House', 'Education', 'Investment', 'Other']
    },
    status: {
        type: String,
        enum: ['Active', 'Completed', 'Paused'],
        default: 'Active'
    },
    contributions: [{
        amount: {
            type: Number,
            required: true,
            min: [0, 'Contribution amount must be positive']
        },
        date: {
            type: Date,
            default: Date.now
        },
        note: {
            type: String,
            trim: true
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

goalSchema.pre('save', function (next) {
    this.updatedAt = Date.now();

    // Update current amount based on contributions
    this.currentAmount = this.contributions.reduce((total, contribution) => {
        return total + contribution.amount;
    }, 0);

    // Auto-complete goal if target reached
    if (this.currentAmount >= this.targetAmount && this.status === 'Active') {
        this.status = 'Completed';
    }

    next();
});

goalSchema.virtual('progressPercentage').get(function () {
    return this.targetAmount > 0 ? Math.min(100, Math.round((this.currentAmount / this.targetAmount) * 100)) : 0;
});

goalSchema.virtual('remainingAmount').get(function () {
    return Math.max(0, this.targetAmount - this.currentAmount);
});

goalSchema.virtual('daysRemaining').get(function () {
    const today = new Date();
    const timeDiff = this.targetDate.getTime() - today.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
});

goalSchema.virtual('isOverdue').get(function () {
    return new Date() > this.targetDate && this.status !== 'Completed';
});

goalSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Goal', goalSchema);
