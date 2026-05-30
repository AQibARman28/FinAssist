/**
 * Code-based email verification + welcome email.
 * Mocks the mailer to capture the 6-digit code (it lives only in the email),
 * then drives register → verify/resend through the real controller against
 * in-memory Mongo.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../utils/mailer', () => ({
    sendMail: jest.fn().mockResolvedValue(undefined),
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendVerificationCodeEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
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
    mailer.sendVerificationCodeEmail.mockClear();
    mailer.sendWelcomeEmail.mockClear();
});

const mockReq = (body = {}) => ({ body, query: {}, params: {}, ip: '127.0.0.1', get: () => 'jest', cookies: {} });
const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    return res;
};

async function register(email = 'a@b.com') {
    const res = mockRes();
    await userCtl.registerUser(mockReq({ name: 'Test User', email, password: 'Password123!' }), res);
    const lastCall = mailer.sendVerificationCodeEmail.mock.calls.at(-1);
    return { res, code: lastCall ? lastCall[1] : null };
}

describe('register → code issued', () => {
    test('creates an unverified user and emails a 6-digit code (no session yet)', async () => {
        const { res, code } = await register();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json.mock.calls.at(-1)[0]).toMatchObject({ requiresEmailVerification: true });
        expect(code).toMatch(/^\d{6}$/);
        const user = await User.findOne({});
        expect(user.emailVerified).toBe(false);
        expect(res.cookie).not.toHaveBeenCalled(); // no login until verified
    });
});

describe('verify-code', () => {
    test('wrong code → 400 and increments attempts', async () => {
        await register();
        const res = mockRes();
        await userCtl.verifyCode(mockReq({ email: 'a@b.com', code: '000000' }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        const user = await User.findOne({});
        expect(user.emailVerified).toBe(false);
        expect(user.emailVerificationAttempts).toBe(1);
    });

    test('correct code → verified, logged in, welcome email sent', async () => {
        const { code } = await register();
        const res = mockRes();
        await userCtl.verifyCode(mockReq({ email: 'a@b.com', code }), res);

        const payload = res.json.mock.calls.at(-1)[0];
        expect(payload.success).toBe(true);
        expect(payload.data).toBeDefined();
        expect(res.cookie).toHaveBeenCalled();                 // session established
        expect(mailer.sendWelcomeEmail).toHaveBeenCalledTimes(1);

        const user = await User.findOne({});
        expect(user.emailVerified).toBe(true);
        expect(user.emailVerificationToken).toBeNull();
    });

    test('five wrong codes invalidate the code; a correct guess then fails', async () => {
        const { code } = await register();
        for (let i = 0; i < 5; i++) {
            await userCtl.verifyCode(mockReq({ email: 'a@b.com', code: '111111' }), mockRes());
        }
        // 6th attempt trips the cap and clears the stored code.
        const tooMany = mockRes();
        await userCtl.verifyCode(mockReq({ email: 'a@b.com', code: '111111' }), tooMany);
        expect(tooMany.status).toHaveBeenCalledWith(400);
        const user = await User.findOne({});
        expect(user.emailVerificationToken).toBeNull();

        // Even the originally-correct code no longer works.
        const res = mockRes();
        await userCtl.verifyCode(mockReq({ email: 'a@b.com', code }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect((await User.findOne({})).emailVerified).toBe(false);
    });
});

describe('resend-code', () => {
    test('issues a fresh code (after cooldown) that verifies; old code stops working', async () => {
        const { code: oldCode } = await register();

        // Age the issued-at past the resend cooldown.
        const user = await User.findOne({});
        user.emailVerificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000 - 61_000);
        await user.save();

        await userCtl.resendCode(mockReq({ email: 'a@b.com' }), mockRes());
        const newCode = mailer.sendVerificationCodeEmail.mock.calls.at(-1)[1];
        expect(newCode).toMatch(/^\d{6}$/);

        // Old code rejected, new code accepted.
        const r1 = mockRes();
        await userCtl.verifyCode(mockReq({ email: 'a@b.com', code: oldCode }), r1);
        expect(r1.status).toHaveBeenCalledWith(400);

        const r2 = mockRes();
        await userCtl.verifyCode(mockReq({ email: 'a@b.com', code: newCode }), r2);
        expect((await User.findOne({})).emailVerified).toBe(true);
    });

    test('resend for an unknown email still responds success (no enumeration)', async () => {
        const res = mockRes();
        await userCtl.resendCode(mockReq({ email: 'nobody@nowhere.com' }), res);
        expect(res.json.mock.calls.at(-1)[0].success).toBe(true);
    });
});
