// The dashboard's sums, kept apart from the page so they can be tested.
import { addDays, differenceInCalendarDays, format, lastDayOfMonth, startOfDay } from "date-fns";
import { calendarDay } from "./dates";
import type { MoneyFormatter } from "./money";

export interface IncomeTemplate {
    date: string;
    frequency: string;
}

// The same day of the month in (year, month), or the month's last day when it
// is shorter: an allowance set on the 31st arrives on 30 November.
function dayInMonth(year: number, month: number, dayOfMonth: number): Date {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(dayOfMonth, last));
}

// The first time this template pays out after today. An income dated today
// has already been counted (recurring income is recorded as its day comes).
function occurrenceAfter(anchor: Date, frequency: string, today: Date): Date | null {
    if (anchor > today) return anchor;
    switch (frequency) {
        case "weekly":
        case "biweekly": {
            const step = frequency === "weekly" ? 7 : 14;
            const steps = Math.floor(differenceInCalendarDays(today, anchor) / step) + 1;
            return addDays(anchor, steps * step);
        }
        case "monthly": {
            for (let i = 0; i < 2; i++) {
                const candidate = dayInMonth(today.getFullYear(), today.getMonth() + i, anchor.getDate());
                if (candidate > today) return candidate;
            }
            return null;
        }
        case "yearly": {
            for (let i = 0; i < 2; i++) {
                const candidate = dayInMonth(today.getFullYear() + i, anchor.getMonth(), anchor.getDate());
                if (candidate > today) return candidate;
            }
            return null;
        }
        default:
            return null;
    }
}

// The last time this template paid out, today included, or null when its
// first payment is still ahead.
function occurrenceOnOrBefore(anchor: Date, frequency: string, today: Date): Date | null {
    if (anchor > today) return null;
    switch (frequency) {
        case "weekly":
        case "biweekly": {
            const step = frequency === "weekly" ? 7 : 14;
            return addDays(anchor, Math.floor(differenceInCalendarDays(today, anchor) / step) * step);
        }
        case "monthly": {
            const here = dayInMonth(today.getFullYear(), today.getMonth(), anchor.getDate());
            return here <= today ? here : dayInMonth(today.getFullYear(), today.getMonth() - 1, anchor.getDate());
        }
        case "yearly": {
            const here = dayInMonth(today.getFullYear(), anchor.getMonth(), anchor.getDate());
            return here <= today ? here : dayInMonth(today.getFullYear() - 1, anchor.getMonth(), anchor.getDate());
        }
        default:
            return null;
    }
}

export interface IncomePeriod {
    start: Date;
    // The next income's date (exclusive), or the first of next month.
    end: Date;
    kind: "income" | "monthEnd";
    // Today's place in the period: day 5 of 30.
    day: number;
    length: number;
}

// The stretch the money has to last: from the last income to the next one
// (the soonest-paying template), or the calendar month without one.
export function incomePeriod(templates: IncomeTemplate[], now: Date = new Date()): IncomePeriod {
    const today = startOfDay(now);
    let best: { start: Date; end: Date } | null = null;
    for (const t of templates) {
        const anchor = calendarDay(t.date);
        const end = occurrenceAfter(anchor, t.frequency, today);
        if (!end || (best && end >= best.end)) continue;
        best = { start: occurrenceOnOrBefore(anchor, t.frequency, today) ?? today, end };
    }
    const { start, end, kind } = best
        ? { ...best, kind: "income" as const }
        : { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 1), kind: "monthEnd" as const };
    return { start, end, kind, day: differenceInCalendarDays(today, start) + 1, length: differenceInCalendarDays(end, start) };
}

// When the next recurring income arrives, or null when there is none.
export function nextIncomeDate(templates: IncomeTemplate[], now: Date = new Date()): Date | null {
    const today = startOfDay(now);
    let soonest: Date | null = null;
    for (const t of templates) {
        const next = occurrenceAfter(calendarDay(t.date), t.frequency, today);
        if (next && (!soonest || next < soonest)) soonest = next;
    }
    return soonest;
}

export interface SafeToSpend {
    // Whole currency units a day, rounded down (the safe direction).
    perDay: number;
    // Days it has to last, today included.
    days: number;
    // The next income's date, or the month's last day.
    until: Date;
    untilKind: "income" | "monthEnd";
    // How far below zero the wallet is (0 when it isn't).
    over: number;
}

