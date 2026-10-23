/**
 * Establishes the attestation baseline (see utils/dataMigrations.js): signs
 * records that don't currently verify over their current values. Run once,
 * after upgrade-field-encryption, when deploying the data-at-rest hardening.
 *
 *   node scripts/reattest-records.js            # dry run: lists every record it would sign
 *   node scripts/reattest-records.js --apply    # sign them
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { checkStartupConfig } = require('../utils/config');
const { reattestRecords } = require('../utils/dataMigrations');

(async () => {
    const { errors } = checkStartupConfig(process.env);
    if (errors.length) throw new Error(errors.join(' '));
    const apply = process.argv.includes('--apply');

    await mongoose.connect(process.env.MONGO_URI);
    const r = await reattestRecords({ apply });
    for (const n of r.needing) console.log(`  ${n.status.padEnd(7)} ${n.kind} ${n.id}`);
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${r.checked} record(s) checked; ${r.needing.length} without a valid attestation; ${r.resigned} signed.`);
    if (!apply && r.needing.length) console.log('Review the list above, then re-run with --apply.');
    await mongoose.disconnect();
})().catch((err) => {
    console.error('reattest-records failed:', err.message);
    process.exit(1);
});
