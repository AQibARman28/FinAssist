/**
 * HS-1 Phase 2 — pure scoring service. No DB: every input is passed directly,
 * so these are fast, deterministic boundary tests.
 */

const {
    savingsRateFactor,
    budgetAdherenceFactor,
    goalProgressFactor,
    spendingStabilityFactor,
    expenseIncomeRatioFactor,
    bandFor,
    computeHealthScore,
    WEIGHTS,
} = require('../services/healthScore');

const DAY = 86_400_000;

describe('savingsRateFactor (w30)', () => {
    test('no income → null (excluded, never punished)', () => {
        expect(savingsRateFactor(0, 100).score).toBeNull();
    });
    test('boundary mappings', () => {
        expect(savingsRateFactor(1000, 800).score).toBe(100); // rate 0.20
        expect(savingsRateFactor(1000, 900).score).toBe(60);  // rate 0.10
        expect(savingsRateFactor(1000, 850).score).toBe(80);  // rate 0.15
        expect(savingsRateFactor(1000, 1000).score).toBe(20); // rate 0
        expect(savingsRateFactor(1000, 950).score).toBe(40);  // rate 0.05
        expect(savingsRateFactor(1000, 1100).score).toBe(10); // rate -0.10
        expect(savingsRateFactor(1000, 1500).score).toBe(0);  // rate -0.50 clamps
    });
});

describe('budgetAdherenceFactor (w25)', () => {
    test('no budgets → null', () => {
        expect(budgetAdherenceFactor([]).score).toBeNull();
        expect(budgetAdherenceFactor([{ limit: 0, spent: 5 }]).score).toBeNull(); // zero-limit excluded
    });
    test('under / over / weighted', () => {
        expect(budgetAdherenceFactor([{ limit: 100, spent: 50 }]).score).toBe(100);
        expect(budgetAdherenceFactor([{ limit: 100, spent: 150 }]).score).toBe(50);
        // budget-weighted: small fully-adhered + large fully-blown
        expect(budgetAdherenceFactor([{ limit: 100, spent: 0 }, { limit: 300, spent: 600 }]).score).toBe(25);
    });
});

describe('goalProgressFactor (w20)', () => {
    const now = Date.now();
    test('no active goals → null', () => {
        expect(goalProgressFactor([], now).score).toBeNull();
    });
    test('on pace → 100, behind → proportional', () => {
        const onPace = goalProgressFactor([
            { currentAmount: 50, targetAmount: 100, targetDate: new Date(now + 50 * DAY), createdAt: new Date(now - 50 * DAY) },
        ], now);
        expect(onPace.score).toBe(100); // actual 0.5 / expected 0.5

        const behind = goalProgressFactor([
            { currentAmount: 25, targetAmount: 100, targetDate: new Date(now + 50 * DAY), createdAt: new Date(now - 50 * DAY) },
        ], now);
        expect(behind.score).toBe(50);  // actual 0.25 / expected 0.5
    });
    test('no target date → actual fraction', () => {
        expect(goalProgressFactor([{ currentAmount: 30, targetAmount: 100, targetDate: null, createdAt: new Date(now) }], now).score).toBe(30);
    });
});

describe('spendingStabilityFactor (w15)', () => {
    test('fewer than 3 weeks → null', () => {
        expect(spendingStabilityFactor([100, 100]).score).toBeNull();
    });
    test('zero mean → null', () => {
        expect(spendingStabilityFactor([0, 0, 0]).score).toBeNull();
    });
    test('perfectly steady → 100', () => {
        expect(spendingStabilityFactor([100, 100, 100]).score).toBe(100);
    });
    test('variable → lower', () => {
        expect(spendingStabilityFactor([50, 100, 150]).score).toBe(59); // CV ~0.408
    });
});

