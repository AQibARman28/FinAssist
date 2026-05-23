/**
 * goalPlanning.js — pure feasibility + forecast math for savings goals (GOAL-1).
 * No DB: the controller passes plain goal data (target/current/targetDate +
 * contributions[]) and the user's monthlySurplus; everything here is
 * deterministic and unit-tested at the boundaries.
 *
 * Missing data is surfaced as explicit `null` ("flexible" / "no history yet"),
 * never fabricated.
 */

const MS_PER_MONTH = 30 * 86_400_000;

const STATUS = Object.freeze({
    ON_TRACK:     'On track',
    AT_RISK:      'At risk',
    NOT_FEASIBLE: 'Not feasible at current rate',
});

const round2 = (x) => Math.round(x * 100) / 100;
const round1 = (x) => Math.round(x * 10) / 10;

function monthsUntil(targetDate, nowMs) {
    return (new Date(targetDate).getTime() - nowMs) / MS_PER_MONTH;
}

// Recent contribution rate = sum of this goal's contributions in the trailing
// window ÷ window-in-months. null when there are no in-window contributions.
function recentMonthlyRate(contributions, nowMs, windowDays) {
    const cutoff = nowMs - windowDays * 86_400_000;
    let sum = 0;
    for (const c of contributions || []) {
        if (new Date(c.date).getTime() >= cutoff) sum += c.amount;
    }
    return sum > 0 ? sum / (windowDays / 30) : null;
}

function computeStatus({ dated, requiredMonthly, actualMonthlyRate, forecastDelta, monthlySurplus, currentAmount }) {
    if (!dated) {
        // Undated goals (defensive — the model currently requires a date):
        // no deadline pressure, so "started" reads as on track.
        return currentAmount > 0 ? STATUS.ON_TRACK : STATUS.AT_RISK;
    }
    // Can't afford it even if all surplus went here.
    if (requiredMonthly > monthlySurplus) return STATUS.NOT_FEASIBLE;
    if (requiredMonthly <= 0) return STATUS.ON_TRACK; // already met

    // The brief's rate-band and forecast-lateness conditions overlap (a
    // 50%-rate goal is also "many months late"). Resolve rate-ratio FIRST as
    // the primary classifier; forecast lateness then only WORSENS an
    // otherwise on-track goal (the rare on-rate-but-deadline-slipping case).
    const rate  = actualMonthlyRate ?? 0; // no recent contributions ⇒ rate 0
    const ratio = rate / requiredMonthly;

    let status;
    if (ratio >= 1)        status = STATUS.ON_TRACK;
    else if (ratio >= 0.5) status = STATUS.AT_RISK;
    else                   status = STATUS.NOT_FEASIBLE;

    if (status === STATUS.ON_TRACK && forecastDelta !== null) {
        if (forecastDelta > 3)      status = STATUS.NOT_FEASIBLE;
        else if (forecastDelta > 1) status = STATUS.AT_RISK;
    }
    return status;
}

// goal: { id, targetAmount, currentAmount, targetDate(Date|string|null), contributions:[{amount,date}] }
function planGoal(goal, { monthlySurplus, now, windowDays = 90 }) {
    const nowMs = now ?? Date.now();
    const remaining = Math.max(goal.targetAmount - goal.currentAmount, 0);
    const dated = goal.targetDate != null;

    const requiredMonthly = dated
        ? remaining / Math.max(monthsUntil(goal.targetDate, nowMs), 0.1)
        : null;

    const actualMonthlyRate = recentMonthlyRate(goal.contributions, nowMs, windowDays);

    const forecastMonths = actualMonthlyRate && actualMonthlyRate > 0
        ? remaining / actualMonthlyRate
        : null;

    const forecastDelta = dated && forecastMonths !== null
        ? forecastMonths - monthsUntil(goal.targetDate, nowMs)
        : null;

    const status = computeStatus({
        dated, requiredMonthly, actualMonthlyRate, forecastDelta,
        monthlySurplus, currentAmount: goal.currentAmount,
    });

    return {
        goalId:            goal.id,
        requiredMonthly:   requiredMonthly   === null ? null : round2(requiredMonthly),
        actualMonthlyRate: actualMonthlyRate === null ? null : round2(actualMonthlyRate),
        forecastMonths:    forecastMonths    === null ? null : round1(forecastMonths),
        forecastDelta:     forecastDelta     === null ? null : round1(forecastDelta),
        status,
    };
}

