/**
 * app.js — builds the Express app. index.js boots it (config check, DB,
 * listen); tests build it directly with supertest. Everything env-driven is
 * read when createApp() runs, so a test can change env and build a new app.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { csrfGuard } = require('./middleware/csrf');
const { proxyGuard } = require('./middleware/proxyGuard');

// Endpoints that take a credential or a one-time code. They get the strict
// per-IP limit; session upkeep (/refresh, /logout, /profile, 2FA management)
// does not, so several open tabs can't lock a user out of their own session.
const CREDENTIAL_PATHS = [
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/verify-code',
    '/api/auth/resend-code',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/2fa/verify',
    '/api/auth/profile/email/confirm',
];

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

function createApp() {
    const app = express();
    const isProd = process.env.NODE_ENV === 'production';

    // Number of reverse-proxy hops in front of this app. Production is
    // browser -> Vercel (which proxies /api/*) -> Render's load balancer ->
    // here, which is TWO hops. Direct calls to the Render URL are refused by
    // proxyGuard when PROXY_SHARED_SECRET is set, so X-Forwarded-For can't be
    // forged from outside. Override for other topologies:
    //   TRUST_PROXY=0  no proxy at all (bare metal / localhost)
    //   TRUST_PROXY=1  one proxy (docker-compose behind the Next container)
    app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '2', 10));

    // ── Security headers ──────────────────────────────────────────────────────
    // Explicit CSP + HSTS for API responses. The pages users load get their own
    // CSP from the Next proxy (views/src/proxy.ts).
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

    // ── Request ID + request logging ──────────────────────────────────────────
    app.use((req, res, next) => {
        req.requestId = crypto.randomBytes(8).toString('hex');
        res.set('X-Request-Id', req.requestId);
        next();
    });

    morgan.token('id', (req) => req.requestId);
    if (process.env.NODE_ENV !== 'test') {
        app.use(morgan(isProd ? ':remote-addr [:id] :method :url :status :response-time ms' : 'dev'));
    }

    // Only the FinAssist frontend proxy may call the API (no-op when unset).
    app.use('/api', proxyGuard(process.env.PROXY_SHARED_SECRET));

    // Body parsers. No FinAssist payload comes near 100 kB; the old 10 MB cap
    // let each allowed request carry a large parse job.
    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));

    app.use(cookieParser());

    // CORS — allow any localhost in dev, restrict to FRONTEND_URL in production
    const corsOrigin = isProd
        ? process.env.FRONTEND_URL
        : (origin, callback) => {
            if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) callback(null, true);
            else callback(new Error('Not allowed by CORS'));
        };
    app.use(cors({ origin: corsOrigin, credentials: true }));

    // ── Rate limits ───────────────────────────────────────────────────────────
    // Production caps are strict; dev caps are loose for hot-reload iteration.
    // All are env-overridable. Per-account sign-in throttling lives in
    // utils/loginThrottle.js and does not depend on the client IP at all.
    const limit = (envName, prodMax, devMax, message) => rateLimit({
        windowMs: 15 * 60 * 1000,
        max: parseInt(process.env[envName] || (isProd ? prodMax : devMax), 10),
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message },
    });
    const globalLimiter     = limit('RATE_LIMIT_GLOBAL_MAX',  '300', '10000', 'Too many requests, please try again later.');
    const credentialLimiter = limit('RATE_LIMIT_AUTH_MAX',    '10',  '1000',  'Too many attempts from this network, please try again later.');
    const refreshLimiter    = limit('RATE_LIMIT_REFRESH_MAX', '120', '10000', 'Too many session refreshes, please try again later.');

    // The health probe and the keep-alive cron must not consume the budget.
    app.use('/api', (req, res, next) => (
        req.originalUrl.split('?')[0] === '/api/health' ? next() : globalLimiter(req, res, next)
    ));

    // CSRF guard — X-Requested-With: FinAssist on every state-changing call.
    app.use('/api', csrfGuard);

    app.use(CREDENTIAL_PATHS, credentialLimiter);
    app.use('/api/auth/refresh', refreshLimiter);

    // ── Routes ────────────────────────────────────────────────────────────────
    app.use('/api/auth', require('./routes/authRoutes'));
    app.use('/api/expenses', require('./routes/expenseRoutes'));
    app.use('/api/budgets', require('./routes/budgetRoutes'));
    app.use('/api/goals', require('./routes/goalsRoutes'));
    app.use('/api/savings', require('./routes/savingsRoutes'));
    app.use('/api/wallet', require('./routes/walletRoutes'));
    app.use('/api/categories', require('./routes/categoryRoutes'));
    app.use('/api/incomes', require('./routes/incomeRoutes'));
    app.use('/api/analytics', require('./routes/analyticsRoutes'));
    app.use('/api/ai', require('./routes/aiRoutes'));

    // Health check reports the DATABASE, not just the web server, so the
    // platform marks the service unhealthy (503) when Mongo is unreachable.
    app.get('/api/health', (req, res) => {
        const state = mongoose.connection.readyState;
        const dbUp = state === 1;
        res.status(dbUp ? 200 : 503).json({
            success: dbUp,
            message: dbUp ? 'FINASSIST API is running' : 'FINASSIST API is up but the database is unreachable',
            db: DB_STATES[state] || 'unknown',
            timestamp: new Date().toISOString(),
        });
    });

    app.use('*', (req, res) => {
        res.status(404).json({ success: false, message: 'Route not found' });
    });

    // ── Global error handler with prod sanitization ──────────────────────────
    // Production never leaks stacks or messages — only { error, requestId };
    // the full error lands in stderr keyed by requestId.
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const requestId = req.requestId || '-';
        const status = err.status || err.statusCode || 500;
        if (status >= 500 || process.env.NODE_ENV !== 'test') {
            console.error(`error [${requestId}] ${req.method} ${req.originalUrl} status=${status}:`, err.stack || err.message);
        }
        if (isProd) {
            return res.status(status >= 500 ? 500 : status).json({
                success: false,
                error: status >= 500 ? 'Internal server error' : 'Request rejected',
                requestId,
            });
        }
        res.status(status).json({ success: false, message: err.message || 'Internal Server Error', requestId, stack: err.stack });
    });

    return app;
}

module.exports = { createApp, CREDENTIAL_PATHS };