describe('expenseIncomeRatioFactor (w10)', () => {
    test('no income → null', () => {
        expect(expenseIncomeRatioFactor(0, 100).score).toBeNull();
    });
    test('boundary mappings', () => {
        expect(expenseIncomeRatioFactor(1000, 500).score).toBe(100); // r 0.5
        expect(expenseIncomeRatioFactor(1000, 700).score).toBe(100); // r 0.7
        expect(expenseIncomeRatioFactor(1000, 850).score).toBe(70);  // r 0.85
        expect(expenseIncomeRatioFactor(1000, 1000).score).toBe(40); // r 1.0
        expect(expenseIncomeRatioFactor(1000, 1150).score).toBe(20); // r 1.15
        expect(expenseIncomeRatioFactor(1000, 1300).score).toBe(0);  // r 1.3
        expect(expenseIncomeRatioFactor(1000, 5000).score).toBe(0);  // r 5
    });
});

describe('bandFor', () => {
    test('band boundaries', () => {
        expect(bandFor(39)).toBe('Needs attention');
        expect(bandFor(40)).toBe('Fair');
        expect(bandFor(59)).toBe('Fair');
        expect(bandFor(60)).toBe('Good');
        expect(bandFor(79)).toBe('Good');
        expect(bandFor(80)).toBe('Excellent');
        expect(bandFor(100)).toBe('Excellent');
    });
});

describe('computeHealthScore — composite & renormalization', () => {
    test('all factors null → building status, never a number', () => {
        const r = computeHealthScore({ income: 0, expense: 0, budgets: [], goals: [], weeklySpends: [] });
        expect(r.status).toBe('building');
        expect(r.score).toBeNull();
        expect(r.band).toBeNull();
        expect(r.factors).toHaveLength(5);
        expect(r.factors.every((f) => f.score === null)).toBe(true);
    });

    test('REGRESSION: no budgets set does NOT yield 20 — scores on the rest', () => {
        const r = computeHealthScore({ income: 1000, expense: 500, budgets: [], goals: [], weeklySpends: [] });
        expect(r.status).toBe('ok');
        // savings 0.5 → 100 (w30), ratio 0.5 → 100 (w10); budget/goal/stability null
        expect(r.score).toBe(100);
        expect(r.score).not.toBe(20);
        const budgetFactor = r.factors.find((f) => f.label === 'Budget adherence');
        expect(budgetFactor.score).toBeNull();
    });

    test('weights renormalize over active factors only', () => {
        // savings 100 (w30), budget 0 (w25, fully blown), ratio 100 (w10); goal+stability null
        const r = computeHealthScore({
            income: 1000, expense: 500,
            budgets: [{ limit: 100, spent: 200 }],
            goals: [], weeklySpends: [],
        });
        // (100*30 + 0*25 + 100*10) / (30+25+10) = 4000/65 = 61.5 → 62
        expect(r.score).toBe(62);
    });

    test('no income but expenses → income-based factors excluded, not a stuck 20', () => {
        // only stability is measurable here
        const r = computeHealthScore({ income: 0, expense: 300, budgets: [], goals: [], weeklySpends: [100, 100, 100] });
        expect(r.status).toBe('ok');
        expect(r.score).toBe(100); // stability only
        expect(r.factors.find((f) => f.label === 'Savings rate').score).toBeNull();
    });

    test('blended realistic scenario → band + contributor/detractor', () => {
        const now = Date.now();
        const r = computeHealthScore({
            income: 1000, expense: 850,                          // savings 0.15→80, ratio 0.85→70
            budgets: [{ limit: 200, spent: 250 }],               // adh clamp(1-50/200)=0.75→75
            goals: [{ currentAmount: 25, targetAmount: 100, targetDate: new Date(now + 50 * DAY), createdAt: new Date(now - 50 * DAY) }], // 50
            weeklySpends: [100, 100, 100],                       // 100
            now,
        });
        // (80*30 + 75*25 + 50*20 + 100*15 + 70*10) / 100 = (2400+1875+1000+1500+700)/100 = 7475/100 = 75
        expect(r.score).toBe(75);
        expect(r.band).toBe('Good');
        expect(r.contributor.label).toBe('Spending stability'); // 100
        expect(r.detractor.label).toBe('Goal progress');        // 50
        expect(typeof r.message).toBe('string');
    });
});
