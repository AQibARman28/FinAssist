"use client";

import { ArrowDown, ArrowUp, PiggyBank, Wallet } from "lucide-react";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";

// Shape returned per-period by GET /analytics/balance.
export interface PeriodBreakdown {
    period: "monthly" | "yearly";
    from: string;
    to: string;
    carriedForward: number;
    income: number;
    expenses: number;
    saved: number;       // moved into goals this period
    savingsOut: number;  // net moved into the Savings account this period
    netIncome: number;
    closing: number;     // = the Wallet for this period
}

export interface BalanceData {
    available: number;
    wallet: number;
    savingsBalance: number;
    cumulative: { income: number; expenses: number; saved: number };
    monthly: PeriodBreakdown;
    yearly: PeriodBreakdown;
}

// Renders the running-balance math for one period:
//   Carried forward + Income − Expenses − Savings(green) = Balance
// Savings is highlighted green because it isn't spent — it's set aside.
export function SavingsBreakdown({ breakdown, periodLabel }: { breakdown: PeriodBreakdown; periodLabel?: string }) {
    const { format: fmt } = useCurrency();
    const carryLabel = "Carried forward";

    return (
        <div className="p-5 rounded-3xl bg-zinc-900/50 border border-white/5 space-y-1">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-medium">Balance{periodLabel ? ` · ${periodLabel}` : ""}</h3>
                <Wallet className="w-4 h-4 text-zinc-500" />
            </div>

            <Row icon={<ArrowDown className="w-3.5 h-3.5" />} label={carryLabel} value={fmt(breakdown.carriedForward)} tone="carry" />
            <Row icon={<ArrowUp className="w-3.5 h-3.5" />} label="Income" value={`+ ${fmt(breakdown.income)}`} tone="income" />
            <Row icon={<ArrowDown className="w-3.5 h-3.5" />} label="Expenses (out of pocket)" value={`− ${fmt(breakdown.expenses)}`} tone="expense" />
            {breakdown.saved > 0 && (
                <Row icon={<PiggyBank className="w-3.5 h-3.5" />} label="Saved to goals" value={`− ${fmt(breakdown.saved)}`} tone="savings" />
            )}
            {breakdown.savingsOut > 0 && (
                <Row icon={<PiggyBank className="w-3.5 h-3.5" />} label="Moved to savings" value={`− ${fmt(breakdown.savingsOut)}`} tone="savings" />
            )}

            <div className="flex items-center justify-between pt-3 mt-2 border-t border-white/10">
                <span className="text-sm font-medium text-zinc-300">Wallet (spendable)</span>
                <span className={cn("text-lg font-bold tabular-nums", breakdown.closing < 0 ? "text-red-400" : "text-white")}>
                    {fmt(breakdown.closing)}
                </span>
            </div>
        </div>
    );
}

const TONE: Record<string, string> = {
    carry:   "text-zinc-400",
    income:  "text-zinc-300",
    expense: "text-red-400/80",
    savings: "text-emerald-400",
};

function Row({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: keyof typeof TONE }) {
    return (
        <div className="flex items-center justify-between gap-3 py-1.5">
            <span className={cn("flex items-center gap-2 text-sm min-w-0", TONE[tone])}>
                <span className="shrink-0">{icon}</span>
                <span className="truncate">{label}</span>
            </span>
            <span className={cn("text-sm tabular-nums shrink-0", TONE[tone])}>{value}</span>
        </div>
    );
}
