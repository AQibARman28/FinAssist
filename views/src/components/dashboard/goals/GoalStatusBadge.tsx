import { CircleAlert, CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { goalStatus, type GoalPlanRow, type GoalTone } from "@/lib/dashboard";
import type { MoneyFormatter } from "@/lib/money";
import { cn } from "@/lib/utils";
import { StateNote } from "../ui";

const ICON: Record<GoalTone, typeof CircleCheck> = {
    good: CircleCheck, done: CircleCheck, warn: TriangleAlert, bad: CircleAlert, neutral: CircleDashed,
};
// Same tones as the dashboard's Goals card: a goal out of reach is a warning, not an error (red is for limits passed and failures).
const TONE: Record<GoalTone, "good" | "warn" | "bad" | "neutral"> = {
    good: "good", done: "good", warn: "warn", bad: "warn", neutral: "neutral",
};

// A goal's verdict from the savings plan (GET /goals/plan) as a State Note:
// an icon and words, never colour alone. The words are the dashboard's
// (lib/dashboard goalStatus), so a goal reads the same on both screens:
// "On track", "Behind: needs about ৳1,250 a month", "Reached". A completed
// goal needs no plan row.
export function GoalStatusBadge({ row, completed = false, monthlySurplus = 0, fmt, now, className }: {
    row?: GoalPlanRow;
    completed?: boolean;
    monthlySurplus?: number;
    fmt: MoneyFormatter;
    now?: Date;
    className?: string;
}) {
    const status = completed ? { tone: "done" as const, text: "Reached" } : row ? goalStatus(row, monthlySurplus, fmt, now) : null;
    if (!status) return null;
    return (
        <StateNote tone={TONE[status.tone]} icon={ICON[status.tone]} className={cn("items-start [&>svg]:mt-[2px] tabular-nums", className)}>
            <span>{status.text}</span>
        </StateNote>
    );
}
