/**
 * balance service — the single continuous pocket + monthly/yearly classification.
 * Pure helpers (summarize, savedInWindow, periodWindow) tested without a DB;
 * getBalance/carriedForward are exercised through the controller/smoke path.
 */

const { summarize, savedInWindow, periodWindow } = require('../services/balance');

describe('summarize (pure)', () => {
    test('netIncome = income - expenses; closing folds in carry-forward and savings', () => {
        expect(summarize({ carriedForward: 1000, income: 5000, expenses: 2000, saved: 800 }))
            .toEqual({ netIncome: 3000, closing: 3200 }); // 1000 + 5000 - 2000 - 800
    });
    test('no carry-forward defaults to 0', () => {
        expect(summarize({ income: 100, expenses: 40, saved: 10 }))
            .toEqual({ netIncome: 60, closing: 50 });
    });
    test('over-spent period → negative closing (no clamping)', () => {
        const r = summarize({ carriedForward: 0, income: 100, expenses: 250, saved: 0 });
        expect(r.netIncome).toBe(-150);
        expect(r.closing).toBe(-150);
    });
    test('savings is NOT part of net income, only of closing', () => {
        const r = summarize({ carriedForward: 0, income: 1000, expenses: 0, saved: 1000 });
        expect(r.netIncome).toBe(1000); // saving doesn't reduce net income
        expect(r.closing).toBe(0);      // but it leaves the pocket
    });
});

describe('periodWindow (pure)', () => {
    const now = new Date(2026, 4, 30, 15, 0, 0); // May 30 2026
    test('monthly → from = 1st of month', () => {
        const { from, to } = periodWindow('monthly', now);
        expect(from.getMonth()).toBe(4);
        expect(from.getDate()).toBe(1);
        expect(to.getTime()).toBe(now.getTime());
    });
    test('yearly → from = Jan 1', () => {
        const { from } = periodWindow('yearly', now);
        expect(from.getMonth()).toBe(0);
        expect(from.getDate()).toBe(1);
    });
});

describe('savedInWindow (pure)', () => {
    const goals = [
        { period: 'monthly', contributions: [
            { amount: 1000, date: new Date(2026, 4, 10) },
            { amount: 2000, date: new Date(2026, 3, 25) },
        ] },
        { period: 'yearly', contributions: [
            { amount: 500, date: new Date(2026, 4, 12) },
        ] },
    ];
    test('sums EVERY goal contribution in window regardless of goal period (continuous flow)', () => {
        const from = new Date(2026, 4, 1), to = new Date(2026, 4, 31, 23, 59, 59);
        expect(savedInWindow(goals, from, to)).toBe(1500); // 1000 (monthly) + 500 (yearly)
    });
    test('open-ended "before" window (to = null) sums everything up to from-bound via to', () => {
        // Everything strictly before May 1 → only the Apr 25 contribution.
        const end = new Date(2026, 4, 1, 0, 0, 0, 0);
        const before = new Date(end.getTime() - 1);
        expect(savedInWindow(goals, new Date(0), before)).toBe(2000);
    });
    test('no contributions → 0', () => {
        expect(savedInWindow([{ contributions: [] }], new Date(0), new Date())).toBe(0);
    });
});
