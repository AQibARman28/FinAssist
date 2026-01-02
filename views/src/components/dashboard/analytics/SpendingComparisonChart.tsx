"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api } from "@/lib/api";

export function SpendingComparisonChart() {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const date = new Date();
                const year = date.getFullYear();
                const month = date.getMonth() + 1;

                const res = await api.get(`/analytics/monthly-analytics?year=${year}&month=${month}`);

                // Transform data for chart
                // Need to merge current and previous month data by category
                const current = res.data.data.currentExpenses;
                const previous = res.data.data.previousExpenses;

                const allCategories = new Set([
                    ...current.map((i: any) => i._id),
                    ...previous.map((i: any) => i._id)
                ]);

                const chartData = Array.from(allCategories).map(cat => {
                    const curr = current.find((i: any) => i._id === cat);
                    const prev = previous.find((i: any) => i._id === cat);
                    return {
                        name: cat,
                        Current: curr ? curr.total : 0,
                        Previous: prev ? prev.total : 0
                    };
                });

                setData(chartData);
            } catch (err) {
                console.error("Failed to fetch analytics", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    if (loading) return <div className="h-64 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
            <h3 className="text-lg font-semibold text-white mb-6">Monthly Spending Comparison</h3>

            <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis
                            dataKey="name"
                            stroke="#71717a"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#71717a"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `$${value}`}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                            itemStyle={{ color: "#fff" }}
                            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                        />
                        <Legend />
                        <Bar dataKey="Previous" fill="#52525b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Current" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
