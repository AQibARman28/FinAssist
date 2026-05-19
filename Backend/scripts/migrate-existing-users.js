/**
 * scripts/migrate-existing-users.js — SEC-1 Phase 4.
 *
 * Phase 4 introduced `emailVerified` (default false) on the User schema.
 * Existing users predate the verification flow, so setting them to the
 * schema default would lock them all out. This one-shot script marks every
 * user whose `emailVerified` field is missing OR not explicitly true as
 * verified.
 *
 * Idempotent: subsequent runs find no users to update.
 * Supports --dry-run.
 *
 * Usage:
 *     node Backend/scripts/migrate-existing-users.js --dry-run
 *     node Backend/scripts/migrate-existing-users.js
 */

const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('node:path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`migrate-existing-users: connected (dry-run=${DRY_RUN})`);

    const filter = { $or: [
        { emailVerified: { $exists: false } },
        { emailVerified: { $ne: true } },
    ] };

    const candidates = await User.countDocuments(filter);
    console.log(`migrate-existing-users: ${candidates} user(s) need migration`);

    if (DRY_RUN || candidates === 0) {
        await mongoose.disconnect();
        return;
    }

    const result = await User.updateMany(filter, { $set: { emailVerified: true } });
    console.log(`migrate-existing-users: matched=${result.matchedCount} modified=${result.modifiedCount}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('migrate-existing-users: fatal error:', err);
    process.exit(1);
});
