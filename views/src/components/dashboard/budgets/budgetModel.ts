// Shape + pure helpers for the Budgets screen. No React / no imports, so the
// helpers are unit-tested with node:test (see __tests__/budgetModel.test.ts).

// One row from GET /budgets/tracking/:year/:month (spent is computed on read
// from the user's expenses in that Category for that month).
export interface BudgetRow {
    _id: string;
    category: string;          // Category ObjectId
    categoryName: string;
    categoryColor: string;     // #rrggbb
    categoryIcon: string;      // backend icon enum
    categoryArchived: boolean;
    limit: number;
    spent: number;
    remaining: number;
    usagePercentage: number;
    isOverLimit: boolean;
    isNearLimit: boolean;
    alertThreshold: number;
    month: number;             // 1-12
    year: number;
    isActive: boolean;
}

export type UsageTone = "ok" | "half" | "near" | "over";

// Over the limit → "over"; at/above the budget's own alert threshold → "near";
// past half → "half"; otherwise "ok".
export function usageTone(b: Pick<BudgetRow, "usagePercentage" | "isOverLimit" | "isNearLimit">): UsageTone {
    if (b.isOverLimit || b.usagePercentage > 100) return "over";
    if (b.isNearLimit) return "near";
    if (b.usagePercentage >= 50) return "half";
    return "ok";
}

export interface BudgetSummary {
    totalLimit: number;
    totalSpent: number;
    usedPct: number;          // whole percent of the combined limit
    overCount: number;
    nearCount: number;
    health: "Healthy" | "Watch" | "Critical" | "No budgets";
}

export function summarizeBudgets(rows: BudgetRow[]): BudgetSummary {
    const totalLimit = rows.reduce((s, b) => s + (b.limit || 0), 0);
    const totalSpent = rows.reduce((s, b) => s + (b.spent || 0), 0);
    const overCount = rows.filter((b) => b.isOverLimit).length;
    const nearCount = rows.filter((b) => !b.isOverLimit && b.isNearLimit).length;
    const usedPct = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;
    const health = rows.length === 0 ? "No budgets"
        : overCount > 0 ? "Critical"
        : nearCount > 0 ? "Watch"
        : "Healthy";
    return { totalLimit, totalSpent, usedPct, overCount, nearCount, health };
}

// The calendar month before (year, month) — month is 1-12.
export function previousMonth(year: number, month: number): { year: number; month: number } {
    return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}
