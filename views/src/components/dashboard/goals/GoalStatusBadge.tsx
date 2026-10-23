import { CheckCircle2, AlertTriangle, XCircle, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, type Tone } from "./goalPlanModel";

export const TONE_TEXT: Record<Tone, string> = {
    good:    "text-emerald-400",
    warn:    "text-amber-400",
    bad:     "text-red-400",
    neutral: "text-zinc-500",
};

const TONE_BADGE: Record<Tone, string> = {
    good:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warn:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
    bad:     "bg-red-500/10 text-red-400 border-red-500/20",
    neutral: "bg-white/5 text-zinc-400 border-white/10",
};

const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle, neutral: CircleDashed } as const;

// Feasibility badge from GET /goals/plan: On track / At risk / Not feasible.
export function GoalStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
    const tone = statusTone(status);
    const Icon = TONE_ICON[tone];
    return (
        <span
            className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap", TONE_BADGE[tone], className)}
            title={status ?? undefined}
        >
            <Icon className="w-3 h-3" />
            {statusLabel(status)}
        </span>
    );
}
