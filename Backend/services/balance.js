/**
 * balance.js — the single continuous "pocket" balance behind the app.
 *
 * Real life, not auto-savings:
 *   - income − real expenses = net income, which CARRIES FORWARD as the next
 *     period's opening balance.
 *   - Saving is an explicit act (putting money into a goal). A saved amount
 *     leaves the pocket, so it's deducted like an outflow (shown green on the
 *     UI — set aside, not spent). It is NOT a real Expense record, so it never
 *     pollutes expenseTotalForPeriod / budgets / analytics.
 *
 * One continuous flow, classified by period:
 *   carriedForward(from) = cumulative (income − expenses − saved) BEFORE `from`
 *   for a window [from, now]:
 *     netIncome = income − expenses
 *     closing   = carriedForward + income − expenses − saved
 *   available  = cumulative (income − expenses − saved) THROUGH now
 *
 * Key identity: the CURRENT month's closing === the CURRENT year's closing
 * === `available`. The monthly/yearly toggle only re-classifies how that same
 * number was built — there is one pocket, not two pools.
 *
 * Hard cap: a new save of X is allowed iff X <= available (see goalController).
 *
 * Deleted goals (G3) are archived, not removed: their contributions still
 * count as outflows at their own dates (so past closings never change) and
 * the goal's `releasedAmount` flows back in at `deletedAt`:
 *   closing = carriedForward + income − expenses − saved + released − savingsOut
 *
 * DB reads use the canonical finance helpers; the arithmetic is pure so it
 * unit-tests without a database (tests/balance.test.js).
 */

const { incomeTotalForPeriod, expenseTotalForPeriod } = require('../utils/finance');

const EPOCH = new Date(0); // floor for "all time before X" cumulative windows

// Pure: derive the figures the UI shows for a period. `savingsOut` is the net
// amount moved into the standalone Savings account in the window (deposits −
// withdrawals); it leaves the Wallet just like a goal contribution.
// `released` is money returned to the Wallet from deleted goals in the window.
function summarize({ carriedForward, income, expenses, saved, savingsOut = 0, released = 0 }) {
    const cf = carriedForward || 0;
    const netIncome = income - expenses;
    return { netIncome, closing: cf + income - expenses - saved + released - savingsOut };
}

// Pure: the [from, now] window for a period.
function periodWindow(period, now = new Date()) {
    const ref = now instanceof Date ? now : new Date(now);
    const from = period === 'yearly'
        ? new Date(ref.getFullYear(), 0, 1)
        : new Date(ref.getFullYear(), ref.getMonth(), 1);
    return { from, to: ref };
}

// A deleted goal's contributions count up to its deletion; anything dated
// after deletedAt (e.g. a future-dated allocation) never left the wallet.
function countedContributions(goal) {
    const all = goal.contributions || [];
    if (!goal.deletedAt) return all;
    const cut = new Date(goal.deletedAt).getTime();
    return all.filter((c) => new Date(c.date).getTime() <= cut);
}

// What deleting `goal` at `at` returns to the wallet: everything counted
// as set aside up to that moment.
function releasableAmount(goal, at) {
    const cut = new Date(at).getTime();
    return (goal.contributions || [])
        .filter((c) => new Date(c.date).getTime() <= cut)
        .reduce((s, c) => s + c.amount, 0);
}

// Pure: sum of EVERY goal contribution dated in [from, to] (no period split —
// savings is one continuous flow). `to` omitted ⇒ open-ended (used for "before").
// Includes deleted goals' contributions — that history is real.
function savedInWindow(goals, from, to = null) {
    let total = 0;
    const fromMs = from ? from.getTime() : -Infinity;
    const toMs = to ? to.getTime() : Infinity;
    for (const g of goals || []) {
        for (const c of countedContributions(g)) {
            const t = new Date(c.date).getTime();
            if (t >= fromMs && t <= toMs) total += c.amount;
        }
    }
    return total;
}

// Pure: money returned to the wallet by goals deleted in [from, to].
function releasedInWindow(goals, from, to = null) {
    let total = 0;
    const fromMs = from ? from.getTime() : -Infinity;
    const toMs = to ? to.getTime() : Infinity;
    for (const g of goals || []) {
        if (!g.deletedAt) continue;
        const t = new Date(g.deletedAt).getTime();
        if (t >= fromMs && t <= toMs) total += g.releasedAmount || 0;
    }
    return total;
}

// Pure: NET standalone-savings movement in [from, to] = deposits − withdrawals.
// `to` omitted ⇒ open-ended (used for "before" / all-time).
function savingsNet(entries, from, to = null) {
    let total = 0;
    const fromMs = from ? from.getTime() : -Infinity;
    const toMs = to ? to.getTime() : Infinity;
    for (const e of entries || []) {
        const t = new Date(e.date).getTime();
        if (t < fromMs || t > toMs) continue;
        total += e.direction === 'withdraw' ? -e.amount : e.amount;
    }
    return total;
}

// Cumulative (income − expenses − goalSaved + released − savingsNet) strictly before `before`.
async function carriedForwardBefore(userId, before, goals, savingsEntries = []) {
    const end = new Date(before.getTime() - 1); // strictly before `before`
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, EPOCH, end),
        expenseTotalForPeriod(userId, EPOCH, end),
    ]);
    const saved = savedInWindow(goals, EPOCH, end);
    const released = releasedInWindow(goals, EPOCH, end);
    return income - expenses - saved + released - savingsNet(savingsEntries, EPOCH, end);
}

// One period's breakdown: opening + income − expenses − goalSaved + released − savingsOut.
async function periodBreakdown(userId, period, goals, savingsEntries, now) {
    const { from, to } = periodWindow(period, now);
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, from, to),
        expenseTotalForPeriod(userId, from, to),
    ]);
    const saved = savedInWindow(goals, from, to);
    const released = releasedInWindow(goals, from, to);
    const savingsOut = savingsNet(savingsEntries, from, to);
    const carriedForward = await carriedForwardBefore(userId, from, goals, savingsEntries);
    return {
        period, from, to, carriedForward, income, expenses, saved, released, savingsOut,
        ...summarize({ carriedForward, income, expenses, saved, savingsOut, released }),
    };
}

// Full picture for /analytics/balance. `available` (a.k.a. the Wallet) is the
// single spendable pocket, period-independent, used as the hard cap for goal
// contributions and savings deposits. `savingsBalance` is the standalone
// Savings account (all-time net deposits).
async function getBalance(userId, goals, savingsEntries = [], now = new Date()) {
    const ref = now instanceof Date ? now : new Date(now);
    const [monthly, yearly] = await Promise.all([
        periodBreakdown(userId, 'monthly', goals, savingsEntries, ref),
        periodBreakdown(userId, 'yearly', goals, savingsEntries, ref),
    ]);
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, EPOCH, ref),
        expenseTotalForPeriod(userId, EPOCH, ref),
    ]);
    const saved = savedInWindow(goals, EPOCH, ref);
    const released = releasedInWindow(goals, EPOCH, ref);
    const savingsBalance = savingsNet(savingsEntries, EPOCH, ref);
    const available = income - expenses - saved + released - savingsBalance;
    return { available, wallet: available, savingsBalance, cumulative: { income, expenses, saved, released }, monthly, yearly };
}

module.exports = {
    summarize, periodWindow, savedInWindow, releasedInWindow, releasableAmount, savingsNet,
    carriedForwardBefore, periodBreakdown, getBalance,
};
