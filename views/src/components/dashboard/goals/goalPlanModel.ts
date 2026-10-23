// Shapes + pure helpers for the goal-planning UI (GOAL-1): GET /goals/plan,
// GET /goals/allocation-suggestion, POST /goals/allocate. No React and no
// imports, so everything here is unit-tested with node:test
// (see __tests__/goalPlanModel.test.ts). Missing data is shown as words
// ("Flexible", "No history yet"), never as NaN.

export interface CashFlow {
    income: number;
    expenses: number;
    surplus: number;
    monthlyAvgIncome: number;
    monthlyAvgExpenses: number;
    monthlySurplus: number;
}

export interface GoalPlanRow {
    goalId: string;
    requiredMonthly: number | null;
    actualMonthlyRate: number | null;
    forecastMonths: number | null;
    forecastDelta: number | null;
    status: string;              // 'On track' | 'At risk' | 'Not feasible at current rate'
    title: string;
    goalType: string;
    priority: number;
    targetAmount: number;
    currentAmount: number;
    targetDate: string | null;
}

export interface PlanData {
    cashFlow: CashFlow;
    goals: GoalPlanRow[];
    portfolio: { totalRequired: number; availableSurplus: number; overcommitted: boolean };
}

export interface AllocationGoal {
    goalId: string;
    title: string;
    goalType: string;
    targetAmount: number;
    currentAmount: number;
    targetDate: string | null;
    priority: number;
    suggested: number;
}

export interface Tradeoff {
    goalId: string;
    shortfall: number;
    extendMonths: number | null;
}

export interface AllocationData {
    cashFlow: CashFlow;
    emergencyBaseline: number;
    freeSurplus: number;
    overcommitted: boolean;
    tradeoffs: Tradeoff[];
    goals: AllocationGoal[];
}

// ── Status ───────────────────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "bad" | "neutral";

export function statusTone(status: string | null | undefined): Tone {
    if (status === "On track") return "good";
    if (status === "At risk") return "warn";
    if (status && status.startsWith("Not feasible")) return "bad";
    return "neutral";
}

// Short badge text ("Not feasible at current rate" → "Not feasible").
export function statusLabel(status: string | null | undefined): string {
    if (!status) return "No plan";
    return status.startsWith("Not feasible") ? "Not feasible" : status;
}

// ── Numbers → words ──────────────────────────────────────────────────────────

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

// 0.4 → "<1 mo", 7.6 → "8 mo", 30 → "2.5 yr"
export function formatMonths(months: number): string {
    if (!isNum(months) || months < 0) return "—";
    if (months < 1) return "<1 mo";
    if (months >= 24) return `${(months / 12).toFixed(1)} yr`;
    return `${Math.round(months)} mo`;
}

export interface ForecastText { text: string; tone: Tone }

// forecastMonths = months to finish at the recent contribution rate;
// forecastDelta  = forecastMonths − months until the deadline (+ = late).
export function describeForecast(row: Pick<GoalPlanRow, "forecastMonths" | "forecastDelta" | "currentAmount" | "targetAmount">): ForecastText {
    if (row.targetAmount > 0 && row.currentAmount >= row.targetAmount) return { text: "Fully funded", tone: "good" };
    if (!isNum(row.forecastMonths)) return { text: "No forecast yet — no recent contributions", tone: "neutral" };
    const finish = `Done in ~${formatMonths(row.forecastMonths)}`;
    if (!isNum(row.forecastDelta)) return { text: finish, tone: "neutral" };
    if (row.forecastDelta > 0.5) {
        return { text: `${finish} · ~${formatMonths(row.forecastDelta)} late`, tone: row.forecastDelta > 3 ? "bad" : "warn" };
    }
    if (row.forecastDelta < -0.5) {
        return { text: `${finish} · ~${formatMonths(-row.forecastDelta)} early`, tone: "good" };
    }
    return { text: `${finish} · on schedule`, tone: "good" };
}

// ── Allocation form ──────────────────────────────────────────────────────────

const round2 = (x: number) => Math.round(x * 100) / 100;

// Text input → positive amount, or null when blank/invalid/≤0.
export function parseAllocationInput(raw: string | undefined): number | null {
    if (raw === undefined) return null;
    const trimmed = raw.trim().replace(/,/g, "");
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) return null;
    return round2(n);
}

// Initial editable amounts from the server's suggestion (blank when 0).
export function suggestionToInputs(goals: Pick<AllocationGoal, "goalId" | "suggested">[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const g of goals) out[g.goalId] = g.suggested > 0 ? String(round2(g.suggested)) : "";
    return out;
}

// The POST /goals/allocate body rows — only goals with an amount > 0, in the
// order the goals are listed.
export function buildAllocations(goals: Pick<AllocationGoal, "goalId">[], inputs: Record<string, string>): { goalId: string; amount: number }[] {
    const rows: { goalId: string; amount: number }[] = [];
    for (const g of goals) {
        const amount = parseAllocationInput(inputs[g.goalId]);
        if (amount !== null) rows.push({ goalId: g.goalId, amount });
    }
    return rows;
}

export function allocationTotal(rows: { amount: number }[]): number {
    return round2(rows.reduce((s, r) => s + r.amount, 0));
}

// ── Priority (Goal.priority is an int; higher = funded sooner on ties) ───────

export const PRIORITY_OPTIONS = [
    { value: 0, label: "Normal" },
    { value: 1, label: "High" },
    { value: 2, label: "Top" },
] as const;

// Snap any stored priority (0–1000) onto the three UI levels.
export function priorityLevel(p: number | null | undefined): 0 | 1 | 2 {
    if (!isNum(p) || p <= 0) return 0;
    return p >= 2 ? 2 : 1;
}
