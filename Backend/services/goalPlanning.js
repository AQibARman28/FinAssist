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

const DAY_MS = 86_400_000;
// Less history than this and a monthly rate (and a finish date from it) says
// more about the calendar than about the saving.
const MIN_HISTORY_DAYS = 30;

// The share of the target an even pace would have saved by now, from the day
// the goal was set to its deadline: 0 the day it's set, 1 once the deadline
// passes. The goal card's tick shows the same pace. null when undated.
function evenPaceFraction(goal, nowMs) {
    if (goal.targetDate == null) return null;
    const start = goal.createdAt ? new Date(goal.createdAt).getTime() : nowMs;
    const span = new Date(goal.targetDate).getTime() - start;
    return span > 0 ? Math.min(Math.max((nowMs - start) / span, 0), 1) : 1;
}

// Recent contribution rate = this goal's contributions in the trailing window
// ÷ the window in months. The window never reaches back before the goal was
// set (a goal set last week isn't averaged over three months it didn't
// exist), and counts as at least a month. null when nothing was added in it.
function recentMonthlyRate(contributions, nowMs, windowDays, createdAt) {
    const cutoff = nowMs - windowDays * DAY_MS;
    let sum = 0;
    for (const c of contributions || []) {
        if (new Date(c.date).getTime() >= cutoff) sum += c.amount;
    }
    const from = createdAt ? Math.max(cutoff, new Date(createdAt).getTime()) : cutoff;
    const months = Math.max(nowMs - from, MIN_HISTORY_DAYS * DAY_MS) / MS_PER_MONTH;
    return sum > 0 ? sum / months : null;
}

// The one verdict for a goal, shared by the goals plan and the health score so
// the two never disagree (PRODUCT.md › Plan from real money):
//   Not feasible — what's left, after money already left over from earlier
//                  months, needs more each month than the whole surplus;
//   At risk      — affordable, but less saved than an even pace would have
//                  had by yesterday;
//   On track     — affordable, and on or ahead of that pace.
// The recent contribution rate doesn't decide it: a goal set yesterday has no
// rate yet. Without a surplus (none passed), pace alone decides.
// goal: { targetAmount, currentAmount, targetDate, createdAt }
// leftOver: money from earlier months still in the wallet (balance.leftOverFromEarlier).
function goalVerdict(goal, { monthlySurplus, leftOver = 0, now } = {}) {
    const nowMs = now ?? Date.now();
    if (goal.targetDate == null) {
        // Undated goals (defensive — the model currently requires a date):
        // no deadline pressure, so "started" reads as on track.
        return goal.currentAmount > 0 ? STATUS.ON_TRACK : STATUS.AT_RISK;
    }
    const remaining = Math.max(goal.targetAmount - goal.currentAmount, 0);
    if (remaining <= 0) return STATUS.ON_TRACK; // already met

    const fromSurplus = Math.max(remaining - Math.max(leftOver, 0), 0);
    const neededMonthly = fromSurplus / Math.max(monthsUntil(goal.targetDate, nowMs), 0.1);
    if (monthlySurplus != null && fromSurplus > 0 && neededMonthly > monthlySurplus) return STATUS.NOT_FEASIBLE;

    // Behind once it trails where the pace stood a day ago, so a goal set
    // today isn't behind seconds later for not having its first day's share.
    const saved = goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount : 0;
    return saved < evenPaceFraction(goal, nowMs - DAY_MS) ? STATUS.AT_RISK : STATUS.ON_TRACK;
}

// goal: { id, targetAmount, currentAmount, targetDate(Date|string|null), createdAt?, contributions:[{amount,date}] }
function planGoal(goal, { monthlySurplus, leftOver = 0, now, windowDays = 90 }) {
    const nowMs = now ?? Date.now();
    const remaining = Math.max(goal.targetAmount - goal.currentAmount, 0);
    const dated = goal.targetDate != null;

    const requiredMonthly = dated
        ? remaining / Math.max(monthsUntil(goal.targetDate, nowMs), 0.1)
        : null;

    const actualMonthlyRate = recentMonthlyRate(goal.contributions, nowMs, windowDays, goal.createdAt);

    // A finish date needs a month of history to project from.
    const age = goal.createdAt ? nowMs - new Date(goal.createdAt).getTime() : Infinity;
    const forecastMonths = actualMonthlyRate && actualMonthlyRate > 0 && age >= MIN_HISTORY_DAYS * DAY_MS
        ? remaining / actualMonthlyRate
        : null;

    const forecastDelta = dated && forecastMonths !== null
        ? forecastMonths - monthsUntil(goal.targetDate, nowMs)
        : null;

    const status = goalVerdict(goal, { monthlySurplus, leftOver, now: nowMs });

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

function planGoals({ goals, monthlySurplus, leftOver = 0, now, windowDays = 90 }) {
    const nowMs = now ?? Date.now();
    const plans = goals.map((g) => planGoal(g, { monthlySurplus, leftOver, now: nowMs, windowDays }));
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
        // What this month can usefully take. Under a month from the deadline
        // the monthly rate is more than the goal still needs; never suggest that.
        const dueThisMonth = dated ? Math.min(requiredMonthly, remaining) : null;
        const isEmergency = g.goalType === 'Emergency Fund';

        let need;
        if (isEmergency) {
            const gapToBaseline = Math.max(baseline - g.currentAmount, 0);
            need = Math.min(dueThisMonth ?? gapToBaseline, gapToBaseline);
        } else if (dated) {
            need = dueThisMonth;
        } else {
            need = 0; // undated: leftover only
        }
        return { ...g, remaining, dated, monthsLeft, requiredMonthly, dueThisMonth, isEmergency, need: Math.max(need, 0) };
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
        const shortfall = (g.dueThisMonth ?? 0) - allocated;
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
    evenPaceFraction,
    goalVerdict,
    planGoal,
    planPortfolio,
    planGoals,
    allocateSurplus,
};