function planPortfolio(goalPlans, monthlySurplus) {
    const totalRequired = goalPlans.reduce((s, g) => s + (g.requiredMonthly ?? 0), 0);
    return {
        totalRequired:    round2(totalRequired),
        availableSurplus: round2(monthlySurplus),
        overcommitted:    totalRequired > monthlySurplus,
    };
}

function planGoals({ goals, monthlySurplus, now, windowDays = 90 }) {
    const nowMs = now ?? Date.now();
    const plans = goals.map((g) => planGoal(g, { monthlySurplus, now: nowMs, windowDays }));
    return { goals: plans, portfolio: planPortfolio(plans, monthlySurplus) };
}

// ── Surplus allocation decider (recommend-and-confirm; records nothing) ──────
//
// Tiers (priority order): 0 Emergency Fund (up to baseline = 3×monthlyAvgExpenses),
// 1 dated goals by soonest targetDate (tiebreak priority desc), 2 undated by
// priority desc (dormant — model requires a date). Greedy-fill each up to its
// monthly need until surplus is exhausted; leftover = freeSurplus; underfunded
// dated goals get a {shortfall, extendMonths} tradeoff.
function allocateSurplus({ goals, monthlySurplus, monthlyAvgExpenses, now }) {
    const nowMs = now ?? Date.now();
    const baseline = 3 * monthlyAvgExpenses;

    const enriched = goals.map((g) => {
        const remaining   = Math.max(g.targetAmount - g.currentAmount, 0);
        const dated       = g.targetDate != null;
        const monthsLeft  = dated ? Math.max(monthsUntil(g.targetDate, nowMs), 0.1) : null;
        const requiredMonthly = dated ? remaining / monthsLeft : null;
        const isEmergency = g.goalType === 'Emergency Fund';

        let need;
        if (isEmergency) {
            const gapToBaseline = Math.max(baseline - g.currentAmount, 0);
            need = Math.min(requiredMonthly ?? gapToBaseline, gapToBaseline);
        } else if (dated) {
            need = requiredMonthly;
        } else {
            need = 0; // undated: leftover only
        }
        return { ...g, remaining, dated, monthsLeft, requiredMonthly, isEmergency, need: Math.max(need, 0) };
    });

    const emergency  = enriched.filter((g) => g.isEmergency);
    const datedNon   = enriched.filter((g) => !g.isEmergency && g.dated)
        .sort((a, b) => (new Date(a.targetDate) - new Date(b.targetDate)) || ((b.priority ?? 0) - (a.priority ?? 0)));
    const undatedNon = enriched.filter((g) => !g.isEmergency && !g.dated)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const order = [...emergency, ...datedNon, ...undatedNon];

    let remainingSurplus = Math.max(monthlySurplus, 0);
    const allocMap = new Map();
    for (const g of order) {
        const alloc = Math.max(0, Math.min(remainingSurplus, g.need));
        allocMap.set(g.id, alloc);
        remainingSurplus -= alloc;
    }

    const allocations = order.map((g) => ({ goalId: g.id, suggested: round2(allocMap.get(g.id) || 0) }));

    const tradeoffs = [];
    for (const g of order) {
        if (!g.dated) continue;
        const allocated = allocMap.get(g.id) || 0;
        const shortfall = (g.requiredMonthly ?? 0) - allocated;
        if (shortfall > 0.005) {
            const extendMonths = allocated > 0 ? round1((g.remaining / allocated) - g.monthsLeft) : null;
            tradeoffs.push({ goalId: g.id, shortfall: round2(shortfall), extendMonths });
        }
    }

    const totalRequired = enriched.reduce((s, g) => s + (g.requiredMonthly ?? 0), 0);

    return {
        monthlySurplus:    round2(monthlySurplus),
        emergencyBaseline: round2(baseline),
        allocations,
        freeSurplus:       round2(Math.max(remainingSurplus, 0)),
        tradeoffs,
        overcommitted:     totalRequired > monthlySurplus,
    };
}

module.exports = {
    STATUS,
    MS_PER_MONTH,
    monthsUntil,
    recentMonthlyRate,
    computeStatus,
    planGoal,
    planPortfolio,
    planGoals,
    allocateSurplus,
};
