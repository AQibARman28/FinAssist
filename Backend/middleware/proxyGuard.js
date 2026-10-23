/**
 * proxyGuard — only the FinAssist frontend proxy may call the API.
 *
 * Production runs browser -> Vercel (Next proxy) -> Render -> Express, but the
 * Render URL is public. A request sent straight to it is one hop shorter than
 * `trust proxy` assumes, so Express would take the client IP from an
 * attacker-written X-Forwarded-For and every per-IP limit could be dodged.
 *
 * When PROXY_SHARED_SECRET is set, the Next proxy adds it as the
 * X-FinAssist-Proxy header and anything without it is refused here, before the
 * rate limiters run. /api/health stays open for the platform's health probe.
 * Unset (local dev, tests), the guard is a no-op; config.js warns about that
 * in production.
 */

const crypto = require('node:crypto');

const HEADER = 'X-FinAssist-Proxy';

// Hash both sides so timingSafeEqual always compares equal-length buffers.
const _digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

function proxyGuard(secret) {
    if (!secret) return (req, res, next) => next();
    const expected = _digest(secret);

    return (req, res, next) => {
        if (req.originalUrl.split('?')[0] === '/api/health') return next();
        const got = req.get(HEADER);
        if (got && crypto.timingSafeEqual(_digest(got), expected)) return next();
        return res.status(403).json({ success: false, message: 'Requests must come through the FinAssist app.' });
    };
}

module.exports = { proxyGuard, PROXY_HEADER: HEADER };
