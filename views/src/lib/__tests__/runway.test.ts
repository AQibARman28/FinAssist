import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRunway, runwayScale, paceStatus, walletTrace } from "../runway.ts";
import type { IncomePeriod } from "../dashboard.ts";

// Local noon on 5 Nov 2026 is "today" in every test, whatever the machine's zone.
const TODAY = new Date(2026, 10, 5, 12);
// 1 Nov to the next allowance on 1 Dec: 30 days, today is day 5.
const PERIOD: IncomePeriod = { start: new Date(2026, 10, 1), end: new Date(2026, 11, 1), kind: "income", day: 5, length: 30 };

describe("buildRunway", () => {
    it("has one day per day of the period, numbered from 1, split into past, today and ahead", () => {
        const days = buildRunway(PERIOD, [], [], TODAY);
        assert.equal(days.length, 30);
        assert.deepEqual(days.slice(0, 6).map((d) => [d.index, d.kind]), [
            [1, "past"], [2, "past"], [3, "past"], [4, "past"], [5, "today"], [6, "ahead"],
        ]);
        assert.equal(days[29].date.getDate(), 30);
    });

    it("puts a date-only expense (stored at UTC midnight) on its own calendar day", () => {
        const days = buildRunway(PERIOD, [{ amount: 4500, date: "2026-11-01T00:00:00.000Z" }], [], TODAY);
        assert.equal(days[0].spent, 4500);
        assert.equal(days.reduce((s, d) => s + d.spent, 0), 4500);
    });

    it("puts an expense with a real time on the local day it was spent, not the UTC one", () => {
        // 1:30 am on 2 Nov here is still 1 Nov in UTC for anyone east of Greenwich.
        const lateNight = new Date(2026, 10, 2, 1, 30).toISOString();
        const days = buildRunway(PERIOD, [{ amount: 80, date: lateNight }], [], TODAY);
        assert.equal(days[1].spent, 80);
        assert.equal(days[0].spent, 0);
    });

    it("adds up several expenses on one day and keeps them for the readout", () => {
        const days = buildRunway(PERIOD, [
            { amount: 150, date: "2026-11-04T00:00:00.000Z", description: "Canteen lunch" },
            { amount: 80, date: "2026-11-04T00:00:00.000Z", description: "Rickshaw" },
        ], [], TODAY);
        assert.equal(days[3].spent, 230);
        assert.deepEqual(days[3].entries.map((e) => e.description), ["Canteen lunch", "Rickshaw"]);
    });

    it("ignores expenses outside the period", () => {
        const days = buildRunway(PERIOD, [
            { amount: 300, date: "2026-10-31T00:00:00.000Z" },
            { amount: 200, date: "2026-12-01T00:00:00.000Z" },
        ], [], TODAY);
        assert.equal(days.reduce((s, d) => s + d.spent, 0), 0);
    });

    it("marks the days income came in", () => {
        const days = buildRunway(PERIOD, [], [
            { amount: 10000, date: "2026-11-01T00:00:00.000Z" },
            { amount: 6000, date: "2026-11-03T00:00:00.000Z" },
        ], TODAY);
        assert.deepEqual(days.filter((d) => d.incomes.length).map((d) => d.index), [1, 3]);
    });
});

describe("runwayScale", () => {
    it("caps the scale near twice the daily amount so one rent day doesn't flatten the month", () => {
        const s = runwayScale(542, 4980);
        assert.equal(s.max, 1200);
        assert.equal(s.capped, true);
    });

    it("fits the scale to the spending when nothing comes close to the cap", () => {
        const s = runwayScale(542, 300);
        assert.equal(s.max, 800);
        assert.equal(s.capped, false);
    });

    it("still has a scale with no allowance and no spending", () => {
        assert.equal(runwayScale(0, 0).max, 100);
        assert.equal(runwayScale(0, 950).max, 1000);
    });
});

describe("walletTrace", () => {
    // Rafi's November: allowance and rent on the 1st, tuition on the 3rd, ৳1,500 moved to savings today.
    const days = buildRunway(PERIOD, [
        { amount: 4980, date: "2026-11-01T00:00:00.000Z" },
        { amount: 280, date: "2026-11-02T00:00:00.000Z" },
        { amount: 350, date: "2026-11-03T00:00:00.000Z" },
        { amount: 230, date: "2026-11-04T00:00:00.000Z" },
    ], [
        { amount: 10000, date: "2026-11-01T00:00:00.000Z" },
        { amount: 6000, date: "2026-11-03T00:00:00.000Z" },
    ], TODAY);

    it("works the wallet back from today to each day's closing balance", () => {
        const trace = walletTrace(days, [{ amount: 1500, direction: "deposit", date: new Date(2026, 10, 5, 9, 41).toISOString() }], 14110);
        assert.deepEqual(trace, [10470, 10190, 15840, 15610, 14110]);
    });

    it("adds money taken back out of savings to the wallet on that day", () => {
        // Today 14,110; the 4th spent 230; the 3rd took 6,000 in and spent 350; the 2nd spent 280 and took 500 back from savings.
        const trace = walletTrace(days, [{ amount: 500, direction: "withdraw", date: "2026-11-02T00:00:00.000Z" }], 14110);
        assert.deepEqual(trace, [8470, 8690, 14340, 14110, 14110]);
    });

    it("stops at today: no balances are made up for the days ahead", () => {
        assert.equal(walletTrace(days, [], 14110).length, 5);
    });
});

describe("paceStatus", () => {
    it("is on pace while spending is at or below an even share of the month", () => {
        assert.equal(paceStatus(550, 4000, 5 / 30), "on");
    });

    it("is ahead of pace when more than that share is gone", () => {
        assert.equal(paceStatus(350, 1500, 5 / 30), "ahead");
    });

    it("is over once the limit is passed, whatever the day", () => {
        assert.equal(paceStatus(1600, 1500, 29 / 30), "over");
    });
});
