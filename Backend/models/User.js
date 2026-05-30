const mongoose = require('mongoose');
const crypto = require('node:crypto');
const native = require('../utils/nativeCrypto');

const userSchema = new mongoose.Schema({
    // PII — stored AES-256-GCM encrypted with per-user dataKey
    name:  { type: String, required: [true, 'Name is required'] },
    email: { type: String, required: [true, 'Email is required'] },

    // Keyed HMAC-SHA256(email, EMAIL_HASH_SECRET) — fast unique lookup
    // without exposing email contents (SEC-1 Phase 2).
    emailHash: { type: String, required: true, unique: true },

    // Password hash. Format depends on passwordHashScheme:
    //   'argon2id': argon2.hash() encoded string ($argon2id$v=19$m=…)
    //   'pbkdf2'  : legacy `pbkdf2-sha256$<iter>$<saltHex>$<dkHex>`
    password: { type: String, required: [true, 'Password is required'], minlength: 6 },
    passwordHashScheme: { type: String, enum: ['pbkdf2', 'argon2id'], default: 'argon2id' },

    currency: { type: String, default: 'BDT' },

    // ── Email verification (SEC-1 Phase 4) ──────────────────────────────────
    // Existing users (pre-Phase-4) are migrated to emailVerified=true via
    // Backend/scripts/migrate-existing-users.js. New users default to false
    // and cannot log in until they click the verification link emailed at
    // registration. emailVerificationToken is sha256(plaintext); the
    // plaintext lives only in the email.
    emailVerified:              { type: Boolean, default: false },
    // sha256 of the 6-digit verification code (the code itself lives only in
    // the email). emailVerificationAttempts caps wrong guesses before the code
    // is invalidated and a resend is required.
    emailVerificationToken:     { type: String,  default: null },
    emailVerificationExpiresAt: { type: Date,    default: null },
    emailVerificationAttempts:  { type: Number,  default: 0 },

    // ── Login lockout (SEC-1 Phase 4) ───────────────────────────────────────
    // Counters reset on every successful login. After 5 failures inside the
    // sliding window, lockedUntil is set to (now + 15 min * 2^lockoutCount),
    // i.e. exponential backoff on repeat lockouts.
    failedLoginAttempts:       { type: Number, default: 0 },
    firstFailedLoginAt:        { type: Date,   default: null },
    lockedUntil:               { type: Date,   default: null },
    lockoutCount:              { type: Number, default: 0 },

    // ── TOTP rate-limit + replay protection (SEC-1 Phase 4) ─────────────────
    failedTotpAttempts: { type: Number, default: 0 },
    firstFailedTotpAt:  { type: Date,   default: null },
    totpLockedUntil:    { type: Date,   default: null },
    // Recently-consumed TOTP codes; checked at verify time to block replay
    // inside the 90-second window. Pruned on every verify.
    recentTotpCodes: [{
        code:   { type: String, required: true },
        usedAt: { type: Date,   default: Date.now },
    }],

    // ── Key Management ──────────────────────────────────────────────────────
    encryptedDataKey: { type: String },
    rsaPublicKey:           { type: String },
    encryptedRsaPrivateKey: { type: String },
    eccPublicKey:           { type: String },
    encryptedEccPrivateKey: { type: String },
    keyVersion: { type: Number, default: 1 },

    // ── Two-Factor Authentication (TOTP) ────────────────────────────────────
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret:  { type: String }, // base32 secret, AES-encrypted with dataKey

    // ── RBAC ────────────────────────────────────────────────────────────────
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await native.hashPassword(this.password);
    this.passwordHashScheme = 'argon2id';
    next();
});

// Verify a candidate password against the stored hash. Returns Boolean.
// Branches on passwordHashScheme:
//   'argon2id' (or undefined with an argon2-prefixed hash) → native argon2 verify
//   'pbkdf2'   (or undefined with the legacy prefix)       → Node PBKDF2 verify
userSchema.methods.comparePassword = async function (candidate) {
    if (typeof candidate !== 'string') return false;

    const scheme = this.passwordHashScheme
        || (this.password?.startsWith('$argon2')          ? 'argon2id'
        :  this.password?.startsWith('pbkdf2-sha256$')    ? 'pbkdf2'
        :  null);

    if (scheme === 'argon2id') return native.verifyPassword(candidate, this.password);
    if (scheme === 'pbkdf2')   return _verifyPbkdf2Legacy(candidate, this.password);
    return false;
};

function _verifyPbkdf2Legacy(candidate, stored) {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isInteger(iterations) || iterations < 1) return false;
    const salt = Buffer.from(parts[2], 'hex');
    const expected = Buffer.from(parts[3], 'hex');
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = crypto.pbkdf2Sync(candidate, salt, iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(derived, expected);
}

module.exports = mongoose.model('User', userSchema);
