/**
 * Route-level tests through the real Express app (app.js) with supertest:
 * the middleware chain that unit tests can't see — body limits, CSRF,
 * session guard, schema validation, the proxy shared secret, rate-limit
 * scoping and API security headers.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
const XRW = { 'X-Requested-With': 'FinAssist' };

beforeAll(async () => {
    process.env.MASTER_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = crypto.randomBytes(32).toString('hex');
    process.env.NODE_ENV              = 'test';
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
}, 60_000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
afterEach(() => {
    delete process.env.PROXY_SHARED_SECRET;
    delete process.env.RATE_LIMIT_AUTH_MAX;
    delete process.env.RATE_LIMIT_GLOBAL_MAX;
});

// A fresh app per test so env-driven settings (limits, proxy secret) apply.
const makeApp = () => require('../app').createApp();

describe('baseline middleware', () => {
    test('health reports the database state', async () => {
        const res = await request(makeApp()).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.db).toBe('connected');
    });

    test('API responses carry CSP, HSTS and a request id', async () => {
        const res = await request(makeApp()).get('/api/health');
        expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
        expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
    });

    test('a state-changing call without X-Requested-With is refused (CSRF)', async () => {
        const res = await request(makeApp()).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
        expect(res.status).toBe(403);
    });

    test('a protected route without a session cookie is 401', async () => {
        const res = await request(makeApp()).get('/api/expenses');
        expect(res.status).toBe(401);
    });

    test('a Mongo operator object in place of an email is rejected by the schema', async () => {
        const res = await request(makeApp()).post('/api/auth/login').set(XRW).send({ email: { $gt: '' }, password: 'x' });
        expect(res.status).toBe(400);
        expect(res.body.in).toBe('body');
    });

    test('JSON bodies over 100 kB are refused with 413', async () => {
        const res = await request(makeApp()).post('/api/auth/login').set(XRW)
            .send({ email: 'a@b.co', password: 'x', pad: 'x'.repeat(150 * 1024) });
        expect(res.status).toBe(413);
    });
});

describe('proxy shared secret', () => {
    test('when set, a request without the header is refused', async () => {
        process.env.PROXY_SHARED_SECRET = 'p'.repeat(64);
        const res = await request(makeApp()).post('/api/auth/login').set(XRW).send({ email: 'a@b.co', password: 'x' });
        expect(res.status).toBe(403);
    });

    test('when set, a wrong header value is refused', async () => {
        process.env.PROXY_SHARED_SECRET = 'p'.repeat(64);
        const res = await request(makeApp()).post('/api/auth/login').set(XRW).set('X-FinAssist-Proxy', 'q'.repeat(64))
            .send({ email: 'a@b.co', password: 'x' });
        expect(res.status).toBe(403);
    });

    test('when set, the right header reaches the route', async () => {
        process.env.PROXY_SHARED_SECRET = 'p'.repeat(64);
        const res = await request(makeApp()).post('/api/auth/login').set(XRW).set('X-FinAssist-Proxy', 'p'.repeat(64))
            .send({ email: 'nobody@b.co', password: 'whatever' });
        expect(res.status).toBe(401);
    });

    test('health stays reachable for the platform probe', async () => {
        process.env.PROXY_SHARED_SECRET = 'p'.repeat(64);
        const res = await request(makeApp()).get('/api/health');
        expect(res.status).toBe(200);
    });
});

describe('rate-limit scoping', () => {
    test('the strict auth limit applies to credential endpoints', async () => {
        process.env.RATE_LIMIT_AUTH_MAX = '2';
        const app = makeApp();
        const statuses = [];
        for (let i = 0; i < 3; i++) {
            statuses.push((await request(app).post('/api/auth/login').set(XRW).send({ email: `x${i}@b.co`, password: 'x' })).status);
        }
        expect(statuses[2]).toBe(429);
    });

    test('session refresh is not throttled by the strict auth limit', async () => {
        process.env.RATE_LIMIT_AUTH_MAX = '2';
        const app = makeApp();
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await request(app).post('/api/auth/refresh').set(XRW)).status);
        expect(statuses).not.toContain(429);
    });
});
