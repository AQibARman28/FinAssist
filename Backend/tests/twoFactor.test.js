/**
 * Two-factor enrolment and recovery through the real controllers:
 * no silent re-keying, SHA-1 for new enrolments (what common authenticator
 * apps actually compute), SHA-256 kept for existing ones, full 160-bit
 * secrets, and single-use recovery codes.
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

let mongo, User, userCtl, tfaCtl, enc, sessions;

beforeAll(async () => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    User     = require('../models/User');
    userCtl  = require('../controllers/userController');
    tfaCtl   = require('../controllers/twoFactorController');
    enc      = require('../utils/encryption');
    sessions = require('../utils/sessions');
    await User.init();
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
    const colls = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(colls.map((c) => mongoose.connection.db.collection(c.name).deleteMany({})));
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

async function authed(body = {}) {
    const user = await User.findOne({});
    const dataKey = Buffer.from(await enc.masterDecrypt(user.encryptedDataKey), 'hex');
    user._name = await enc.openField(user.name, dataKey, enc.FIELDS.userName, user._id);
    user._email = await enc.openField(user.email, dataKey, enc.FIELDS.userEmail, user._id);
    return mockReq(body, { user, dataKey });
}
async function enrol() {
    await userCtl.registerUser(mockReq({ name: 'T', email: 't@test.com', password: 'Correct-Horse-9' }), mockRes());
    const setup = mockRes();
    await tfaCtl.setup2FA(await authed(), setup);
    const secret = bodyOf(setup).data.manualKey;
    const enable = mockRes();
    await tfaCtl.enable2FA(await authed({ token: speakeasy.totp({ secret, encoding: 'base32', algorithm: 'sha1' }) }), enable);
    return { secret, setup, enable };
}
const b32decode = (s) => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
    return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
};

test('new enrolments use SHA-1 and advertise it in the QR code', async () => {
    const { setup, enable } = await enrol();
    expect(bodyOf(enable).success).toBe(true);
    expect(bodyOf(setup).data.otpauthUrl).toMatch(/algorithm=SHA1/);
    expect((await User.findOne({})).twoFactorAlgorithm).toBe('sha1');
});

test('the secret carries a full 160 bits', async () => {
    const { secret } = await enrol();
    expect(b32decode(secret)).toHaveLength(20);
});

test('setup is refused while 2FA is on, and the live secret is untouched', async () => {
    await enrol();
    const before = (await User.findOne({})).twoFactorSecret;
    const res = mockRes();
    await tfaCtl.setup2FA(await authed(), res);
    expect(statusOf(res)).toBe(409);
    expect((await User.findOne({})).twoFactorSecret).toBe(before);
});

test('accounts enrolled before the change keep verifying SHA-256 codes', async () => {
    await userCtl.registerUser(mockReq({ name: 'L', email: 'l@test.com', password: 'Correct-Horse-9' }), mockRes());
    const req = await authed();
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    await User.updateOne({}, { $set: { twoFactorSecret: await enc.sealField(secret, req.dataKey, enc.FIELDS.userTotpSecret, req.user._id), twoFactorEnabled: true }, $unset: { twoFactorAlgorithm: 1 } });
    const res = mockRes();
    await tfaCtl.disable2FA(await authed({ token: speakeasy.totp({ secret, encoding: 'base32', algorithm: 'sha256' }) }), res);
    expect(bodyOf(res).success).toBe(true);
});

test('enabling 2FA returns ten recovery codes, stored only as hashes', async () => {
    const { enable } = await enrol();
    const codes = bodyOf(enable).recoveryCodes;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const stored = JSON.stringify((await User.findOne({})).twoFactorRecoveryCodes);
    for (const c of codes) expect(stored).not.toContain(c);
});

test('a recovery code completes a 2FA sign-in once, and only once', async () => {
    const { enable } = await enrol();
    const code = bodyOf(enable).recoveryCodes[0];
    const user = await User.findOne({});
    const temp = sessions.mintTempToken(user._id);

    const first = mockRes();
    await tfaCtl.verify2FA(mockReq({ recoveryCode: code }, { cookies: { fa_temp: temp } }), first);
    expect(bodyOf(first).success).toBe(true);

    const second = mockRes();
    await tfaCtl.verify2FA(mockReq({ recoveryCode: code }, { cookies: { fa_temp: temp } }), second);
    expect(statusOf(second)).toBe(401);
});
