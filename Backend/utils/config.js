/**
 * config.js — startup configuration rules, kept pure so they can be tested.
 *
 * checkStartupConfig(env) -> { errors: string[], warnings: string[] }
 *   index.js refuses to boot on any error and prints the warnings.
 *
 * The secret rules mirror what the crypto layer actually needs, so a key that
 * passes here can't fail on the first request (the old check accepted any
 * string of >=32 bytes while encryption.js demands 64 hex characters).
 */

const HEX64 = /^[0-9a-fA-F]{64}$/;

// Email verification is ON in production unless explicitly turned off, and
// OFF in development unless explicitly turned on.
function emailVerificationRequired(env = process.env) {
    if (env.REQUIRE_EMAIL_VERIFICATION === 'true') return true;
    if (env.REQUIRE_EMAIL_VERIFICATION === 'false') return false;
    return env.NODE_ENV === 'production';
}

function hasMailProvider(env = process.env) {
    return Boolean(env.RESEND_API_KEY || env.SMTP_HOST);
}

function checkStartupConfig(env = process.env) {
    const errors = [];
    const warnings = [];

    if (!env.JWT_SECRET) errors.push('Missing JWT_SECRET.');
    else if (Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32) errors.push('JWT_SECRET must be at least 32 bytes.');
    if (env.JWT_SECRET_PREVIOUS && Buffer.byteLength(env.JWT_SECRET_PREVIOUS, 'utf8') < 32) {
        errors.push('JWT_SECRET_PREVIOUS must be at least 32 bytes.');
    }

    for (const name of ['MASTER_ENCRYPTION_KEY', 'EMAIL_HASH_SECRET']) {
        if (!env[name]) errors.push(`Missing ${name}.`);
        else if (!HEX64.test(env[name])) errors.push(`${name} must be exactly 64 hex characters (32 random bytes).`);
    }
    if (env.MASTER_ENCRYPTION_KEY_PREVIOUS && !HEX64.test(env.MASTER_ENCRYPTION_KEY_PREVIOUS)) {
        errors.push('MASTER_ENCRYPTION_KEY_PREVIOUS must be exactly 64 hex characters.');
    }

    if (env.NODE_ENV === 'production') {
        if (!env.FRONTEND_URL) errors.push('Missing FRONTEND_URL (needed for CORS in production).');

        if (emailVerificationRequired(env) && !hasMailProvider(env)) {
            errors.push('Email verification is on in production but no mail provider is configured. Set RESEND_API_KEY or SMTP_HOST, or set REQUIRE_EMAIL_VERIFICATION=false.');
        }
        if (env.REQUIRE_EMAIL_VERIFICATION === 'false') {
            warnings.push('REQUIRE_EMAIL_VERIFICATION=false: accounts are created without proving email ownership.');
        }
        if (!env.PROXY_SHARED_SECRET) {
            warnings.push('PROXY_SHARED_SECRET is not set: the API accepts direct requests, so per-IP rate limits trust a client-supplied X-Forwarded-For.');
        }
    }

    return { errors, warnings };
}

module.exports = { checkStartupConfig, emailVerificationRequired, hasMailProvider };
