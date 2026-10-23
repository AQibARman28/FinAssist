const mongoose = require('mongoose');

// Connect with bounded backoff and loud, greppable logging.
//
// This used to call process.exit(1) on the first failure, which made a
// database outage indistinguishable from a crashed app: the container died
// during boot, the platform restarted it, and the real reason scrolled past in
// logs that are only retained for a few days. Now we keep retrying and stay
// alive, so /api/health can report `db: disconnected` — the platform marks the
// service unhealthy instead of dead, and the error stays readable in the log.

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 20000];

const connectDB = async () => {
    for (let attempt = 0; ; attempt++) {
        try {
            const conn = await mongoose.connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 10000,
            });
            console.log(`MongoDB Connected: ${conn.connection.host}`);
            return;
        } catch (error) {
            const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
            console.error(`Database connection error (attempt ${attempt + 1}): ${error.message}`);
            console.error(
                `Retrying in ${delay / 1000}s. Check: MONGO_URI is set, the Atlas IP allowlist ` +
                `includes 0.0.0.0/0, and the cluster still exists (a deleted cluster fails DNS lookup).`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
};

// Surface later drops and recoveries. Mongoose reconnects on its own once the
// server is reachable again, so these are informational, not fatal.
mongoose.connection.on('disconnected', () => console.error('MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected'));
mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message));

module.exports = connectDB;
