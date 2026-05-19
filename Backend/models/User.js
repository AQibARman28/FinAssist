const mongoose = require('mongoose');
const crypto = require('node:crypto');
const native = require('../utils/nativeCrypto');

const userSchema = new mongoose.Schema({
    // PII — stored AES-256-GCM encrypted with per-user dataKey
    name:  { type: String, required: [true, 'Name is required'] },
    email: { type: String, required: [true, 'Email is required'] },

    // SHA-256(email) — used for fast unique lookup without exposing plaintext
    // (Phase 2 migrates to keyed HMAC)
    emailHash: { type: String, required: true, unique: true },

    // Password hash. Format depends on passwordHashScheme:
    //   'argon2id': argon2.hash() encoded string ($argon2id$v=19$m=…)
    //   'pbkdf2'  : legacy `pbkdf2-sha256$<iter>$<saltHex>$<dkHex>`
    password: { type: String, required: [true, 'Password is required'], minlength: 6 },
    passwordHashScheme: { type: String, enum: ['pbkdf2', 'argon2id'], default: 'argon2id' },

    currency: { type: String, default: 'BDT' },

    // ── Key Management ──────────────────────────────────────────────────────
    // Random 32-byte AES key, encrypted with MASTER_ENCRYPTION_KEY
    encryptedDataKey: { type: String },

    // RSA-2048: public key PEM (SPKI), private key PEM (PKCS#8) encrypted
    // with the per-user dataKey. Legacy users have hex-JSON here and are
    // migrated to PEM at next login (see keyManagement.regenerateUserKeyBundle).
    rsaPublicKey:           { type: String },
    encryptedRsaPrivateKey: { type: String },

    // ECC P-256: same shape as RSA above
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
// Lazy re-hash to argon2id happens in the login controller after a successful
// legacy verify.
userSchema.methods.comparePassword = async function (candidate) {
    if (typeof candidate !== 'string') return false;

    const scheme = this.passwordHashScheme
        || (this.password?.startsWith('$argon2')          ? 'argon2id'
        :  this.password?.startsWith('pbkdf2-sha256$')    ? 'pbkdf2'
        :  null);

    if (scheme === 'argon2id') {
        return native.verifyPassword(candidate, this.password);
    }
    if (scheme === 'pbkdf2') {
        return _verifyPbkdf2Legacy(candidate, this.password);
    }
    return false;
};

// Verify against the legacy Python format: `pbkdf2-sha256$<iter>$<saltHex>$<dkHex>`.
// Uses Node's native PBKDF2 (no Python subprocess). Constant-time compare.
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
