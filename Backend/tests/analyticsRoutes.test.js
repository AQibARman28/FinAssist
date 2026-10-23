/**
 * G5 — the deprecated GET /api/analytics/recurring-expenses endpoint (it only
 * ever returned [] since descriptions became encrypted) is removed, together
 * with its dead frontend widget. Its replacement stays.
 */
const crypto = require('node:crypto');

beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    process.env.EMAIL_HASH_SECRET     = process.env.EMAIL_HASH_SECRET     || crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET            = process.env.JWT_SECRET            || crypto.randomBytes(32).toString('hex');
});

const routesOf = (router) => router.stack
    .filter((l) => l.route)
    .flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));

describe('analytics routes (G5)', () => {
    test('GET /recurring-expenses is gone; /recurring-income remains', () => {
        const routes = routesOf(require('../routes/analyticsRoutes'));
        expect(routes).not.toContain('GET /recurring-expenses');
        expect(routes).toContain('GET /recurring-income');
    });

    test('the controller no longer exports the deprecated handler', () => {
        const ctl = require('../controllers/analyticsController');
        expect(ctl.recurringExpenses).toBeUndefined();
        expect(typeof ctl.recurringIncome).toBe('function');
    });
});
