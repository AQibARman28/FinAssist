const mongoose = require('mongoose');
const { hashPassword, verifyPassword } = require('../utils/scratch/pbkdf2');

const userSchema = new mongoose.Schema({
    // PII — stored AES-256-GCM encrypted with per-user dataKey
    name:  { type: String, required: [true, 'Name is required'] },
    email: { type: String, required: [true, 'Email is required'] },

    // SHA-256(email) — used for fast unique lookup without exposing plaintext
    emailHash: { type: String, required: true, unique: true },

    // PBKDF2-SHA256 hash, 100,000 iterations (stored format: pbkdf2-sha256$<iter>$<saltHex>$<dkHex>)
    password: { type: String, required: [true, 'Password is required'], minlength: 6 },
    currency: { type: String, default: 'BDT' },

    // ── Key Management ──────────────────────────────────────────────────────
    // Random 32-byte AES key, encrypted with MASTER_ENCRYPTION_KEY
    encryptedDataKey: { type: String },

    // RSA-2048: public key in PEM (plaintext), private key AES-encrypted
    rsaPublicKey:           { type: String },
    encryptedRsaPrivateKey: { type: String },

    // ECC P-256: public key in PEM (plaintext), private key AES-encrypted
    eccPublicKey:           { type: String },
    encryptedEccPrivateKey: { type: String },

    keyVersion: { type: Number, default: 1 },

    // ── Two-Factor Authentication (TOTP) ────────────────────────────────────
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret:  { type: String }, // TOTP secret, AES-encrypted with dataKey

    // ── RBAC ────────────────────────────────────────────────────────────────
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = hashPassword(this.password);
    next();
});

userSchema.methods.comparePassword = async function (candidate) {
    return verifyPassword(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
