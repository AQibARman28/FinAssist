import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextIncomeDate, incomePeriod, safeToSpend, goalStatus, rankSpending } from "../dashboard.ts";
import { moneyFormatter } from "../money.ts";

const day = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// Local noon on 5 Nov 2026 is "today" in every test, whatever the machine's zone.
const TODAY = new Date(2026, 10, 5, 12);

describe("nextIncomeDate", () => {
    it("finds next month's allowance for a monthly template anchored on the 1st", () => {
        const next = nextIncomeDate([{ date: "2026-10-01T00:00:00.000Z", frequency: "monthly" }], TODAY);
        assert.equal(day(next!), "2026-12-1");
    });

    it("lands a 31st-of-the-month template on the last day of a shorter month", () => {
        const next = nextIncomeDate([{ date: "2026-08-31T00:00:00.000Z", frequency: "monthly" }], TODAY);
        assert.equal(day(next!), "2026-11-30");
    });

    it("steps weekly and biweekly templates from their anchor", () => {
        assert.equal(day(nextIncomeDate([{ date: "2026-10-29T00:00:00.000Z", frequency: "weekly" }], TODAY)!), "2026-11-12");
        assert.equal(day(nextIncomeDate([{ date: "2026-10-22T00:00:00.000Z", frequency: "biweekly" }], TODAY)!), "2026-11-19");
    });

    it("treats an income dated today as already received", () => {
        const next = nextIncomeDate([{ date: "2026-11-05T00:00:00.000Z", frequency: "monthly" }], TODAY);
        assert.equal(day(next!), "2026-12-5");
    });

    it("picks the soonest of several templates", () => {
        const next = nextIncomeDate([
            { date: "2026-10-01T00:00:00.000Z", frequency: "monthly" },
            { date: "2026-10-29T00:00:00.000Z", frequency: "weekly" },
            { date: "2026-01-15T00:00:00.000Z", frequency: "yearly" },
        ], TODAY);
        assert.equal(day(next!), "2026-11-12");
    });

    it("is null without recurring income", () => {
        assert.equal(nextIncomeDate([], TODAY), null);
    });
});

describe("incomePeriod", () => {
    it("runs from the last allowance to the next one", () => {
        const p = incomePeriod([{ date: "2026-10-01T00:00:00.000Z", frequency: "monthly" }], TODAY);
        assert.equal(p.kind, "income");
        assert.equal(day(p.start), "2026-11-1");
        assert.equal(day(p.end), "2026-12-1");
        assert.equal(p.day, 5);
        assert.equal(p.length, 30);
    });

    it("starts today when today is a pay day", () => {
        const p = incomePeriod([{ date: "2026-10-29T00:00:00.000Z", frequency: "weekly" }], TODAY);
        assert.equal(day(p.start), "2026-11-5");
        assert.equal(day(p.end), "2026-11-12");
        assert.equal(p.day, 1);
        assert.equal(p.length, 7);
    });

    it("follows the income that comes soonest", () => {
        const p = incomePeriod([
            { date: "2026-10-01T00:00:00.000Z", frequency: "monthly" },
            { date: "2026-10-22T00:00:00.000Z", frequency: "biweekly" },
        ], TODAY);
        assert.equal(day(p.start), "2026-11-5");
        assert.equal(day(p.end), "2026-11-19");
    });

    it("falls back to the calendar month without recurring income", () => {
        const p = incomePeriod([], TODAY);
        assert.equal(p.kind, "monthEnd");
        assert.equal(day(p.start), "2026-11-1");
        assert.equal(day(p.end), "2026-12-1");
        assert.equal(p.day, 5);
        assert.equal(p.length, 30);
    });
});

describe("safeToSpend", () => {
    it("divides the wallet over the days before the next income, rounding down", () => {
        const s = safeToSpend(14110, TODAY, new Date(2026, 11, 1));
        assert.equal(s.days, 26); // 5 Nov … 30 Nov
        assert.equal(s.perDay, 542);
        assert.equal(s.untilKind, "income");
        assert.equal(day(s.until), "2026-12-1");
        assert.equal(s.over, 0);
    });

    it("counts to the end of the month without a next income", () => {
        const s = safeToSpend(2600, TODAY, null);
        assert.equal(s.days, 26);
        assert.equal(s.perDay, 100);
        assert.equal(s.untilKind, "monthEnd");
        assert.equal(day(s.until), "2026-11-30");
    });

    it("has nothing to spend, and says by how much, when the wallet is below zero", () => {
        const s = safeToSpend(-450, TODAY, new Date(2026, 11, 1));
        assert.equal(s.perDay, 0);
        assert.equal(s.over, 450);
    });

    it("counts today as one day when the income arrives tomorrow", () => {
        const s = safeToSpend(300, TODAY, new Date(2026, 10, 6));
        assert.equal(s.days, 1);
        assert.equal(s.perDay, 300);
    });

    // The wallet already has today's spending taken off. Today's amount is
    // fixed at the start of the day, so spending today doesn't shrink it.
    it("sets today's amount from the wallet as the day began", () => {
        // 18,000 for 30 days; 350 spent today leaves 17,650 in the wallet.
        const before = safeToSpend(18000, TODAY, new Date(2026, 11, 5));
        const after = safeToSpend(17650, TODAY, new Date(2026, 11, 5), 350);
        assert.equal(before.perDay, 600);
        assert.equal(after.perDay, 600);
    });

    it("still says how far below zero the wallet is after today's spending", () => {
        const s = safeToSpend(-100, TODAY, new Date(2026, 11, 1), 400);
        assert.equal(s.over, 100);
    });
});

