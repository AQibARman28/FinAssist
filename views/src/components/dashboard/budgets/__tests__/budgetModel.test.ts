import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { usageTone, summarizeBudgets, previousMonth, nextMonth, type BudgetRow } from "../budgetModel.ts";

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
