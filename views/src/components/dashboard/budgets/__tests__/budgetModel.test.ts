import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { usageTone, summarizeBudgets, previousMonth, nextMonth, monthPace, budgetState, type BudgetRow } from "../budgetModel.ts";

function row(over: Partial<BudgetRow>): BudgetRow {
    return {
        _id: "b", category: "c", categoryName: "Food", categoryColor: "#F97316", categoryIcon: "utensils",
        categoryArchived: false, limit: 100, spent: 0, remaining: 100, usagePercentage: 0,
        isOverLimit: false, isNearLimit: false, alertThreshold: 80, month: 10, year: 2026, isActive: true,
        ...over,
    };
}

describe("usageTone", () => {
    it("ok / half / near / over", () => {
        assert.equal(usageTone(row({ usagePercentage: 10 })), "ok");
        assert.equal(usageTone(row({ usagePercentage: 55 })), "half");
        assert.equal(usageTone(row({ usagePercentage: 85, isNearLimit: true })), "near");
        assert.equal(usageTone(row({ usagePercentage: 120, isOverLimit: true })), "over");
    });
});

describe("summarizeBudgets", () => {
    it("empty → zeroes and 'No budgets'", () => {
        const s = summarizeBudgets([]);
        assert.equal(s.totalLimit, 0);
        assert.equal(s.usedPct, 0);
        assert.equal(s.health, "No budgets");
    });
    it("totals spent from real rows and flags over/near counts", () => {
        const s = summarizeBudgets([
            row({ limit: 100, spent: 150, isOverLimit: true, isNearLimit: true }),
            row({ limit: 300, spent: 250, isNearLimit: true }),
            row({ limit: 100, spent: 0 }),
        ]);
        assert.equal(s.totalLimit, 500);
        assert.equal(s.totalSpent, 400);
        assert.equal(s.usedPct, 80);
        assert.equal(s.overCount, 1);
        assert.equal(s.nearCount, 1);
        assert.equal(s.health, "Critical");
    });
    it("near-only → Watch, all under → Healthy", () => {
        assert.equal(summarizeBudgets([row({ isNearLimit: true, spent: 90 })]).health, "Watch");
        assert.equal(summarizeBudgets([row({ spent: 10 })]).health, "Healthy");
    });
});

describe("month stepping", () => {
    it("wraps across the year boundary", () => {
        assert.deepEqual(previousMonth(2026, 1), { year: 2025, month: 12 });
        assert.deepEqual(previousMonth(2026, 10), { year: 2026, month: 9 });
        assert.deepEqual(nextMonth(2026, 12), { year: 2027, month: 1 });
    });
});

describe("monthPace", () => {
    const now = new Date(2026, 10, 6, 12); // 6 Nov 2026, local noon
    it("is the share of the viewed month gone by, for the current month", () => {
        assert.equal(monthPace(2026, 11, now), 6 / 30);
    });
    it("is the whole month for a month already over", () => {
        assert.equal(monthPace(2026, 10, now), 1);
        assert.equal(monthPace(2025, 12, now), 1);
    });
    it("is nothing yet for a month still to come", () => {
        assert.equal(monthPace(2026, 12, now), 0);
    });
});

describe("budgetState", () => {
    const row = (spent: number, extra: Partial<{ isOverLimit: boolean; isNearLimit: boolean }> = {}) =>
        ({ limit: 1000, spent, isOverLimit: spent > 1000, isNearLimit: false, ...extra });
    it("says over once spending passes the limit", () => {
        assert.equal(budgetState(row(1200), 0.5), "over");
    });
    it("says the alert threshold has passed before pace", () => {
        assert.equal(budgetState(row(850, { isNearLimit: true }), 0.9), "alert");
    });
    it("says ahead of pace when spending runs ahead of the month", () => {
        assert.equal(budgetState(row(600), 0.4), "ahead");
    });
    it("says on pace otherwise", () => {
        assert.equal(budgetState(row(300), 0.4), "on");
    });
});
