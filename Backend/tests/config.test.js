/**
 * Startup configuration checks (utils/config.js). The server refuses to boot
 * on any `errors`; `warnings` are printed but do not stop it.
 */
const crypto = require('node:crypto');
const { checkStartupConfig } = require('../utils/config');

const hex64 = () => crypto.randomBytes(32).toString('hex');
const baseEnv = () => ({
    JWT_SECRET:            hex64(),
    MASTER_ENCRYPTION_KEY: hex64(),
    EMAIL_HASH_SECRET:     hex64(),
});

describe('secrets', () => {
    test('a complete development env passes', () => {
        expect(checkStartupConfig(baseEnv()).errors).toEqual([]);
    });

    test('missing secrets are named', () => {
        const { errors } = checkStartupConfig({});
        expect(errors.join(' ')).toMatch(/JWT_SECRET/);
        expect(errors.join(' ')).toMatch(/MASTER_ENCRYPTION_KEY/);
        expect(errors.join(' ')).toMatch(/EMAIL_HASH_SECRET/);
    });

    test('a JWT secret shorter than 32 bytes is refused', () => {
        const { errors } = checkStartupConfig({ ...baseEnv(), JWT_SECRET: 'short' });
        expect(errors.join(' ')).toMatch(/JWT_SECRET/);
    });

    // The crypto layer needs exactly 32 bytes of hex; a 40-char non-hex string
    // used to pass the >=32-byte boot check and then fail on the first request.
    test.each(['MASTER_ENCRYPTION_KEY', 'EMAIL_HASH_SECRET'])('%s must be exactly 64 hex characters', (name) => {
        const longButNotHex = 'z'.repeat(64);
        expect(checkStartupConfig({ ...baseEnv(), [name]: longButNotHex }).errors.join(' ')).toMatch(name);
        expect(checkStartupConfig({ ...baseEnv(), [name]: hex64().slice(0, 40) }).errors.join(' ')).toMatch(name);
    });
});

describe('production posture', () => {
    const prod = (extra = {}) => ({ ...baseEnv(), NODE_ENV: 'production', FRONTEND_URL: 'https://app.example', RESEND_API_KEY: 're_x', PROXY_SHARED_SECRET: hex64(), ...extra });

    test('a complete production env passes with no warnings', () => {
        const r = checkStartupConfig(prod());
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    test('email verification is on by default, so a mail provider is required', () => {
        const { errors } = checkStartupConfig(prod({ RESEND_API_KEY: undefined }));
        expect(errors.join(' ')).toMatch(/mail provider/i);
    });

    test('SMTP_HOST also counts as a mail provider', () => {
        expect(checkStartupConfig(prod({ RESEND_API_KEY: undefined, SMTP_HOST: 'smtp.example' })).errors).toEqual([]);
    });

    test('explicitly disabling verification removes the mail requirement but warns', () => {
        const r = checkStartupConfig(prod({ RESEND_API_KEY: undefined, REQUIRE_EMAIL_VERIFICATION: 'false' }));
        expect(r.errors).toEqual([]);
        expect(r.warnings.join(' ')).toMatch(/REQUIRE_EMAIL_VERIFICATION/);
    });

    test('FRONTEND_URL is required for CORS in production', () => {
        expect(checkStartupConfig(prod({ FRONTEND_URL: undefined })).errors.join(' ')).toMatch(/FRONTEND_URL/);
    });

    test('running without the proxy shared secret is allowed but warned about', () => {
        const r = checkStartupConfig(prod({ PROXY_SHARED_SECRET: undefined }));
        expect(r.errors).toEqual([]);
        expect(r.warnings.join(' ')).toMatch(/PROXY_SHARED_SECRET/);
    });
});
