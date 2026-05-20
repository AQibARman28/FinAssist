"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

interface Row { category: string; Current: number; Previous: number; }

export function SpendingComparisonChart() {
    const currency = useAuthStore((s) => s.user?.currency) || "USD";
    const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });

    const [data, setData] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const d = new Date();
                const res = await api.get(`/analytics/monthly-analytics?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`);
                const current  = res.data?.data?.currentExpenses  ?? [];
                const previous = res.data?.data?.previousExpenses ?? [];

                // Merge by category NAME (not _id ObjectId) so the X-axis
                // labels read "Food" / "Transport" instead of a 24-hex hash.
                const allNames = new Set<string>([
                    ...current.map((c: any)  => c.category),
                    ...previous.map((p: any) => p.category),
                ]);
                const rows: Row[] = Array.from(allNames).map((name) => ({
                    category: name,
                    Current:  current.find((c: any)  => c.category === name)?.total  ?? 0,
                    Previous: previous.find((p: any) => p.category === name)?.total ?? 0,
                }));
                rows.sort((a, b) => (b.Current + b.Previous) - (a.Current + a.Previous));
                setData(rows);
            } catch (err) {
                console.error("Failed to fetch comparison", err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return <div className="h-72 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
            <h3 className="text-lg font-semibold text-white mb-6">Monthly Spending Comparison</h3>

            {data.length === 0 ? (
                <div className="h-60 flex items-center justify-center text-zinc-500 text-sm">
                    No expenses recorded yet this month or last.
                </div>
            ) : (
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                            <XAxis dataKey="category" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false}
                                tickFormatter={(v: number) => fmt.format(v)} />
                            <Tooltip
                                contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                                itemStyle={{ color: "#fff" }}
                                cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
                                formatter={(v) => fmt.format(typeof v === "number" ? v : 0)}
                            />
                            <Legend />
                            <Bar dataKey="Previous" fill="#52525b" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="Current"  fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
