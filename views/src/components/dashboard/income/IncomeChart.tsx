"use client";

import { useEffect, useMemo, useState } from "react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";

export type IncomeGranularity = "monthly" | "yearly";

interface Bucket { period: string; label: string; total: number; }
interface TimelineData { granularity: IncomeGranularity; buckets: Bucket[]; grandTotal: number; }

export function IncomeChart({ granularity }: { granularity: IncomeGranularity }) {
    const { currency, format: fmtFull } = useCurrency();
    const fmtAxis = useMemo(
        () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0, notation: "compact" }),
        [currency],
    );

    const [data, setData] = useState<TimelineData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get(`/incomes/timeline?granularity=${granularity}`)
            .then((res) => { if (!cancelled) setData(res.data?.data ?? null); })
            .catch((err) => { if (!cancelled) { console.error("income timeline fetch failed", err); setData(null); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [granularity]);

    const rows = data?.buckets ?? [];
    const hasAny = rows.some((b) => b.total > 0);

    if (loading) {
        return <div className="h-[300px] flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;
    }
    if (!hasAny) {
        return (
            <div className="h-[300px] flex items-center justify-center text-zinc-600 text-sm">
                No income recorded {granularity === "monthly" ? "this year" : "in recent years"}
            </div>
        );
    }

    return (
        <div className="h-[300px]" aria-label={`${granularity} income chart`}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="incomeBarFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dy={8} minTickGap={8} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dx={-6} tickFormatter={(v: number) => fmtAxis.format(v)} width={64} />
                    <Tooltip
                        cursor={{ fill: "rgba(16,185,129,0.08)" }}
                        content={(p) => {
                            if (!p.active || !p.payload?.length) return null;
                            const b = p.payload[0].payload as Bucket;
                            return (
                                <div className="p-3 rounded-xl bg-zinc-900/95 backdrop-blur border border-white/10 shadow-2xl shadow-black/50">
                                    <div className="text-sm font-medium text-white">{b.label}</div>
                                    <div className="text-sm font-semibold text-emerald-400 tabular-nums mt-0.5">{fmtFull(b.total)}</div>
                                </div>
                            );
                        }}
                    />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]} fill="url(#incomeBarFill)" maxBarSize={64}>
                        {rows.map((b) => <Cell key={b.period} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
