/**
 * Breached-password screening via the Have I Been Pwned range API
 * (k-anonymity: only the first 5 hex chars of the SHA-1 leave the server).
 */
const crypto = require('node:crypto');
const { isBreachedPassword, isCommonPassword } = require('../utils/passwordStrength');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').toUpperCase();
const fakeFetch = (body, ok = true) => jest.fn().mockResolvedValue({ ok, text: async () => body });
const ON = { PASSWORD_BREACH_CHECK: 'hibp' };

test('a password whose hash suffix is listed is reported as breached', async () => {
    const h = sha1('Tr0ub4dor&3');
    const fetchImpl = fakeFetch(`0000000000000000000000000000000000A:1\r\n${h.slice(5)}:2048\r\n`);
    expect(await isBreachedPassword('Tr0ub4dor&3', { env: ON, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, expect.any(Object));
});

test('only the 5-character prefix is sent, never the password or full hash', async () => {
    const fetchImpl = fakeFetch('');
    await isBreachedPassword('correct horse battery staple', { env: ON, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).not.toContain('correct');
    expect(url.split('/').pop()).toHaveLength(5);
    expect(JSON.stringify(init)).not.toContain(sha1('correct horse battery staple'));
});

test('padding entries with a zero count do not count as breached', async () => {
    const h = sha1('Unique-Pass-Phrase-41');
    expect(await isBreachedPassword('Unique-Pass-Phrase-41', { env: ON, fetchImpl: fakeFetch(`${h.slice(5)}:0\r\n`) })).toBe(false);
});

test('the check fails open when the API is unreachable', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    expect(await isBreachedPassword('anything-at-all-1', { env: ON, fetchImpl })).toBe(false);
});

test('the check is off unless enabled (and on by default in production)', async () => {
    const fetchImpl = fakeFetch('');
    await isBreachedPassword('x-y-z-1-2-3', { env: {}, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    await isBreachedPassword('x-y-z-1-2-3', { env: { NODE_ENV: 'production' }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await isBreachedPassword('x-y-z-1-2-3', { env: { NODE_ENV: 'production', PASSWORD_BREACH_CHECK: 'off' }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('the built-in list catches the most common passwords case-insensitively', () => {
    expect(isCommonPassword('Password1')).toBe(true);
    expect(isCommonPassword('QWERTY123')).toBe(true);
    expect(isCommonPassword('Correct-Horse-9')).toBe(false);
});
