/**
 * cashFlow.js — the single source of truth for "income minus expenses" over a
 * trailing window. Goals (GOAL-1) use it for surplus; HS-1's savings-rate
 * factor could later reuse it instead of computing income/expense inline.
 *
 * The DB reads live in getCashFlow; the arithmetic is the pure
 * summarizeCashFlow helper so it can be unit-tested without a database.
 */

const { incomeTotalForPeriod, expenseTotalForPeriod } = require('../utils/finance');

// Pure: window totals → surplus + monthly averages. Guarded against a
// zero/negative window so callers never see NaN/Infinity.
function summarizeCashFlow({ income, expenses, windowDays }) {
    const months = windowDays > 0 ? windowDays / 30 : 0;
    const monthlyAvgIncome   = months > 0 ? income / months : 0;
    const monthlyAvgExpenses = months > 0 ? expenses / months : 0;
    return {
        income,
        expenses,
        surplus: income - expenses,
        monthlyAvgIncome,
        monthlyAvgExpenses,
        monthlySurplus: monthlyAvgIncome - monthlyAvgExpenses,
    };
}

// IDOR-scoped via the userId passed straight into the finance helpers
// ($match on user). Returns the same shape as summarizeCashFlow.
async function getCashFlow(userId, windowDays = 90) {
    const now  = new Date();
    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, from, now),
        expenseTotalForPeriod(userId, from, now),
    ]);
    return summarizeCashFlow({ income, expenses, windowDays });
}

module.exports = { getCashFlow, summarizeCashFlow };
