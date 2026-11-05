import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { calendarDay } from "./dates";

export interface SavingsMove {
    amount: number;
    direction: "deposit" | "withdraw";
    date: string;
}

export interface SavingsMonth {
    key: string;       // "2026-11"
    label: string;     // "Nov"
    title: string;     // "November 2026"
    closing: number;   // the savings balance at the month's end (or now)
    net: number;       // what went in minus what came out that month
}

// The savings balance at the end of each of the last `months` months, oldest
// first, ending with the current one. The API's balance is the sum of these
// same entries, so the last closing matches it. Days follow calendarDay, so a
// month-end transfer stored at UTC midnight lands on its own day.
export function savingsByMonth(entries: SavingsMove[], now: Date, months = 6): SavingsMonth[] {
    const signed = entries.map((e) => ({ day: calendarDay(e.date), v: e.direction === "withdraw" ? -e.amount : e.amount }));
    const first = startOfMonth(addMonths(now, -(months - 1)));
    let closing = signed.filter((e) => e.day < first).reduce((s, e) => s + e.v, 0);
    return Array.from({ length: months }, (_, i) => {
        const start = addMonths(first, i);
        const end = endOfMonth(start);
        const net = signed.filter((e) => e.day >= start && e.day <= end).reduce((s, e) => s + e.v, 0);
        closing += net;
        return { key: format(start, "yyyy-MM"), label: format(start, "MMM"), title: format(start, "MMMM yyyy"), closing, net };
    });
}
