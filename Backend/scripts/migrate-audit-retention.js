/**
 * Applies the AuditLog retention TTL to an existing database. MongoDB won't
 * change the options of an index that already exists, so this rebuilds the
 * AuditLog indexes from the schema (syncIndexes drops the old createdAt index
 * and creates the TTL one). Safe to re-run.
 *
 *   node scripts/migrate-audit-retention.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const dropped = await AuditLog.syncIndexes();
    console.log(`AuditLog indexes in sync${dropped.length ? ` (rebuilt: ${dropped.join(', ')})` : ''}.`);
    await mongoose.disconnect();
})().catch((err) => {
    console.error('migrate-audit-retention failed:', err.message);
    process.exit(1);
});
