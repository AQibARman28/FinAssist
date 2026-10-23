/**
 * Mailer output safety: interpolated values are HTML-escaped, and one-time
 * codes never reach the production log when no mail provider is configured.
 */
const mailer = require('../utils/mailer');

afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
    jest.restoreAllMocks();
});

describe('welcome email', () => {
    test('a name carrying markup is escaped in the HTML body', () => {
        const { html } = mailer.buildWelcomeEmail('<a/href="https://evil.example">Verify</a>', 'https://app.example');
        expect(html).not.toMatch(/<a\/href/);
        expect(html).toContain('&lt;a/href=&quot;https://evil.example&quot;&gt;Verify&lt;/a&gt;');
    });

    test('a normal first name is used as-is', () => {
        const { html, text } = mailer.buildWelcomeEmail('Ada Lovelace', 'https://app.example');
        expect(html).toContain('Welcome aboard, Ada');
        expect(text).toContain('Hi Ada,');
    });
});

describe('console fallback', () => {
    test('in development the code is printed so a developer can sign up', async () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        await mailer.sendVerificationCodeEmail('dev@test.com', '482913');
        expect(log.mock.calls.flat().join('\n')).toContain('482913');
    });

    test('in production the code is redacted from the log', async () => {
        process.env.NODE_ENV = 'production';
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        await mailer.sendVerificationCodeEmail('user@test.com', '482913');
        await mailer.sendPasswordResetEmail('user@test.com', '771204');
        const out = log.mock.calls.flat().join('\n');
        expect(out).not.toContain('482913');
        expect(out).not.toContain('771204');
    });
});
