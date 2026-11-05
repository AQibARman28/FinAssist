// The runway: every day from the last income to the next, as the dashboard's
// day-by-day chart draws it. Kept apart from the chart so it can be tested.
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { calendarDay } from "./dates";
import type { IncomePeriod } from "./dashboard";

export interface RunwayEntry {
    amount: number;
    date: string;
    description?: string;
    category?: string;
}

export interface RunwayIncome {
    amount: number;
    date: string;
    description?: string;
}

export interface RunwayDay {
    date: Date;
    // 1-based place in the period: day 5 of 30.
    index: number;
    kind: "past" | "today" | "ahead";
    spent: number;
    entries: RunwayEntry[];
    incomes: RunwayIncome[];
}

// The request range for the period's expenses and income. A day wider on each
// side, because date-only entries are stored at UTC midnight and fall outside
// a local-midnight range in some timezones; buildRunway trims to the period.
export function runwayRange(period: IncomePeriod, now: Date = new Date()): { startDate: string; endDate: string } {
    return {
        startDate: addDays(period.start, -1).toISOString(),
        endDate: addDays(startOfDay(now), 2).toISOString(),
    };
}

// One day per day of the period. Each expense and income lands on its calendar
// day the way the rest of the app reads dates (lib/dates.ts calendarDay), so a
// 1 am lunch counts on the day it was eaten, not the UTC day before.
export function buildRunway(
    period: IncomePeriod, entries: RunwayEntry[], incomes: RunwayIncome[], now: Date = new Date(),
): RunwayDay[] {
    const today = startOfDay(now);
    const days: RunwayDay[] = [];
    for (let i = 0; i < period.length; i++) {
        const date = addDays(period.start, i);
        const offset = differenceInCalendarDays(date, today);
        days.push({ date, index: i + 1, kind: offset < 0 ? "past" : offset === 0 ? "today" : "ahead", spent: 0, entries: [], incomes: [] });
    }
    const dayOf = (value: string) => {
        const i = differenceInCalendarDays(calendarDay(value), period.start);
        return i >= 0 && i < days.length ? days[i] : undefined;
    };
    for (const e of entries) {
        const d = dayOf(e.date);
        if (d) { d.spent += e.amount; d.entries.push(e); }
    }
    for (const inc of incomes) dayOf(inc.date)?.incomes.push(inc);
    return days;
}

// Round up to a clean axis value: 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10ⁿ.
const STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceCeil(v: number): number {
    if (v <= 0) return 0;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    return (STEPS.find((s) => s * pow >= v - 1e-9) ?? 10) * pow;
}

// The chart's top value. Near twice the daily amount, so the ordinary days and
// the days ahead stay readable; a rent day above it is drawn cut, with its
// amount written on top, rather than squashing every other bar flat.
export function runwayScale(perDay: number, maxSpent: number): { max: number; capped: boolean } {
    const cap = perDay > 0 ? perDay * 2.2 : maxSpent;
    const max = Math.max(100, niceCeil(Math.max(perDay * 1.15, Math.min(maxSpent, cap))));
    return { max, capped: maxSpent > max };
}

export interface SavingsTransfer {
    amount: number;
    // "deposit" moves money from the wallet into savings; anything else brings it back.
    direction: string;
    date: string;
}

// The wallet's closing balance on each day of the period up to today, worked
// back from today's balance: each day undoes what came in, what was spent
// and what moved to or from savings. Nothing is drawn for the days ahead.
export function walletTrace(days: RunwayDay[], transfers: SavingsTransfer[], walletNow: number): number[] {
    const upto = days.filter((d) => d.kind !== "ahead");
    if (upto.length === 0) return [];
    const net = upto.map((d) => d.incomes.reduce((s, i) => s + i.amount, 0) - d.spent);
    for (const t of transfers) {
        const i = differenceInCalendarDays(calendarDay(t.date), upto[0].date);
        if (i >= 0 && i < upto.length) net[i] += t.direction === "deposit" ? -t.amount : t.amount;
    }
    const closing = new Array<number>(upto.length);
    let balance = walletNow;
    for (let i = upto.length - 1; i >= 0; i--) {
        closing[i] = balance;
        balance -= net[i];
    }
    return closing;
}

export type PaceStatus = "on" | "ahead" | "over";

// A monthly budget against an even pace: by day 5 of 30 an even spender has
// used a sixth of it. "ahead" is a nudge, "over" means the limit is passed.
export function paceStatus(spent: number, limit: number, monthFraction: number): PaceStatus {
    if (spent > limit) return "over";
    return limit > 0 && spent / limit > monthFraction ? "ahead" : "on";
}
