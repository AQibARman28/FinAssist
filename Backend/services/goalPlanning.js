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

module.exports = {
    STATUS,
    MS_PER_MONTH,
    monthsUntil,
    recentMonthlyRate,
    computeStatus,
    planGoal,
    planPortfolio,
    planGoals,
};
