/**
 * Wraps every remaining legacy PBKDF2 password hash in Argon2id
 * (see utils/legacyPasswords.js). Idempotent.
 *
 *   node scripts/wrap-legacy-password-hashes.js            # dry run
 *   node scripts/wrap-legacy-password-hashes.js --apply    # write
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { wrapAllLegacyHashes } = require('../utils/legacyPasswords');

(async () => {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.MONGO_URI);
    const { scanned, wrapped } = await wrapAllLegacyHashes({ apply });
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${scanned} legacy hash(es) found, ${wrapped} wrapped.`);
    if (!apply && scanned) console.log('Re-run with --apply to wrap them.');
    await mongoose.disconnect();
})().catch((err) => {
    console.error('wrap-legacy-password-hashes failed:', err.message);
    process.exit(1);
});
