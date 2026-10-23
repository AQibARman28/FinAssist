/**
 * RefreshToken — server-side record of an issued refresh token.
 *
 * We never store the plaintext refresh token. The cookie holds the
 * plaintext; the DB holds sha256(plaintext). Two reasons:
 *   1. DB exfiltration alone cannot impersonate a session.
 *   2. tokenHash is index-friendly (deterministic per token).
 *
 * Lifecycle:
 *   - Created at login or refresh: { userId, tokenHash, expiresAt }.
 *   - Used at refresh: looked up by hash, checked not revoked + not expired,
 *     then revokedAt is set and a fresh row is inserted (rotation).
 *   - Used at logout: looked up by hash, revokedAt is set.
 *   - Mongo TTL on expiresAt purges expired rows automatically.
 */

const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // Every token minted by rotating another shares its familyId — one
    // sign-in on one device. Replaying a rotated token revokes the family.
    familyId:   { type: String, index: true },
    rememberMe: { type: Boolean, default: false },
    createdAt: { type: Date,   default: Date.now },
    // Mongo TTL monitor will delete the row when `expiresAt` is reached.
    expiresAt: { type: Date,   required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date,   default: null },
    // Why it was revoked: 'rotated' (normal refresh), 'logout', 'reuse'
    // (family killed after replay) or 'revoke_all' (password change/reset).
    revokedReason: { type: String, default: null },
});

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
