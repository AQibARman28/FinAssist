/**
 * Refresh-token rotation: single use under concurrency, reuse detection that
 * kills the whole session family, a grace window for parallel tabs, and
 * "remember me" surviving rotation.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo, RefreshToken, sessions;
const uid = new mongoose.Types.ObjectId();
const hashOf = (t) => crypto.createHash('sha256').update(t).digest('hex');
const DAY = 24 * 3600 * 1000;

beforeAll(async () => {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    RefreshToken = require('../models/RefreshToken');
    sessions = require('../utils/sessions');
    await RefreshToken.init();
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await RefreshToken.deleteMany({}); });

test('a refresh token is single-use even when presented twice at once', async () => {
    const { plaintext } = await sessions.mintRefreshToken(uid);
    const results = await Promise.all([sessions.rotateRefreshToken(plaintext), sessions.rotateRefreshToken(plaintext)]);
    const issued = results.filter((r) => r && r.refreshToken);
    // One wins outright; the other lands in the parallel-tab grace window and
    // gets its own token in the same family. Never two from one row update.
    const winners = await RefreshToken.countDocuments({ tokenHash: hashOf(plaintext), revokedAt: { $ne: null } });
    expect(winners).toBe(1);
    expect(issued.length).toBeGreaterThanOrEqual(1);
});

test('reusing a rotated token after the grace window revokes the whole family', async () => {
    const { plaintext: first } = await sessions.mintRefreshToken(uid);
    const rotated = await sessions.rotateRefreshToken(first);
    await RefreshToken.updateOne({ tokenHash: hashOf(first) }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });

    const replay = await sessions.rotateRefreshToken(first);
    expect(replay).toEqual({ reuseDetected: true, userId: expect.anything() });
    const current = await RefreshToken.findOne({ tokenHash: hashOf(rotated.refreshToken) });
    expect(current.revokedAt).not.toBeNull();
});

test('a parallel tab presenting the just-rotated token inside the grace window keeps the session', async () => {
    const { plaintext: first } = await sessions.mintRefreshToken(uid);
    const rotated = await sessions.rotateRefreshToken(first);
    const sibling = await sessions.rotateRefreshToken(first);
    expect(sibling.refreshToken).toEqual(expect.any(String));
    const current = await RefreshToken.findOne({ tokenHash: hashOf(rotated.refreshToken) });
    expect(current.revokedAt).toBeNull();
});

test('a token revoked by logout is not revived by the grace window', async () => {
    const { plaintext } = await sessions.mintRefreshToken(uid);
    await sessions.revokeRefreshToken(plaintext);
    const res = await sessions.rotateRefreshToken(plaintext);
    expect(res && res.refreshToken).toBeFalsy();
});

test('"remember me" survives rotation', async () => {
    const { plaintext } = await sessions.mintRefreshToken(uid, true);
    const rotated = await sessions.rotateRefreshToken(plaintext);
    expect(rotated.refreshExpiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
});

test('a normal session rotates to a 7-day token', async () => {
    const { plaintext } = await sessions.mintRefreshToken(uid);
    const rotated = await sessions.rotateRefreshToken(plaintext);
    const left = rotated.refreshExpiresAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(6 * DAY);
    expect(left).toBeLessThanOrEqual(7 * DAY);
});

test('a token from before families existed still rotates, and its reuse revokes the user\'s sessions', async () => {
    const legacyPlain = crypto.randomBytes(32).toString('base64url');
    await RefreshToken.collection.insertOne({ userId: uid, tokenHash: hashOf(legacyPlain), createdAt: new Date(), expiresAt: new Date(Date.now() + DAY), revokedAt: null });
    const rotated = await sessions.rotateRefreshToken(legacyPlain);
    expect(rotated.refreshToken).toEqual(expect.any(String));
    await RefreshToken.updateOne({ tokenHash: hashOf(legacyPlain) }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
    expect(await sessions.rotateRefreshToken(legacyPlain)).toEqual({ reuseDetected: true, userId: expect.anything() });
    expect(await RefreshToken.countDocuments({ userId: uid, revokedAt: null })).toBe(0);
});
