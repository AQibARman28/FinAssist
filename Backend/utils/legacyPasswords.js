/**
 * legacyPasswords.js — hash wrapping for pre-SEC-1 passwords.
 *
 * Before SEC-1, passwords were hashed by the hand-written Python PBKDF2 at
 * 10,000 iterations. Those hashes upgrade to plain Argon2id on the user's next
 * sign-in, but a dormant account would keep the weak hash indefinitely. So the
 * stored PBKDF2 output is wrapped in Argon2id now:
 *
 *   wrap$pbkdf2-sha256$<iterations>$<saltHex>$<dkLen>$<argon2id(dkHex)>
 *
 * Verifying recomputes PBKDF2 from the candidate, then checks the result with
 * Argon2id. The original PBKDF2 output is no longer stored anywhere.
 */

const crypto = require('node:crypto');
const native = require('./nativeCrypto');

const LEGACY_RE  = /^pbkdf2-sha256\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/;
const WRAPPED_RE = /^wrap\$pbkdf2-sha256\$(\d+)\$([0-9a-f]+)\$(\d+)\$(\$argon2id\$.+)$/;

async function wrapLegacyPbkdf2(stored) {
    const m = LEGACY_RE.exec(stored);
    if (!m) throw new Error('wrapLegacyPbkdf2: not a legacy pbkdf2-sha256 hash');
    const [, iterations, saltHex, dkHex] = m;
    const outer = await native.hashPassword(dkHex);
    return `wrap$pbkdf2-sha256$${iterations}$${saltHex}$${dkHex.length / 2}$${outer}`;
}

async function verifyWrapped(candidate, stored) {
    const m = WRAPPED_RE.exec(stored);
    if (!m || typeof candidate !== 'string') return false;
    const [, iterations, saltHex, dkLen, outer] = m;
    const dk = crypto.pbkdf2Sync(candidate, Buffer.from(saltHex, 'hex'), parseInt(iterations, 10), parseInt(dkLen, 10), 'sha256');
    return native.verifyPassword(dk.toString('hex'), outer);
}

// Wraps every remaining legacy hash. Writes with updateOne so the User
// pre-save hook (which would re-hash `password`) never sees the value.
async function wrapAllLegacyHashes({ apply = false } = {}) {
    const User = require('../models/User');
    const legacy = await User.find({
        $or: [{ passwordHashScheme: 'pbkdf2' }, { password: /^pbkdf2-sha256\$/ }],
    }).select('_id password').lean();

    let wrapped = 0;
    for (const u of legacy) {
        if (!LEGACY_RE.test(u.password)) continue;
        if (!apply) continue;
        const next = await wrapLegacyPbkdf2(u.password);
        const r = await User.updateOne(
            { _id: u._id, password: u.password },
            { $set: { password: next, passwordHashScheme: 'pbkdf2-argon2id' } },
        );
        wrapped += r.modifiedCount;
    }
    return { scanned: legacy.length, wrapped };
}

module.exports = { wrapLegacyPbkdf2, verifyWrapped, wrapAllLegacyHashes, WRAPPED_RE };
