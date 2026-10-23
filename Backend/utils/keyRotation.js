/**
 * keyRotation.js — master-key rotation without downtime.
 *
 * 1. Set MASTER_ENCRYPTION_KEY_PREVIOUS to the current key and
 *    MASTER_ENCRYPTION_KEY to a new one; deploy. Both keys now unwrap.
 * 2. Run `npm run rotate:master-key -- --apply`: every user's data key is
 *    re-wrapped under the new master key. Field ciphertexts don't change —
 *    they are encrypted with the per-user data keys, which stay the same.
 * 3. Once it reports 0 left to re-wrap, remove MASTER_ENCRYPTION_KEY_PREVIOUS.
 */

const { masterDecrypt, masterEncrypt, needsRewrap } = require('./encryption');

async function rewrapAllDataKeys({ apply = false } = {}) {
    const User = require('../models/User');
    const users = await User.find({ encryptedDataKey: { $type: 'string' } }).select('_id encryptedDataKey').lean();

    let rewrapped = 0;
    for (const u of users) {
        if (!needsRewrap(u.encryptedDataKey) || !apply) continue;
        const raw = await masterDecrypt(u.encryptedDataKey);
        const next = await masterEncrypt(raw);
        // Conditional on the old value so a concurrent change is never clobbered.
        const r = await User.updateOne({ _id: u._id, encryptedDataKey: u.encryptedDataKey }, { $set: { encryptedDataKey: next } });
        rewrapped += r.modifiedCount;
    }
    return { scanned: users.length, rewrapped };
}

module.exports = { rewrapAllDataKeys };
