/**
 * passwordStrength.js — the password rules beyond length (NIST SP 800-63B
 * §5.1.1.2: screen new passwords against known-compromised values).
 *
 *   isCommonPassword(pw)              synchronous; a built-in list of the most
 *                                     common passwords, used by the zod schema
 *   isBreachedPassword(pw, {env, fetchImpl, timeoutMs})
 *                                     asynchronous; Have I Been Pwned range API
 *                                     with k-anonymity — only the first five hex
 *                                     characters of the SHA-1 leave the server.
 *                                     Fails open: an outage must not block
 *                                     sign-ups. On by default in production,
 *                                     PASSWORD_BREACH_CHECK=hibp forces it on,
 *                                     PASSWORD_BREACH_CHECK=off turns it off.
 */

const crypto = require('node:crypto');

// Most common passwords from public breach corpora (lowercase).
const COMMON = new Set([
    '123456', '123456789', '12345678', 'password', 'qwerty123', 'qwerty1', '111111', '12345', 'secret', '123123',
    '1234567890', '1234567', '000000', 'qwerty', 'abc123', 'password1', 'iloveyou', '11111111', 'dragon', 'monkey',
    '123321', '654321', '666666', '121212', 'qwertyuiop', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'asdfghjkl',
    'football', 'baseball', 'welcome', 'welcome1', 'letmein', 'sunshine', 'princess', 'admin', 'admin123', 'login',
    'master', 'shadow', 'superman', 'michael', 'jennifer', 'charlie', 'jordan23', 'trustno1', 'starwars', 'whatever',
    'freedom', 'hello123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'password123', 'password12', 'password!', 'pass1234', 'mypassword',
    'changeme', 'default', 'computer', 'internet', 'killer', 'pokemon', 'naruto', 'cookie', 'chocolate', 'flower',
    'liverpool', 'arsenal', 'chelsea', 'manchester', 'barcelona', 'soccer', 'hockey', 'batman', 'hunter2', 'access',
    'mustang', 'ferrari', 'qazwsx', 'asdf1234', 'zxcvbnm', 'zxcvbnm123', 'aaaaaa', 'aaaaaaaa', 'abcdef', 'abcd1234',
    'abcdefgh', '987654321', '11223344', '12341234', '123qwe', 'qwe123', 'qweasdzxc', '1234qwer', 'q1w2e3r4', 'q1w2e3r4t5',
    'fuckyou', 'loveyou', 'lovely', 'iloveyou1', 'bangladesh', 'pakistan', 'india123', 'dhaka123', 'finassist', 'finance',
    'money', 'money123', 'banking', 'summer2024', 'summer2025', 'summer2026', 'winter2025', 'spring2026', 'autumn2026', 'test1234',
    'testtest', 'test123', 'guest', 'guest123', 'root', 'toor', 'oracle', 'samsung', 'apple123', 'google',
]);

function isCommonPassword(pw) {
    return typeof pw === 'string' && COMMON.has(pw.toLowerCase());
}

function breachCheckEnabled(env = process.env) {
    if (env.PASSWORD_BREACH_CHECK === 'off') return false;
    if (env.PASSWORD_BREACH_CHECK === 'hibp') return true;
    return env.NODE_ENV === 'production';
}

async function isBreachedPassword(pw, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
    if (typeof pw !== 'string' || !breachCheckEnabled(env)) return false;
    const hash = crypto.createHash('sha1').update(pw, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    try {
        const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
            headers: { 'Add-Padding': 'true', 'User-Agent': 'FinAssist-password-check' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return false;
        const body = await res.text();
        for (const line of body.split(/\r?\n/)) {
            const [s, count] = line.split(':');
            if (s === suffix) return parseInt(count, 10) > 0;
        }
        return false;
    } catch {
        return false; // fail open
    }
}

module.exports = { isCommonPassword, isBreachedPassword, breachCheckEnabled };
