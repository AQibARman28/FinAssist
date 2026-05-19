const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const crypto = require('node:crypto');
const connectDB = require('./config/db');
const { csrfGuard } = require('./middleware/csrf');

dotenv.config();

// ── Startup secret validation (SEC-1 Phase 5) ─────────────────────────────────
// Refuse to boot if any of the security-critical secrets is missing or too
// short. 32 bytes (64 hex chars) is the minimum for AES-256 / HS256 over
// short payloads; we apply the same floor to all of them.
//
// REFRESH_TOKEN_SECRET is intentionally omitted — refresh tokens in this app
// are opaque random 32-byte blobs hashed with SHA-256 for storage (see
// utils/sessions.js / models/RefreshToken.js); there is no signing secret.
(function _checkSecrets() {
    const required = ['JWT_SECRET', 'MASTER_ENCRYPTION_KEY', 'EMAIL_HASH_SECRET'];
    const missing  = [];
    const tooShort = [];
    for (const name of required) {
        const v = process.env[name];
        if (!v) missing.push(name);
        else if (Buffer.byteLength(v, 'utf8') < 32) tooShort.push(name);
    }
    if (missing.length || tooShort.length) {
        const msg = [
            'Refusing to start.',
            missing.length  ? `Missing env vars: ${missing.join(', ')}.`  : '',
            tooShort.length ? `Too-short (need ≥32 bytes): ${tooShort.join(', ')}.` : '',
            'Set them in .env (see .env.example).',
        ].filter(Boolean).join(' ');
        throw new Error(msg);
    }
})();

connectDB();

const app = express();

// Trust the first hop. Production deploys typically run behind one reverse
// proxy (nginx, CloudFront, AWS ALB, etc.); without this, req.ip and the
// rate-limit keyGenerator see the proxy's IP and rate-limit every user
// together. If your deploy has zero hops, change to `false`; for multiple
// trusted hops, pass an integer.
app.set('trust proxy', 1);

// ── Security headers (SEC-1 Phase 5) ─────────────────────────────────────────
// Explicit CSP + HSTS. Tightened from helmet defaults:
//   - script-src 'self'      — no inline scripts, no eval. Next standalone
//                              bundle is same-origin; the API never serves
//                              HTML, so this is purely belt-and-suspenders.
//   - style-src 'self' 'unsafe-inline' — Tailwind generates inline styles in
//                              dev; revisit when we ship a CSP nonce-aware
//                              build (out of scope this sprint).
//   - frame-ancestors 'none' — clickjacking protection (supersedes the older
//                              X-Frame-Options header in modern browsers).
//   - object-src 'none'      — kills <object>/<embed>/<applet> vectors.
//   - default-src 'self'     — catch-all for everything else.
// HSTS: 1 year, includeSubDomains, preload-eligible.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", 'data:'],
            connectSrc:     ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc:      ["'none'"],
            baseUri:        ["'self'"],
            formAction:     ["'self'"],
        },
    },
    hsts: {
        maxAge:            31_536_000, // 1 year
        includeSubDomains: true,
        preload:           true,
    },
}));

// ── Request ID + request logging (SEC-1 Phase 5) ─────────────────────────────
// Assign a stable id per request so log lines and any error sanitized for
// the client can be cross-referenced. Set as a response header for the
// browser/curl to capture too.
app.use((req, res, next) => {
    req.requestId = crypto.randomBytes(8).toString('hex');
    res.set('X-Request-Id', req.requestId);
    next();
});

morgan.token('id', (req) => req.requestId);
app.use(morgan(
    process.env.NODE_ENV === 'production'
        ? ':remote-addr [:id] :method :url :status :response-time ms'
        : 'dev'
));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookie parser — populates req.cookies for the access/refresh/temp session cookies
app.use(cookieParser());

// CORS — allow any localhost in dev, restrict to FRONTEND_URL in production
const corsOrigin = process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : (origin, callback) => {
        if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    };

app.use(cors({ origin: corsOrigin, credentials: true }));

// Global rate limiter — 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' }
});

// Stricter limiter for auth endpoints — 10/15min per IP. Per-account lockout
// (Phase 4) handles the per-user dimension; this is the per-IP layer.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many auth attempts from this IP, please try again later.' }
});

app.use('/api', globalLimiter);

// CSRF guard — requires X-Requested-With: FinAssist on every state-changing
// (non-safe-method) /api request.
app.use('/api', csrfGuard);

// Routes
app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/expenses', require('./routes/expenseRoutes'));
app.use('/api/budgets', require('./routes/budgetRoutes'));
app.use('/api/goals', require('./routes/goalsRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'FINASSIST API is running',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler with prod sanitization (SEC-1 Phase 5) ──────────────
// Production: never leak stack traces, error messages, or any internal
// detail to the wire — return only { error, requestId }. The full error
// (including stack) lands in stderr keyed by requestId for forensics.
// Dev: keep returning the stack so the developer sees what broke.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const requestId = req.requestId || '-';
    const status = err.status || 500;

    console.error(`error [${requestId}] ${req.method} ${req.originalUrl} status=${status}:`, err.stack || err.message);

    if (process.env.NODE_ENV === 'production') {
        return res.status(status >= 500 ? 500 : status).json({
            success: false,
            error: 'Internal server error',
            requestId,
        });
    }

    res.status(status).json({
        success: false,
        message: err.message || 'Internal Server Error',
        requestId,
        stack: err.stack,
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`FINASSIST server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

module.exports = app;