describe("goalStatus", () => {
    const fmt = moneyFormatter("BDT");
    // A deadline months away, so the monthly phrasing applies.
    const base = { title: "New laptop", targetAmount: 60000, currentAmount: 0, requiredMonthly: 31892.03, targetDate: "2027-06-30T17:59:59.000Z" };

    it("reads On track as good news", () => {
        assert.deepEqual(goalStatus({ ...base, status: "On track", requiredMonthly: 2000 }, 5203, fmt, TODAY), { tone: "good", text: "On track" });
    });

    it("names the monthly amount for a goal at risk, rounded up to a steady figure", () => {
        assert.deepEqual(goalStatus({ ...base, status: "At risk", requiredMonthly: 3991.4 }, 5203, fmt, TODAY), { tone: "warn", text: "Behind: needs about ৳4,000 a month" });
    });

    it("compares an out-of-reach goal with what the student actually saves", () => {
        assert.deepEqual(goalStatus({ ...base, status: "Not feasible at current rate" }, 5203.33, fmt, TODAY), {
            tone: "bad", text: "Needs about ৳31,900 a month; you save about ৳5,200",
        });
    });

    it("keeps the figure steady as the server's estimate drifts by a few taka", () => {
        const a = goalStatus({ ...base, status: "Not feasible at current rate", requiredMonthly: 31895.2 }, 5203, fmt, TODAY);
        const b = goalStatus({ ...base, status: "Not feasible at current rate", requiredMonthly: 31896.8 }, 5203, fmt, TODAY);
        assert.equal(a.text, b.text);
    });

    it("does not claim a saving rate when there is no surplus", () => {
        assert.deepEqual(goalStatus({ ...base, status: "Not feasible at current rate" }, -300, fmt, TODAY), {
            tone: "bad", text: "Needs about ৳31,900 a month; nothing is left over to save yet",
        });
    });

    it("puts a close deadline per day instead of per month, and says plainly it is out of reach", () => {
        const goal = { title: "Emergency Fund", targetAmount: 5000, currentAmount: 0, requiredMonthly: 5898, targetDate: "2026-11-30T17:59:59.000Z" };
        assert.deepEqual(goalStatus({ ...goal, status: "Not feasible at current rate" }, 5203, fmt, TODAY), {
            tone: "bad", text: "Out of reach at this rate · ৳5,000 to go by 30 Nov · about ৳193 a day",
        });
    });

    it("says a close goal at risk is behind, before what it needs a day", () => {
        const goal = { title: "Emergency Fund", targetAmount: 5000, currentAmount: 2000, requiredMonthly: 3500, targetDate: "2026-11-30T17:59:59.000Z" };
        assert.deepEqual(goalStatus({ ...goal, status: "At risk" }, 5203, fmt, TODAY), {
            tone: "warn", text: "Behind · ৳3,000 to go by 30 Nov · about ৳116 a day",
        });
    });

    it("says when a deadline has passed", () => {
        const goal = { title: "Trip", targetAmount: 5000, currentAmount: 1000, requiredMonthly: 4000, targetDate: "2026-10-31T17:59:59.000Z" };
        assert.deepEqual(goalStatus({ ...goal, status: "Not feasible at current rate" }, 5203, fmt, TODAY), {
            tone: "warn", text: "Deadline passed · ৳4,000 to go",
        });
    });

    it("celebrates a reached goal whatever the status says", () => {
        assert.deepEqual(goalStatus({ ...base, status: "On track", currentAmount: 60000 }, 5203, fmt, TODAY), { tone: "done", text: "Reached" });
    });

    it("shows progress for a goal without a deadline", () => {
        assert.deepEqual(goalStatus({ ...base, status: "On track", requiredMonthly: null, targetDate: undefined, currentAmount: 1500 }, 5203, fmt, TODAY), {
            tone: "neutral", text: "৳1,500 of ৳60,000 saved",
        });
    });
});

describe("rankSpending", () => {
    it("sorts categories by amount and gives each its share", () => {
        const ranked = rankSpending([
            { name: "Food", amount: 550 }, { name: "Bills", amount: 4800 }, { name: "Shopping", amount: 350 }, { name: "Transport", amount: 140 },
        ]);
        assert.deepEqual(ranked.map((r) => r.name), ["Bills", "Food", "Shopping", "Transport"]);
        assert.equal(Math.round(ranked[0].share * 100), 82);
    });

    it("drops empty categories and survives no spending", () => {
        assert.deepEqual(rankSpending([{ name: "Food", amount: 0 }]), []);
        assert.deepEqual(rankSpending([]), []);
    });
});
