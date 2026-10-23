/**
 * Account-layer hardening: sign-in throttling and enumeration resistance,
 * re-authentication for sensitive profile changes, email-change confirmation,
 * registration posture and the password policy. Drives the real controllers
 * against mongodb-memory-server with the mailer mocked.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const speakeasy = require('speakeasy');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../utils/mailer', () => ({
    sendMail: jest.fn().mockResolvedValue(undefined),
    sendVerificationCodeEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendEmailChangeCodeEmail: jest.fn().mockResolvedValue(undefined),
    sendEmailChangedNotice: jest.fn().mockResolvedValue(undefined),
    sendAccountExistsEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/passwordStrength', () => ({
    ...jest.requireActual('../utils/passwordStrength'),
    isBreachedPassword: jest.fn().mockResolvedValue(false),
}));

let mongo, User, RefreshToken, LoginThrottle, userCtl, mailer, sessions, native, strength;

beforeAll(async () => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
    delete process.env.SMTP_HOST;
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User          = require('../models/User');
    RefreshToken  = require('../models/RefreshToken');
    LoginThrottle = require('../models/LoginThrottle');
    userCtl       = require('../controllers/userController');
    mailer        = require('../utils/mailer');
    sessions      = require('../utils/sessions');
    native        = require('../utils/nativeCrypto');
    strength      = require('../utils/passwordStrength');
    await Promise.all([User.init(), RefreshToken.init(), LoginThrottle.init()]);
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.NODE_ENV = 'test';
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
    for (const fn of Object.values(mailer)) if (fn.mockClear) fn.mockClear();
    strength.isBreachedPassword.mockResolvedValue(false);
});

const mockReq = (body = {}, extra = {}) => ({ body, query: {}, params: {}, ip: '127.0.0.1', get: () => 'jest', cookies: {}, ...extra });
const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    res.clearCookie = jest.fn().mockReturnValue(res);
    return res;
};
const statusOf = (res) => (res.status.mock.calls.at(-1) || [200])[0];
const bodyOf   = (res) => res.json.mock.calls.at(-1)[0];

const EMAIL = 'owner@test.com', PASS = 'Correct-Horse-9';

async function register(email = EMAIL, password = PASS, name = 'Owner') {
    const res = mockRes();
    await userCtl.registerUser(mockReq({ name, email, password }), res);
    return res;
}
async function login(email, password) {
    const res = mockRes();
    await userCtl.loginUser(mockReq({ email, password }), res);
    return res;
}
// Builds the req a protected route sees (what middleware/authMiddleware attaches).
async function authedReq(body = {}) {
    const user = await User.findOne({});
    const { masterDecrypt, openField, FIELDS } = require('../utils/encryption');
    const dataKey = Buffer.from(await masterDecrypt(user.encryptedDataKey), 'hex');
    user._name  = await openField(user.name, dataKey, FIELDS.userName, user._id);
    user._email = await openField(user.email, dataKey, FIELDS.userEmail, user._id);
    return mockReq(body, { user, dataKey });
}

// ── Sign-in throttling and enumeration ─────────────────────────────────────

describe('sign-in throttle', () => {
    test('unknown email and wrong password get identical responses', async () => {
        await register();
        const unknown = await login('ghost@test.com', PASS);
        const wrong   = await login(EMAIL, 'Wrong-Password-1');
        expect(statusOf(unknown)).toBe(401);
        expect(statusOf(wrong)).toBe(401);
        expect(bodyOf(unknown)).toEqual(bodyOf(wrong));
    });

    test('an unknown email still pays for a password hash check (no timing oracle)', async () => {
        const spy = jest.spyOn(native, 'verifyPassword');
        await login('ghost@test.com', PASS);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    test('after five failures, known and unknown emails get the same 429', async () => {
        await register();
        const sixth = {};
        for (const email of [EMAIL, 'ghost@test.com']) {
            for (let i = 0; i < 5; i++) await login(email, 'Wrong-Password-1');
            sixth[email] = await login(email, 'Wrong-Password-1');
        }
        expect(statusOf(sixth[EMAIL])).toBe(429);
        expect(statusOf(sixth['ghost@test.com'])).toBe(429);
        expect(bodyOf(sixth[EMAIL])).toEqual(bodyOf(sixth['ghost@test.com']));
    });

    test('while throttled even the right password is refused; once the lock passes it works', async () => {
        await register();
        for (let i = 0; i < 5; i++) await login(EMAIL, 'Wrong-Password-1');
        expect(statusOf(await login(EMAIL, PASS))).toBe(429);
        await LoginThrottle.updateMany({}, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
        expect(statusOf(await login(EMAIL, PASS))).toBe(200);
    });

    test('repeated lockouts back off, but never beyond one hour', async () => {
        await register();
        for (let i = 0; i < 5; i++) await login(EMAIL, 'Wrong-Password-1');
        await LoginThrottle.updateMany({}, { $set: { lockouts: 12, lockedUntil: new Date(Date.now() - 1000), failures: 0, windowStart: null } });
        for (let i = 0; i < 5; i++) await login(EMAIL, 'Wrong-Password-1');
        const row = await LoginThrottle.findOne({});
        expect(row.lockedUntil.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
        expect(row.lockedUntil.getTime() - Date.now()).toBeGreaterThan(30 * 60 * 1000);
    });

    test('a successful sign-in clears earlier failures', async () => {
        await register();
        for (let i = 0; i < 4; i++) await login(EMAIL, 'Wrong-Password-1');
        expect(statusOf(await login(EMAIL, PASS))).toBe(200);
        expect(await LoginThrottle.countDocuments({ failures: { $gt: 0 } })).toBe(0);
    });
});

// ── Re-authentication for sensitive changes ────────────────────────────────

describe('profile changes', () => {
    test('name and currency change without a password', async () => {
        await register();
        const res = mockRes();
        await userCtl.updateUserProfile(await authedReq({ name: 'Renamed', currency: 'USD' }), res);
        expect(bodyOf(res).success).toBe(true);
        expect((await User.findOne({})).currency).toBe('USD');
    });

    test('a password change without the current password is refused', async () => {
        await register();
        const res = mockRes();
        await userCtl.updateUserProfile(await authedReq({ password: 'Brand-New-Pass-7' }), res);
        expect(statusOf(res)).toBe(401);
        expect(await (await User.findOne({})).comparePassword(PASS)).toBe(true);
    });

    test('a wrong current password is refused', async () => {
        await register();
        const res = mockRes();
        await userCtl.updateUserProfile(await authedReq({ password: 'Brand-New-Pass-7', currentPassword: 'nope-nope-1' }), res);
        expect(statusOf(res)).toBe(401);
    });

    test('with the current password, the change applies and every other session is revoked', async () => {
        await register();
        const user = await User.findOne({});
        const other = await sessions.mintRefreshToken(user._id);
        const res = mockRes();
        await userCtl.updateUserProfile(await authedReq({ password: 'Brand-New-Pass-7', currentPassword: PASS }), res);
        expect(bodyOf(res).success).toBe(true);
        expect(await (await User.findOne({})).comparePassword('Brand-New-Pass-7')).toBe(true);
        const oldRow = await RefreshToken.findOne({ tokenHash: crypto.createHash('sha256').update(other.plaintext).digest('hex') });
        expect(oldRow.revokedAt).not.toBeNull();
        expect(res.cookie).toHaveBeenCalledWith('fa_refresh', expect.any(String), expect.any(Object)); // this device stays signed in
    });

    test('with 2FA on, a password change also needs a valid authenticator code', async () => {
        await register();
        const { sealField, FIELDS } = require('../utils/encryption');
        const req = await authedReq();
        const secret = native.generateTotpSecret();
        req.user.twoFactorSecret = await sealField(secret, req.dataKey, FIELDS.userTotpSecret, req.user._id);
        req.user.twoFactorEnabled = true;
        req.user.twoFactorAlgorithm = 'sha1';
        await req.user.save();

        const noCode = mockRes();
        await userCtl.updateUserProfile(await authedReq({ password: 'Brand-New-Pass-7', currentPassword: PASS }), noCode);
        expect(statusOf(noCode)).toBe(401);

        const totp = speakeasy.totp({ secret, encoding: 'base32', algorithm: 'sha1' });
        const withCode = mockRes();
        await userCtl.updateUserProfile(await authedReq({ password: 'Brand-New-Pass-7', currentPassword: PASS, totp }), withCode);
        expect(bodyOf(withCode).success).toBe(true);
    });

    test('an email change is held until the code sent to the new address is confirmed', async () => {
        await register();
        const res = mockRes();
        await userCtl.updateUserProfile(await authedReq({ email: 'new@test.com', currentPassword: PASS }), res);
        expect(bodyOf(res).emailChangePending).toBe(true);
        expect(mailer.sendEmailChangeCodeEmail).toHaveBeenCalledWith('new@test.com', expect.stringMatching(/^\d{6}$/));

        const { hashEmail } = require('../utils/encryption');
        expect((await User.findOne({})).emailHash).toBe(await hashEmail(EMAIL)); // not switched yet

        const code = mailer.sendEmailChangeCodeEmail.mock.calls.at(-1)[1];
        const confirm = mockRes();
        await userCtl.confirmEmailChange(await authedReq({ code }), confirm);
        expect(bodyOf(confirm).success).toBe(true);
        expect((await User.findOne({})).emailHash).toBe(await hashEmail('new@test.com'));
        expect(mailer.sendEmailChangedNotice).toHaveBeenCalledWith(EMAIL);
    });

    test('a wrong email-change code does not switch the email', async () => {
        await register();
        await userCtl.updateUserProfile(await authedReq({ email: 'new@test.com', currentPassword: PASS }), mockRes());
        const res = mockRes();
        await userCtl.confirmEmailChange(await authedReq({ code: '000000' }), res);
        expect(statusOf(res)).toBe(400);
        const { hashEmail } = require('../utils/encryption');
        expect((await User.findOne({})).emailHash).toBe(await hashEmail(EMAIL));
    });

    test('re-sending the unchanged email does not demand a password', async () => {
        await register();
        const res = mockRes();
        await userCtl.updateUserProfile(await authedReq({ email: EMAIL, name: 'Same Email' }), res);
        expect(bodyOf(res).success).toBe(true);
    });
});

// ── Registration posture ───────────────────────────────────────────────────

describe('registration', () => {
    test('with verification off (development), no welcome email goes to an unproven address', async () => {
        await register();
        expect(mailer.sendWelcomeEmail).not.toHaveBeenCalled();
    });

    test('in production, email verification is on by default', async () => {
        process.env.NODE_ENV = 'production';
        const res = await register();
        expect(bodyOf(res).requiresEmailVerification).toBe(true);
        expect(res.cookie).not.toHaveBeenCalled();
    });

    test('with verification on, registering an existing email looks exactly like a new sign-up', async () => {
        process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
        await register();
        const fresh = await register('someone-new@test.com');
        const dup   = await register(EMAIL);
        expect(statusOf(dup)).toBe(statusOf(fresh));
        expect(Object.keys(bodyOf(dup)).sort()).toEqual(Object.keys(bodyOf(fresh)).sort());
        expect(bodyOf(dup).requiresEmailVerification).toBe(true);
        expect(mailer.sendAccountExistsEmail).toHaveBeenCalledWith(EMAIL);
        expect(await User.countDocuments({})).toBe(2);
    });

    test('a breached password is refused at sign-up', async () => {
        strength.isBreachedPassword.mockResolvedValue(true);
        const res = await register();
        expect(statusOf(res)).toBe(400);
        expect(bodyOf(res).message).toMatch(/breach/i);
        expect(await User.countDocuments({})).toBe(0);
    });
});

// ── Validators ─────────────────────────────────────────────────────────────

describe('validators', () => {
    const auth = require('../validators/auth');
    const ok = (o) => auth.register.safeParse({ name: 'Ann', email: 'a@b.co', password: 'Long-Enough-9', ...o }).success;

    test('passwords need at least 8 characters', () => {
        expect(ok({ password: 'Abc-12!' })).toBe(false);
        expect(ok({ password: 'Abc-12!x' })).toBe(true);
    });

    test('very common passwords are refused regardless of length', () => {
        for (const p of ['password', '12345678', 'password1', 'qwerty123', 'iloveyou']) expect(ok({ password: p })).toBe(false);
    });

    test('names may hold letters from any language but not markup', () => {
        expect(ok({ name: 'José María O\'Neil-Søren' })).toBe(true);
        expect(ok({ name: '<a/href="https://evil.example">Verify</a>' })).toBe(false);
        expect(ok({ name: 'Ann <b>' })).toBe(false);
    });
});
