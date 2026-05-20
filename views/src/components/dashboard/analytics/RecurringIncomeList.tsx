"use client";

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { iconFor, type IconName } from "@/lib/categoryIcons";

interface Item {
    _id: string;
    amount: number;
    frequency: "weekly" | "biweekly" | "monthly" | "yearly";
    isPostTax: boolean;
    category: string;
    categoryColor: string;
    categoryIcon: IconName;
    monthlyEquivalent: number;
    annualEquivalent:  number;
}

export function RecurringIncomeList() {
    const currency = useAuthStore((s) => s.user?.currency) || "USD";
    const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });

    const [items, setItems] = useState<Item[]>([]);
    const [monthlyTotal, setMonthlyTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await api.get("/analytics/recurring-income");
                setItems(res.data?.data?.items ?? []);
                setMonthlyTotal(res.data?.data?.monthlyTotal ?? 0);
            } catch (err) {
                console.error("Failed to fetch recurring income", err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return <div className="h-64 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Repeat className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-lg font-semibold text-white">Recurring Income</h3>
                </div>
                <span className="text-xs text-zinc-500 tabular-nums">
                    {fmt.format(monthlyTotal)}/mo
                </span>
            </div>

            {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center">
                    <p className="text-zinc-500 text-sm">No recurring income set up yet.</p>
                    <p className="text-zinc-600 text-xs mt-1">Add an income with the Recurring toggle to see it here.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {items.map((it) => {
                        const Icon = iconFor(it.categoryIcon);
                        return (
                            <div key={it._id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${it.categoryColor}22` }}>
                                        <Icon className="w-4 h-4" style={{ color: it.categoryColor }} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-white font-medium text-sm truncate">{it.category}</div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                                                {it.frequency}
                                            </span>
                                            {!it.isPostTax && (
                                                <span className="text-[10px] uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                                                    pre-tax
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-emerald-400 font-medium text-sm tabular-nums">
                                        {fmt.format(it.amount)}
                                    </div>
                                    <div className="text-[11px] text-zinc-500 tabular-nums">
                                        ≈ {fmt.format(it.monthlyEquivalent)}/mo
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
