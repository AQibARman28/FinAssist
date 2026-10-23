/**
 * index.js — boots the API: validates configuration, connects to MongoDB and
 * starts listening. The Express app itself is built in app.js.
 */

const dotenv = require('dotenv');
dotenv.config();

const { checkStartupConfig } = require('./utils/config');

// ── Startup configuration check ───────────────────────────────────────────────
// Refuse to boot on missing or malformed secrets, or an unsafe production
// posture (see utils/config.js for the rules).
const { errors, warnings } = checkStartupConfig(process.env);
for (const w of warnings) console.warn(`config warning: ${w}`);
if (errors.length) {
    throw new Error(['Refusing to start.', ...errors, 'Set them in .env (see .env.example).'].join(' '));
}

const connectDB = require('./config/db');
const { createApp } = require('./app');

connectDB();

const app = createApp();
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`FINASSIST server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

module.exports = app;
