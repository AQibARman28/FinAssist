/**
 * scripts/migrate-email-hash.js — one-shot migration for SEC-1 Phase 2.
 *
 * Why
 * ───
 * Before Phase 2, User.emailHash was sha256(email_normalized) — an unkeyed
 * hash. An attacker who exfiltrated the User collection could confirm
 * whether any candidate email was in the user base by hashing it locally
 * and looking up emailHash. Phase 2 switched to keyed HMAC under
 * EMAIL_HASH_SECRET. This script rewrites every existing user's emailHash
 * from the old sha256 to the new HMAC-SHA256 so login (which queries by
 * emailHash) keeps working.
 *
 * Idempotency
 * ───────────
 * The script computes the new HMAC for each user and writes it
 * unconditionally. Running it twice is harmless — the second pass writes
 * the same value. There is no "is this already migrated?" check because
 * (a) sha256 and HMAC outputs are indistinguishable in shape (both 64 hex
 * chars), and (b) the write is idempotent.
 *
 * Usage
 * ─────
 *     # dry run — prints what would change, makes no writes
 *     node Backend/scripts/migrate-email-hash.js --dry-run
 *
 *     # commit
 *     node Backend/scripts/migrate-email-hash.js
 *
 * Deploy ordering (production)
 * ────────────────────────────
 * 1. Roll the new server with the Phase 2 code (hashEmail returns HMAC).
 *    At this point, existing users CANNOT log in because their stored
 *    emailHash is still sha256-based — that's the lookup miss.
 * 2. Immediately run this script against the production DB with
 *    EMAIL_HASH_SECRET set in env.
 * 3. Existing users can log in again.
 *
 * To minimize the login outage, run steps 1+2 in tight sequence (single
 * deploy script). The script reads/decrypts each user's plaintext email
 * via the per-user dataKey (stored encrypted under MASTER_ENCRYPTION_KEY),
 * so all the same envs that the live server needs must be set when the
 * script runs.
 *
 * What it does NOT touch
 * ──────────────────────
 * - The encrypted `email` field (still AES-GCM with the user's dataKey).
 * - Passwords, key bundles, 2FA secrets, currency, any other field.
 *
 * Failure semantics
 * ─────────────────
 * - If a user's email cannot be decrypted (corrupt blob, missing dataKey,
 *   missing MASTER_ENCRYPTION_KEY), the script logs the user `_id` and
 *   skips it. Other users continue. Exit code is non-zero if any user
 *   was skipped.
 * - If EMAIL_HASH_SECRET is missing or malformed, the script throws
 *   loudly before connecting to the DB.
 */

const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('node:path');

// Load .env from the Backend root regardless of cwd.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Pre-flight: the new hash needs EMAIL_HASH_SECRET. encryption.js will
// throw a clear error if it's wrong shape; throw earlier ourselves so the
// operator sees the failure before connecting to the DB.
if (typeof process.env.EMAIL_HASH_SECRET !== 'string' || process.env.EMAIL_HASH_SECRET.length !== 64) {
    console.error('migrate-email-hash: EMAIL_HASH_SECRET must be set to 64 hex chars in .env');
    process.exit(2);
}
if (typeof process.env.MASTER_ENCRYPTION_KEY !== 'string' || process.env.MASTER_ENCRYPTION_KEY.length !== 64) {
    console.error('migrate-email-hash: MASTER_ENCRYPTION_KEY must be set to 64 hex chars in .env');
    process.exit(2);
}

const User = require('../models/User');
const { masterDecrypt, safeDecrypt, hashEmail } = require('../utils/encryption');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`migrate-email-hash: connected (dry-run=${DRY_RUN})`);

    const cursor = User.find({}).cursor();
    let scanned = 0, updated = 0, unchanged = 0, skipped = 0;

    for (let user = await cursor.next(); user; user = await cursor.next()) {
        scanned++;

        // Need plaintext email to compute the new HMAC.
        let plaintextEmail;
        try {
            if (!user.encryptedDataKey) {
                // Legacy unencrypted account — user.email is already plaintext.
                plaintextEmail = user.email;
            } else {
                const rawKey  = await masterDecrypt(user.encryptedDataKey);
                const dataKey = Buffer.from(rawKey, 'hex');
                plaintextEmail = await safeDecrypt(user.email, dataKey);
            }
        } catch (err) {
            console.error(`migrate-email-hash: user ${user._id} — could not recover plaintext email: ${err.message}`);
            skipped++;
            continue;
        }

        if (typeof plaintextEmail !== 'string' || plaintextEmail.length === 0) {
            console.error(`migrate-email-hash: user ${user._id} — plaintext email empty after decrypt`);
            skipped++;
            continue;
        }

        const newHash = await hashEmail(plaintextEmail);
        if (newHash === user.emailHash) {
            unchanged++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`migrate-email-hash: user ${user._id} — would update emailHash`);
            updated++;
            continue;
        }

        await User.updateOne({ _id: user._id }, { $set: { emailHash: newHash } });
        updated++;
    }

    await mongoose.disconnect();

    console.log(`migrate-email-hash: scanned=${scanned} updated=${updated} unchanged=${unchanged} skipped=${skipped}${DRY_RUN ? ' (dry-run, no writes)' : ''}`);

    if (skipped > 0) process.exit(1);
}

main().catch((err) => {
    console.error('migrate-email-hash: fatal error:', err);
    process.exit(3);
});