// `wallet` is the balance now; `spentToday` is already taken off it. Today's
// amount is set from the wallet as the day began, so it holds still while the
// day's expenses are measured against it.
export function safeToSpend(wallet: number, now: Date, nextIncome: Date | null, spentToday = 0): SafeToSpend {
    const today = startOfDay(now);
    const until = nextIncome ? startOfDay(nextIncome) : lastDayOfMonth(today);
    const days = Math.max(1, nextIncome
        ? differenceInCalendarDays(until, today)          // spend up to the day before it arrives
        : differenceInCalendarDays(until, today) + 1);    // spend through the last day
    const dayStart = wallet + spentToday;
    return {
        perDay: dayStart > 0 ? Math.floor(dayStart / days) : 0,
        days,
        until,
        untilKind: nextIncome ? "income" : "monthEnd",
        over: wallet < 0 ? -wallet : 0,
    };
}

export interface GoalPlanRow {
    title: string;
    status: string;
    targetAmount: number;
    currentAmount: number;
    requiredMonthly: number | null;
    targetDate?: string | null;
}

export type GoalTone = "good" | "warn" | "bad" | "done" | "neutral";

// Within this many days a monthly figure stops making sense ("needs ৳5,898 a
// month" for a ৳5,000 goal due in three weeks), so the goal is put per day.
const PER_DAY_WITHIN_DAYS = 60;
// The plan's monthly figures are estimates that drift a few taka between
// loads; rounding to the nearest ৳10 (needs up, savings down) keeps them still.
const up10 = (v: number) => Math.ceil(v / 10) * 10;
const down10 = (v: number) => Math.floor(v / 10) * 10;

// A goal's standing in plain words, from the savings plan (GET /goals/plan).
export function goalStatus(
    goal: GoalPlanRow, monthlySurplus: number, fmt: MoneyFormatter, now: Date = new Date(),
): { tone: GoalTone; text: string } {
    const money = (v: number) => fmt.format(v);
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    if (remaining <= 0) return { tone: "done", text: "Reached" };
    if (goal.requiredMonthly === null) {
        return { tone: "neutral", text: `${money(Math.round(goal.currentAmount))} of ${money(Math.round(goal.targetAmount))} saved` };
    }

    if (goal.targetDate) {
        const deadline = calendarDay(goal.targetDate);
        const daysLeft = differenceInCalendarDays(deadline, startOfDay(now)) + 1; // today counts
        if (daysLeft <= 0) return { tone: "warn", text: `Deadline passed · ${money(Math.round(remaining))} to go` };
        if (goal.status !== "On track" && daysLeft <= PER_DAY_WITHIN_DAYS) {
            // The verdict first, in words, then what it would take.
            const atRisk = goal.status === "At risk";
            return {
                tone: atRisk ? "warn" : "bad",
                text: `${atRisk ? "Behind" : "Out of reach at this rate"} · ${money(Math.round(remaining))} to go by ${format(deadline, "d MMM")} · about ${money(Math.ceil(remaining / daysLeft))} a day`,
            };
        }
    }

    switch (goal.status) {
        case "On track":
            return { tone: "good", text: "On track" };
        case "At risk":
            return { tone: "warn", text: `Behind: needs about ${money(up10(goal.requiredMonthly))} a month` };
        case "Not feasible at current rate":
            return {
                tone: "bad",
                text: monthlySurplus > 0
                    ? `Needs about ${money(up10(goal.requiredMonthly))} a month; you save about ${money(down10(monthlySurplus))}`
                    : `Needs about ${money(up10(goal.requiredMonthly))} a month; nothing is left over to save yet`,
            };
        default:
            return { tone: "neutral", text: goal.status };
    }
}

export interface SpendingRow {
    name: string;
    amount: number;
    color?: string;
}

// Categories by amount spent, largest first, each with its share of the total.
export function rankSpending(rows: SpendingRow[]): (SpendingRow & { share: number })[] {
    const spent = rows.filter((r) => r.amount > 0);
    const total = spent.reduce((s, r) => s + r.amount, 0);
    return spent
        .map((r) => ({ ...r, share: r.amount / total }))
        .sort((a, b) => b.amount - a.amount);
}
