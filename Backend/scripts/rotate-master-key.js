/**
 * Re-wraps every user's data key under the current MASTER_ENCRYPTION_KEY
 * (see utils/keyRotation.js for the full procedure). Idempotent.
 *
 *   node scripts/rotate-master-key.js            # dry run: how many need it
 *   node scripts/rotate-master-key.js --apply    # re-wrap
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { checkStartupConfig } = require('../utils/config');
const { rewrapAllDataKeys } = require('../utils/keyRotation');
const { masterKeyId } = require('../utils/encryption');

(async () => {
    const { errors } = checkStartupConfig(process.env);
    if (errors.length) throw new Error(errors.join(' '));
    const apply = process.argv.includes('--apply');

    await mongoose.connect(process.env.MONGO_URI);
    const { scanned, rewrapped } = await rewrapAllDataKeys({ apply });
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${scanned} data key(s) scanned, ${rewrapped} re-wrapped under master key ${masterKeyId()}.`);
    if (!apply) console.log('Re-run with --apply to re-wrap.');
    await mongoose.disconnect();
})().catch((err) => {
    console.error('rotate-master-key failed:', err.message);
    process.exit(1);
});
