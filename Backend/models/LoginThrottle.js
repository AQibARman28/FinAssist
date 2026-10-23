/**
 * LoginThrottle — failed sign-in counters keyed by the email's blind index
 * (emailHash), whether or not an account exists for that email. Keeping this
 * off the User document is what lets known and unknown emails behave
 * identically, so the throttle can't be used to discover accounts.
 *
 * Rows expire 24 h after their last update via a TTL index.
 */

const mongoose = require('mongoose');

const loginThrottleSchema = new mongoose.Schema({
    key:         { type: String, required: true, unique: true },
    failures:    { type: Number, default: 0 },
    windowStart: { type: Date,   default: null },
    lockedUntil: { type: Date,   default: null },
    lockouts:    { type: Number, default: 0 },
    updatedAt:   { type: Date,   default: Date.now, index: { expireAfterSeconds: 24 * 3600 } },
});

module.exports = mongoose.model('LoginThrottle', loginThrottleSchema);
