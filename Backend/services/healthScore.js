/**
 * healthScore.js — pure, DB-independent financial-health scoring.
 *
 * The controller fetches the raw inputs (income/expense over the window,
 * per-category budget vs spent, active goals, weekly spend series) and passes
 * them in; everything here is deterministic and unit-tested at the boundaries.
 *
 * Each factor returns { score: 0-100 | null, weight, label, detail }. A `null`
 * score means "no data to measure this" — it is EXCLUDED from the composite and
 * the remaining weights are renormalized. We never fabricate a number or
 * default-punish (that was the old bug: missing data → a misleading 20).
 * Exception (G6): spending with zero income is NOT missing data — the
 * savings-rate and expense-to-income factors score 0 so the deficit counts.
 */

const { STATUS, goalVerdict, evenPaceFraction } = require('./goalPlanning');

const HEALTH_WINDOW_DAYS = 90;

const WEIGHTS = Object.freeze({
    savings:   30,
    budget:    25,
    goal:      20,
    stability: 15,
    ratio:     10,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// attention: the factor's words name something to fix, so its row shows a
// warning. Budgets and goals say so whenever one is over, behind or out of
// reach (their average can still be 50 or more); the others below the weak
// line. A factor without data is never flagged.
const WEAK = 50;
const flag = (factor, attention) => ({
    ...factor,
    attention: factor.score !== null && (attention ?? factor.score < WEAK),
});

// Zero income in the window is only "missing data" when there is no spending
// either. Spending with no income is a deficit, so the income-based factors
// score 0 instead of dropping out (G6). Otherwise a user with steady spending
// and no income was rated on stability alone and showed 100/"Excellent".
const hasSpending = (expense) => typeof expense === 'number' && expense > 0;

// ── Factor 1: savings rate (weight 30) ───────────────────────────────────────
function savingsRateFactor(income, expense) {
    const base = { weight: WEIGHTS.savings, label: 'Savings rate' };
    if (!income || income <= 0) {
        if (hasSpending(expense)) return flag({ ...base, score: 0, detail: 'Spending with no income logged' });
        return flag({ ...base, score: null, detail: 'No income logged yet' });
    }

    const rate = (income - expense) / income;
    let score;
    if      (rate >= 0.20) score = 100;
    else if (rate >= 0.10) score = 60 + ((rate - 0.10) / 0.10) * 40;
    else if (rate >= 0)    score = 20 + (rate / 0.10) * 40;
    else                   score = clamp(20 + rate * 100, 0, 20);
    score = clamp(Math.round(score), 0, 100);

    const pct = Math.round(rate * 100);
    const detail = rate >= 0 ? `Saving ${pct}% of income` : `Spending exceeds income by ${Math.abs(pct)}%`;
    return flag({ ...base, score, detail });
}

// ── Factor 2: budget adherence (weight 25) ───────────────────────────────────
// budgets: [{ limit, spent }] — already category-resolved + window-scoped by
// the controller (matched on the CORRECT Category ObjectId, not the stale
// Budget.spent / String-enum mismatch that was the historical bug).
function budgetAdherenceFactor(budgets) {
    const base = { weight: WEIGHTS.budget, label: 'Budget adherence' };
    const valid = (budgets || []).filter((b) => b && b.limit > 0);
    if (valid.length === 0) return flag({ ...base, score: null, detail: 'No budgets set' });

    const totalLimit = valid.reduce((s, b) => s + b.limit, 0);
    let weighted = 0, over = 0;
    for (const b of valid) {
        const adh = clamp(1 - Math.max(0, b.spent - b.limit) / b.limit, 0, 1);
        weighted += adh * b.limit;
        if (b.spent > b.limit) over++;
    }
    const score = clamp(Math.round((weighted / totalLimit) * 100), 0, 100);
    const detail = over === 0
        ? `Within ${valid.length === 1 ? "your budget" : `all ${valid.length} budgets`}`
        : `Over budget in ${over} of ${valid.length}`;
    return flag({ ...base, score, detail }, over > 0);
}

// ── Factor 3: goal progress (weight 20) ──────────────────────────────────────
// goals: [{ currentAmount, targetAmount, targetDate(Date|null), createdAt(Date) }]
// Each dated goal gets the goals plan's own verdict (goalPlanning.goalVerdict),
// so this factor and the Goals page always agree. On pace scores 100, behind
// scores in proportion to the even pace, and a goal the monthly surplus can't
// fund in time scores 0. Without a surplus, pace alone decides.
function goalProgressFactor(goals, nowMs, monthlySurplus, leftOver = 0) {
    const base = { weight: WEIGHTS.goal, label: 'Goal progress' };
    if (!goals || goals.length === 0) return flag({ ...base, score: null, detail: 'No active goals' });

    let sum = 0, behind = 0, outOfReach = 0;
    for (const g of goals) {
        const actual = g.targetAmount > 0 ? g.currentAmount / g.targetAmount : 0;
        let s;
        if (!g.targetDate) {
            s = clamp(actual, 0, 1) * 100;
        } else {
            const verdict = goalVerdict(g, { monthlySurplus, leftOver, now: nowMs });
            if (verdict === STATUS.NOT_FEASIBLE) {
                s = 0;
                outOfReach++;
            } else if (verdict === STATUS.AT_RISK) {
                s = clamp(actual / Math.max(evenPaceFraction(g, nowMs), 0.01), 0, 1) * 100;
                behind++;
            } else {
                s = 100;
            }
        }
        sum += s;
    }
    const score = clamp(Math.round(sum / goals.length), 0, 100);
    return flag({ ...base, score, detail: goalDetail(goals.length, behind, outOfReach) }, behind + outOfReach > 0);
}

// In the Goals page's words: "On track", "behind", "out of reach".
function goalDetail(n, behind, outOfReach) {
    if (behind === 0 && outOfReach === 0) return n === 1 ? 'On track on your goal' : `On track on all ${n} goals`;
    if (n === 1) return outOfReach ? 'Your goal is out of reach' : 'Your goal is behind';
    const parts = [];
    if (behind) parts.push(`${behind} of ${n} goals behind`);
    if (outOfReach) parts.push(behind ? `${outOfReach} out of reach` : `${outOfReach} of ${n} goals out of reach`);
    return parts.join(', ');
}

// ── Factor 4: spending stability (weight 15) ─────────────────────────────────
// weeklySpends: weekly totals over the window. CV = stddev/mean (population).
function spendingStabilityFactor(weeklySpends) {
    const base = { weight: WEIGHTS.stability, label: 'Spending stability' };
    const weeks = (weeklySpends || []).filter((x) => typeof x === 'number');
    if (weeks.length < 3) return flag({ ...base, score: null, detail: 'Need 3+ weeks of data' });

    const mean = weeks.reduce((s, x) => s + x, 0) / weeks.length;
    if (mean <= 0) return flag({ ...base, score: null, detail: 'Need 3+ weeks of data' });

    const variance = weeks.reduce((s, x) => s + (x - mean) ** 2, 0) / weeks.length;
    const cv = Math.sqrt(variance) / mean;
    const score = clamp(Math.round(100 * (1 - Math.min(cv, 1))), 0, 100);
    const detail = cv < 0.3 ? 'Steady week to week' : cv < 0.6 ? 'Some week-to-week swing' : 'Spending varies a lot';
    return flag({ ...base, score, detail });
}

// ── Factor 5: expense-to-income ratio (weight 10) ────────────────────────────
function expenseIncomeRatioFactor(income, expense) {
    const base = { weight: WEIGHTS.ratio, label: 'Expense-to-income' };
    if (!income || income <= 0) {
        if (hasSpending(expense)) return flag({ ...base, score: 0, detail: 'Spending with no income logged' });
        return flag({ ...base, score: null, detail: 'No income logged yet' });
    }

    const r = expense / income;
    let score;
    if      (r < 0.7) score = 100;
    else if (r <= 1.0) score = 100 - ((r - 0.7) / 0.3) * 60;
    else if (r <= 1.3) score = 40 - ((r - 1.0) / 0.3) * 40;
    else               score = 0;
    score = clamp(Math.round(score), 0, 100);
    return flag({ ...base, score, detail: `Expenses are ${Math.round(r * 100)}% of income` });
}

function bandFor(score) {
    if (score < 40) return 'Needs attention';
    if (score < 60) return 'Fair';
    if (score < 80) return 'Good';
    return 'Excellent';
}

function buildMessage(contributor, detractor) {
    if (contributor.label === detractor.label) return `Based on your ${contributor.label.toLowerCase()}.`;
    if (detractor.score >= 60) return `Healthy across the board — ${contributor.label.toLowerCase()} leads.`;
    return `${contributor.label} is strong, but ${detractor.label.toLowerCase()} needs attention.`;
}

// ── Composite ────────────────────────────────────────────────────────────────
// monthlySurplus: average monthly income minus spending (services/cashFlow),
// and leftOver: money from earlier months still in the wallet
// (balance.leftOverFromEarlier). The same figures the goals plan uses.
function computeHealthScore({ income, expense, budgets, goals, weeklySpends, monthlySurplus, leftOver = 0, now }) {
    const nowMs = now ?? Date.now();
    const factors = [
        savingsRateFactor(income, expense),
        budgetAdherenceFactor(budgets),
        goalProgressFactor(goals, nowMs, monthlySurplus, leftOver),
        spendingStabilityFactor(weeklySpends),
        expenseIncomeRatioFactor(income, expense),
    ];

    const active = factors.filter((f) => f.score !== null);
    if (active.length === 0) {
        return {
            status: 'building',
            score: null,
            band: null,
            factors,
            contributor: null,
            detractor: null,
            message: 'Add a budget or log income to start your score',
        };
    }

    const wsum = active.reduce((s, f) => s + f.weight, 0);
    const score = Math.round(active.reduce((s, f) => s + f.score * f.weight, 0) / wsum);
    const band = bandFor(score);
    const contributor = active.reduce((a, b) => (b.score > a.score ? b : a));
    const detractor   = active.reduce((a, b) => (b.score < a.score ? b : a));

    return {
        status: 'ok',
        score,
        band,
        factors,
        contributor: { label: contributor.label, score: contributor.score },
        detractor:   { label: detractor.label,   score: detractor.score },
        message: buildMessage(contributor, detractor),
    };
}

module.exports = {
    HEALTH_WINDOW_DAYS,
    WEIGHTS,
    savingsRateFactor,
    budgetAdherenceFactor,
    goalProgressFactor,
    spendingStabilityFactor,
    expenseIncomeRatioFactor,
    bandFor,
    computeHealthScore,
};
