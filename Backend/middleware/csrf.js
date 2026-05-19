/**
 * CSRF guard — custom-header check.
 *
 * With SEC-1 Phase 3 the session cookies are SameSite=Strict, so a cross-site
 * navigation cannot induce the browser to attach them to a request. That kills
 * the classical "evil-site auto-submits form to /api/expenses" scenario before
 * it reaches the server.
 *
 * This middleware is defense-in-depth: every state-changing API call must
 * carry `X-Requested-With: FinAssist`. Reasoning:
 *   - A simple <form> POST cannot set a custom header — only XHR / fetch can.
 *   - Cross-origin fetch with a custom header triggers a CORS preflight,
 *     which our `cors` config rejects from non-allowed origins.
 *   - So an attacker site can't reach the API even if a future browser bug
 *     weakens SameSite enforcement.
 *
 * Safe methods (GET/HEAD/OPTIONS) bypass the check — they are idempotent
 * and read-only by HTTP contract.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUIRED_HEADER_VALUE = 'FinAssist';

function csrfGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const header = req.get('X-Requested-With');
    if (header !== REQUIRED_HEADER_VALUE) {
        return res.status(403).json({
            success: false,
            message: 'Missing or invalid X-Requested-With header',
        });
    }
    next();
}

module.exports = { csrfGuard };
