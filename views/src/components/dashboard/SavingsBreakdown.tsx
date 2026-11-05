"use client";

import { motion } from "framer-motion";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";
import { Card, Skeleton, StateNote } from "./ui";
import { LoadError } from "./LoadNotice";

// Shape returned per-period by GET /analytics/balance.
export interface PeriodBreakdown {
    period: "monthly" | "yearly";
    from: string;
    to: string;
    carriedForward: number;
    income: number;
    expenses: number;
    saved: number;       // moved into goals this period
    released?: number;   // goal money returned to the wallet this period (deleted goals)
    savingsOut: number;  // net moved into the Savings account this period
    netIncome: number;
    closing: number;     // = the Wallet for this period
}

export interface BalanceData {
    available: number;
    wallet: number;
    savingsBalance: number;
    cumulative: { income: number; expenses: number; saved: number; released?: number };
    monthly: PeriodBreakdown;
    yearly: PeriodBreakdown;
}

const EASE = [0.16, 1, 0.3, 1] as const;

// Platinum in three steps: spent is the full metal, saved half, and what is
// left sits close to the track (DESIGN.md › One Accent).
const STEPS = {
    spent: "bg-plat",
    saved: "bg-plat/50",
    left:  "bg-plat/[0.18]",
} as const;

// One period's money in two readings. First where the income went, as one
// bar split into spent / saved / left. Then the running-balance sum that ends
// at the wallet:
//   Carried forward + Income − Spent − Saved + Returned − Moved to savings = Wallet
// "Returned" is money from a deleted goal flowing back into the wallet on the
// day the goal was deleted (earlier months are left untouched).
export function SavingsBreakdown({
    breakdown, periodLabel = "this month", loading = false, failed = false, onRetry, id = "balance-breakdown", className,
}: {
    breakdown: PeriodBreakdown | null;
    periodLabel?: string;
    loading?: boolean;
    failed?: boolean;
    onRetry?: () => void;
    id?: string;
    className?: string;
}) {
    const { format: fmt } = useCurrency();
    const title = `Balance ${periodLabel}`;

    if (loading) {
        return (
            <Card title={title} id={id} className={className}>
                <div aria-hidden className="space-y-4">
                    <Skeleton className="h-4 w-52 rounded-md" />
                    <Skeleton className="h-2 rounded-full" />
                    <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
                    <div className="pt-4 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 rounded-md" />)}</div>
                </div>
            </Card>
        );
    }
    if (failed || !breakdown) {
        return (
            <Card title={title} id={id} className={className}>
                {onRetry
                    ? <LoadError what="your balance" onRetry={onRetry} className="py-6" />
                    : <p className="text-sm text-zinc-300">Couldn&apos;t load your balance.</p>}
            </Card>
        );
    }

    const released = breakdown.released ?? 0;
    const income = Math.max(0, breakdown.income);
    const spent = Math.max(0, breakdown.expenses);
    const saved = Math.max(0, breakdown.saved) + Math.max(0, breakdown.savingsOut);
    const out = spent + saved;
    const left = Math.max(0, income - out);
    const overBy = out - income;
    const shares = overBy <= 0 && income > 0;
    const parts = ([
        { key: "spent", label: "Spent", value: spent },
        { key: "saved", label: "Saved", value: saved },
        { key: "left", label: "Left", value: left },
    ] as const).filter((p) => p.key !== "left" || shares);
    const drawn = parts.filter((p) => p.value > 0);

    return (
        <Card title={title} id={id} className={cn("flex flex-col", className)}>
            <p className="text-[13.5px] text-zinc-300">
                {income > 0
                    ? <>Of the <span className="text-white tabular-nums">{fmt(income)}</span> that came in {periodLabel}</>
                    : <>Nothing has come in {periodLabel} yet.</>}
            </p>

            {drawn.length > 0 && (
                <motion.div
                    aria-hidden
                    className="mt-3 flex gap-[2px] h-2 rounded-full overflow-hidden"
                    style={{ originX: 0 }}
                    initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                    transition={{ duration: 0.9, delay: 0.15, ease: EASE }}
                >
                    {drawn.map((p) => (
                        <span key={p.key} className={cn("h-full min-w-[3px]", STEPS[p.key])} style={{ flex: `${p.value} 1 0` }} />
                    ))}
                </motion.div>
            )}

            <ul className={cn("grid gap-3", parts.length === 3 ? "grid-cols-3" : "grid-cols-2", drawn.length > 0 ? "mt-4" : "mt-3")}>
                {parts.map((p) => (
                    <li key={p.key} className="min-w-0">
                        <span className="flex items-center gap-2 text-[12.5px] text-zinc-400 tabular-nums">
                            <span aria-hidden className={cn("w-2.5 h-2.5 shrink-0 rounded-[3px]", STEPS[p.key])} />
                            <span className="truncate">{p.label}{shares && <> · {Math.round((p.value / income) * 100)}%</>}</span>
                        </span>
                        <span className="mt-1 block text-white tabular-nums truncate">{fmt(p.value)}</span>
                    </li>
                ))}
            </ul>

            {overBy > 0 && (
                <StateNote tone="warn" icon={TriangleAlert} className="mt-4 items-start [&>svg]:mt-[2px] tabular-nums">
                    <span>{fmt(overBy)} more went out than came in {periodLabel}.</span>
                </StateNote>
            )}

            <div className="mt-auto pt-6">
                <dl className="pt-5 border-t border-white/[0.07] space-y-2.5 text-[13.5px]">
                    <Line label="Carried forward" value={fmt(breakdown.carriedForward)} />
                    <Line label="Income" value={`+ ${fmt(breakdown.income)}`} />
                    <Line label="Spent" value={`− ${fmt(breakdown.expenses)}`} />
                    {breakdown.saved > 0 && <Line label="Saved to goals" value={`− ${fmt(breakdown.saved)}`} />}
                    {released > 0 && <Line label="Returned from deleted goals" value={`+ ${fmt(released)}`} />}
                    {breakdown.savingsOut > 0 && <Line label="Moved to savings" value={`− ${fmt(breakdown.savingsOut)}`} />}
                </dl>
                <dl className="mt-4 pt-4 border-t border-white/[0.07] flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                    <dt>
                        <span className="label-caps text-zinc-300">Wallet</span>
                        <span className="block mt-1 text-[12.5px] text-zinc-400">What you can spend</span>
                    </dt>
                    <dd className="text-right">
                        <span className="block text-[26px] leading-none font-light [font-stretch:112%] tabular-nums text-white">{fmt(breakdown.closing)}</span>
                        {breakdown.closing < 0 && <StateNote tone="bad" icon={CircleAlert} className="mt-2">Below zero</StateNote>}
                    </dd>
                </dl>
            </div>
        </Card>
    );
}

function Line({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-400 min-w-0 truncate">{label}</dt>
            <dd className="text-zinc-100 tabular-nums shrink-0">{value}</dd>
        </div>
    );
}
