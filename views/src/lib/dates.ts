import { differenceInCalendarDays, format, getDaysInMonth } from "date-fns";

// A date entered without a time is stored as UTC midnight. Read in local time
// that shows as 6:00 AM in Dhaka, or the previous day west of UTC, so those
// are read in UTC; anything with a real time is read locally.
export function calendarDay(value: string | Date): Date {
    const d = new Date(value);
    const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    return utcMidnight
        ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
        : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// "Today", "Yesterday", "Mon 2 Nov", "31 Dec 2025". Never a time of day:
// most entries have no real time, and a made-up one reads as wrong.
export function formatDay(value: string | Date, now: Date = new Date()): string {
    const day = calendarDay(value);
    const ago = differenceInCalendarDays(now, day);
    if (ago === 0) return "Today";
    if (ago === 1) return "Yesterday";
    return format(day, day.getFullYear() === now.getFullYear() ? "EEE d MMM" : "d MMM yyyy");
}

// How much of this month a "this month" figure covers: 5 of 30 days, "1–5 Nov".
export function monthSoFar(now: Date = new Date()): { day: number; days: number; label: string } {
    const day = now.getDate();
    const month = format(now, "MMM");
    return { day, days: getDaysInMonth(now), label: day === 1 ? `1 ${month}` : `1–${day} ${month}` };
}
