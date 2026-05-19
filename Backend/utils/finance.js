/**
 * finance.js — shared aggregations the analytics + AI endpoints use to
 * source real numbers from Income and Expense.
 *
 * Three helpers:
 *
 *   expenseTotalForPeriod(userId, fromDate, toDate)
 *     Sum of Expense.amount for the user in [fromDate, toDate].
 *
 *   incomeTotalForPeriod(userId, fromDate, toDate)
 *     Sum of Income.amount in the window — counts one-off entries AND
 *     materialized recurring instances (both have isRecurring=false), then
 *     adds projected occurrences from recurring templates whose dates fall
 *     in the window without a corresponding materialized instance.
 *     Idempotent regardless of materialization state: a recurring template
 *     contributes exactly once per occurrence date in window, whether the
 *     instance has been materialized yet or not.
 *
 *   monthlyEquivalentIncome(userId)
 *     For the financial-health-score endpoint. Annualizes each recurring
 *     template (amount × annual-multiplier) and divides by 12, giving the
 *     user's stable monthly income capacity. One-off Income entries are
 *     intentionally NOT included — the score reflects the user's recurring
 *     baseline rather than spiky one-off receipts.
 *
 * Annual multipliers
 * ──────────────────
 *   weekly   52   (slight 52.14 simplification — fine for finance UI)
 *   biweekly 26   (slight 26.07 simplification)
 *   monthly  12
 *   yearly    1
 */

const Expense = require('../models/Expense');
const Income = require('../models/Income');
const { computeRecurringDates } = require('./recurring');

const FREQ_MULTIPLIER = Object.freeze({
    weekly:   52,
    biweekly: 26,
    monthly:  12,
    yearly:    1,
});

async function expenseTotalForPeriod(userId, fromDate, toDate) {
    const r = await Expense.aggregate([
        { $match: { user: userId, date: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return r.length ? r[0].total : 0;
}

async function incomeTotalForPeriod(userId, fromDate, toDate) {
    // (1) Non-template incomes inside the window. Picks up both one-off
    //     entries (parentRecurringId === null) and materialized instances
    //     of recurring templates (parentRecurringId !== null). Both have
    //     isRecurring === false by design (only templates carry the flag).
    const oneOff = await Income.aggregate([
        { $match: { user: userId, isRecurring: false, date: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    let total = oneOff.length ? oneOff[0].total : 0;

    // (2) Recurring templates: project schedule dates into the window. For
    //     each date, count the template's amount UNLESS an instance has
    //     already been materialized at that exact date (which step 1
    //     already counted). This makes the function independent of
    //     materialization state — heavy users who hit /incomes a lot have
    //     instances; light users don't; either way we sum correctly.
    const templates = await Income.find({
        user: userId, isRecurring: true, parentRecurringId: null,
    });

    for (const tpl of templates) {
        if (!tpl.recurringFrequency) continue;
        const occurrenceDates = computeRecurringDates(
            tpl.date, tpl.recurringFrequency, fromDate, toDate,
        );

        for (const d of occurrenceDates) {
            // The template row itself holds the anchor occurrence — count
            // the template's amount once if its anchor is in window.
            if (d.getTime() === tpl.date.getTime()) {
                total += tpl.amount;
                continue;
            }
            // Otherwise check for a materialized instance at this date.
            const exists = await Income.exists({
                user:              userId,
                parentRecurringId: tpl._id,
                date:              d,
            });
            if (!exists) total += tpl.amount;
        }
    }

    return total;
}

async function monthlyEquivalentIncome(userId) {
    const templates = await Income.find({
        user: userId, isRecurring: true, parentRecurringId: null,
    });
    let annual = 0;
    for (const tpl of templates) {
        const m = FREQ_MULTIPLIER[tpl.recurringFrequency];
        if (m) annual += tpl.amount * m;
    }
    return annual / 12;
}

module.exports = {
    FREQ_MULTIPLIER,
    expenseTotalForPeriod,
    incomeTotalForPeriod,
    monthlyEquivalentIncome,
};
