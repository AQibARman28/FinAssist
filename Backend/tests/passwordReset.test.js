/**
 * Forgot / reset password (code-based). Mocks the mailer to capture the reset
 * code, then drives forgot → reset → login through the real controllers.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../utils/mailer', () => ({
    sendMail: jest.fn().mockResolvedValue(undefined),
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendVerificationCodeEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

let mongo, User, userCtl, mailer;

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
    delete process.env.SMTP_HOST;
});
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User    = require('../models/User');
    userCtl = require('../controllers/userController');
    mailer  = require('../utils/mailer');
    await User.init();
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    if (!mongoose.connection.db) return;
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
    for (const fn of Object.values(mailer)) if (fn.mockClear) fn.mockClear();
});

const mockReq = (body = {}) => ({ body, query: {}, params: {}, ip: '127.0.0.1', get: () => 'jest', cookies: {} });
const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    return res;
};
const EMAIL = 'reset@test.com', OLD = 'OldPassword123', NEW = 'BrandNewPass456';

async function register(email = EMAIL, password = OLD) {
    await userCtl.registerUser(mockReq({ name: 'R', email, password }), mockRes());
}
async function requestReset(email = EMAIL) {
    await userCtl.forgotPassword(mockReq({ email }), mockRes());
    const call = mailer.sendPasswordResetEmail.mock.calls.at(-1);
    return call ? call[1] : null;
}

describe('forgot-password', () => {
    test('issues a 6-digit reset code for a real account', async () => {
        await register();
        const code = await requestReset();
        expect(code).toMatch(/^\d{6}$/);
    });
    test('unknown email still responds success (no enumeration), no code sent', async () => {
        const res = mockRes();
        await userCtl.forgotPassword(mockReq({ email: 'ghost@nowhere.com' }), res);
        expect(res.json.mock.calls.at(-1)[0].success).toBe(true);
        expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
});

describe('reset-password', () => {
    test('wrong code → 400, increments attempts', async () => {
        await register();
        await requestReset();
        const res = mockRes();
        await userCtl.resetPassword(mockReq({ email: EMAIL, code: '000000', newPassword: NEW }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect((await User.findOne({})).passwordResetAttempts).toBe(1);
    });

    test('correct code → password changed, verified, logged in', async () => {
        await register();
        const code = await requestReset();
        const res = mockRes();
        await userCtl.resetPassword(mockReq({ email: EMAIL, code, newPassword: NEW }), res);

        expect(res.json.mock.calls.at(-1)[0].success).toBe(true);
        expect(res.cookie).toHaveBeenCalled();                 // signed in
        const user = await User.findOne({});
        expect(user.emailVerified).toBe(true);                 // reset proves email control
        expect(user.passwordResetToken).toBeNull();
        expect(await user.comparePassword(NEW)).toBe(true);    // new password works
        expect(await user.comparePassword(OLD)).toBe(false);   // old password dead
    });

    test('after reset: login works with NEW password, fails with OLD', async () => {
        await register();
        const code = await requestReset();
        await userCtl.resetPassword(mockReq({ email: EMAIL, code, newPassword: NEW }), mockRes());

        const good = mockRes();
        await userCtl.loginUser(mockReq({ email: EMAIL, password: NEW }), good);
        expect(good.json.mock.calls.at(-1)[0].success).toBe(true);

        const bad = mockRes();
        await userCtl.loginUser(mockReq({ email: EMAIL, password: OLD }), bad);
        expect(bad.status).toHaveBeenCalledWith(401);
    });

    test('five wrong codes invalidate the reset code', async () => {
        await register();
        await requestReset();
        for (let i = 0; i < 5; i++) {
            await userCtl.resetPassword(mockReq({ email: EMAIL, code: '111111', newPassword: NEW }), mockRes());
        }
        const res = mockRes();
        await userCtl.resetPassword(mockReq({ email: EMAIL, code: '111111', newPassword: NEW }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect((await User.findOne({})).passwordResetToken).toBeNull();
    });
});
