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
 * DB reads use the canonical finance helpers; the arithmetic is pure so it
 * unit-tests without a database (tests/balance.test.js).
 */

const { incomeTotalForPeriod, expenseTotalForPeriod } = require('../utils/finance');

const EPOCH = new Date(0); // floor for "all time before X" cumulative windows

// Pure: derive the two figures the UI shows for a period.
function summarize({ carriedForward, income, expenses, saved }) {
    const cf = carriedForward || 0;
    const netIncome = income - expenses;
    return { netIncome, closing: cf + income - expenses - saved };
}

// Pure: the [from, now] window for a period.
function periodWindow(period, now = new Date()) {
    const ref = now instanceof Date ? now : new Date(now);
    const from = period === 'yearly'
        ? new Date(ref.getFullYear(), 0, 1)
        : new Date(ref.getFullYear(), ref.getMonth(), 1);
    return { from, to: ref };
}

// Pure: sum of EVERY goal contribution dated in [from, to] (no period split —
// savings is one continuous flow). `to` omitted ⇒ open-ended (used for "before").
function savedInWindow(goals, from, to = null) {
    let total = 0;
    const fromMs = from ? from.getTime() : -Infinity;
    const toMs = to ? to.getTime() : Infinity;
    for (const g of goals || []) {
        for (const c of g.contributions || []) {
            const t = new Date(c.date).getTime();
            if (t >= fromMs && t <= toMs) total += c.amount;
        }
    }
    return total;
}

// Cumulative (income − expenses − saved) for all time strictly before `before`.
async function carriedForwardBefore(userId, before, goals) {
    const end = new Date(before.getTime() - 1); // strictly before `before`
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, EPOCH, end),
        expenseTotalForPeriod(userId, EPOCH, end),
    ]);
    const saved = savedInWindow(goals, EPOCH, end);
    return income - expenses - saved;
}

// One period's breakdown: opening (carried forward) + income − expenses − saved.
async function periodBreakdown(userId, period, goals, now) {
    const { from, to } = periodWindow(period, now);
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, from, to),
        expenseTotalForPeriod(userId, from, to),
    ]);
    const saved = savedInWindow(goals, from, to);
    const carriedForward = await carriedForwardBefore(userId, from, goals);
    return { period, from, to, carriedForward, income, expenses, saved, ...summarize({ carriedForward, income, expenses, saved }) };
}

// Full picture for /analytics/balance. `available` is the single spendable
// pocket (period-independent) used for the savings hard cap.
async function getBalance(userId, goals, now = new Date()) {
    const ref = now instanceof Date ? now : new Date(now);
    const [monthly, yearly] = await Promise.all([
        periodBreakdown(userId, 'monthly', goals, ref),
        periodBreakdown(userId, 'yearly', goals, ref),
    ]);
    const [income, expenses] = await Promise.all([
        incomeTotalForPeriod(userId, EPOCH, ref),
        expenseTotalForPeriod(userId, EPOCH, ref),
    ]);
    const saved = savedInWindow(goals, EPOCH, ref);
    const available = income - expenses - saved;
    return { available, cumulative: { income, expenses, saved }, monthly, yearly };
}

module.exports = { summarize, periodWindow, savedInWindow, carriedForwardBefore, periodBreakdown, getBalance };
