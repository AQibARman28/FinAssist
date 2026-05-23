"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useCurrency } from "@/lib/useCurrency";

export type ChartType = "line" | "bar" | "pie";

interface SpendingDatum {
    name: string;
    amount: number;
    color?: string; // category color, used to tint pie slices / bars
    // Recharts' Pie data type requires a string index signature.
    [key: string]: string | number | undefined;
}

interface SpendingChartProps {
    data: SpendingDatum[];
    chartType?: ChartType;
}

// Purple-family fallback palette for slices without a category color.
const FALLBACK_COLORS = ["#a855f7", "#8b5cf6", "#c084fc", "#7c3aed", "#d8b4fe", "#6d28d9", "#a78bfa", "#9333ea"];

const TOOLTIP = {
    contentStyle: { backgroundColor: "#09090b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", padding: "12px" },
    itemStyle: { color: "#e4e4e7" },
};

export function SpendingChart({ data, chartType = "line" }: SpendingChartProps) {
    const { format: fmtFull, currency } = useCurrency();
    const fmt0 = useMemo(
        () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }),
        [currency],
    );

    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] w-full mt-4 flex items-center justify-center text-zinc-600">
                No spending data available
            </div>
        );
    }

    return (
        <div className="h-[300px] w-full mt-4">
            <AnimatePresence mode="wait">
                <motion.div
                    key={chartType}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="h-full w-full"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        {chartType === "line" ? (
                            // Preserved exactly from the original chart — only the tooltip
                            // now formats via useCurrency instead of a hardcoded "$".
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dx={-10} />
                                <Tooltip {...TOOLTIP} formatter={(value) => [fmtFull(Number(value) || 0), "Amount"] as [string, string]} />
                                <Area type="monotone" dataKey="amount" stroke="#a855f7" strokeWidth={3} fillOpacity={1} fill="url(#colorAmount)" />
                            </AreaChart>
                        ) : chartType === "bar" ? (
                            <BarChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dx={-10} tickFormatter={(v: number) => fmt0.format(v)} />
                                <Tooltip {...TOOLTIP} cursor={{ fill: "rgba(255,255,255,0.05)" }} formatter={(value) => [fmtFull(Number(value) || 0), "Amount"] as [string, string]} />
                                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                                    {data.map((d, i) => <Cell key={i} fill={d.color ?? "#a855f7"} />)}
                                </Bar>
                            </BarChart>
                        ) : (
                            <PieChart>
                                <Pie
                                    data={data}
                                    dataKey="amount"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    innerRadius={50}
                                    paddingAngle={2}
                                    labelLine={false}
                                    label={(p: { percent?: number }) => `${Math.round((p.percent ?? 0) * 100)}%`}
                                >
                                    {data.map((d, i) => <Cell key={i} fill={d.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />)}
                                </Pie>
                                <Tooltip {...TOOLTIP} formatter={(value, name) => [fmtFull(Number(value) || 0), String(name)] as [string, string]} />
                                <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                            </PieChart>
                        )}
                    </ResponsiveContainer>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
