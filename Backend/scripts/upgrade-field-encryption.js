/**
 * Re-encrypts v1 field ciphertexts and RSA notes as owner+field bound v2
 * values (see utils/dataMigrations.js). Idempotent.
 *
 *   node scripts/upgrade-field-encryption.js                        # dry run
 *   node scripts/upgrade-field-encryption.js --apply                # upgrade
 *   node scripts/upgrade-field-encryption.js --apply --seal-plaintext
 *        # also seal values that aren't ciphertext (pre-encryption data) —
 *        # review the dry run's "unreadable" list before using this
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { checkStartupConfig } = require('../utils/config');
const { upgradeFieldEncryption } = require('../utils/dataMigrations');

(async () => {
    const { errors } = checkStartupConfig(process.env);
    if (errors.length) throw new Error(errors.join(' '));
    const apply = process.argv.includes('--apply');
    const sealPlaintext = process.argv.includes('--seal-plaintext');

    await mongoose.connect(process.env.MONGO_URI);
    const r = await upgradeFieldEncryption({ apply, sealPlaintext });
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${r.users} user(s); ${r.upgraded} value(s) ${apply ? 'upgraded' : 'to upgrade'}; ${r.sealed} plaintext value(s) sealed; ${r.unreadable} unreadable.`);
    for (const item of r.unreadableItems) console.log(`  unreadable: ${item.kind} ${item.id} ${item.field}`);
    await mongoose.disconnect();
})().catch((err) => {
    console.error('upgrade-field-encryption failed:', err.message);
    process.exit(1);
});
