"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart, BarChart3, PieChart, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpendingChart, type ChartType, type SpendingDatum } from "./SpendingChart";
import { SpendingTimelineChart, GRANULARITIES, type Granularity } from "./SpendingTimelineChart";

type View = "breakdown" | "timeline";

interface DashboardChartPanelProps {
    data: SpendingDatum[];
}

const CHART_TYPES: { key: ChartType; label: string; Icon: LucideIcon }[] = [
    { key: "line", label: "Line", Icon: LineChart },
    { key: "bar",  label: "Bar",  Icon: BarChart3 },
    { key: "pie",  label: "Pie",  Icon: PieChart },
];

const VIEWS: { key: View; label: string }[] = [
    { key: "breakdown", label: "Spending Breakdown" },
    { key: "timeline",  label: "Spending Over Time" },
];

// Generic segmented sub-toggle (chart type or granularity). Icons always show;
// labels collapse on narrow screens so the header wraps gracefully.
function SubToggle<T extends string>({
    items, value, onChange, layoutId, ariaLabel,
}: {
    items: { key: T; label: string; Icon: LucideIcon }[];
    value: T;
    onChange: (v: T) => void;
    layoutId: string;
    ariaLabel: string;
}) {
    return (
        <div className="flex gap-1 p-1 bg-black/40 rounded-xl border border-white/5" role="group" aria-label={ariaLabel}>
            {items.map(({ key, label, Icon }) => {
                const active = key === value;
                return (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(key)}
                        className={cn(
                            "relative px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500/50",
                            active ? "text-white" : "text-zinc-500 hover:text-zinc-300",
                        )}
                    >
                        {active && (
                            <motion.div
                                layoutId={layoutId}
                                className="absolute inset-0 bg-purple-600/30 border border-purple-500/30 rounded-lg"
                                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                            />
                        )}
                        <span className="relative flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{label}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// Unifies the two dashboard graphs under one panel with a top-level switcher.
// State (chart type + granularity) lives here, so each graph's sub-selection
// is preserved when switching back and forth within the session.
export function DashboardChartPanel({ data }: DashboardChartPanelProps) {
    const [view, setView]               = useState<View>("breakdown");
    const [chartType, setChartType]     = useState<ChartType>("line");
    const [granularity, setGranularity] = useState<Granularity>("monthly");

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[400px]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex gap-1 p-1 bg-black/40 rounded-xl border border-white/5" role="group" aria-label="Chart view">
                    {VIEWS.map(({ key, label }) => {
                        const active = key === view;
                        return (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setView(key)}
                                className={cn(
                                    "relative px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500/50",
                                    active ? "text-white" : "text-zinc-500 hover:text-zinc-300",
                                )}
                            >
                                {active && (
                                    <motion.div
                                        layoutId="chartpanel-view-indicator"
                                        className="absolute inset-0 bg-purple-600/30 border border-purple-500/30 rounded-lg"
                                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                                    />
                                )}
                                <span className="relative">{label}</span>
                            </button>
                        );
                    })}
                </div>

                {view === "breakdown" ? (
                    <SubToggle items={CHART_TYPES} value={chartType} onChange={setChartType} layoutId="chartpanel-type-indicator" ariaLabel="Chart type" />
                ) : (
                    <SubToggle items={GRANULARITIES} value={granularity} onChange={setGranularity} layoutId="chartpanel-gran-indicator" ariaLabel="Granularity" />
                )}
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={view}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    aria-label={view === "breakdown" ? "Spending by category chart" : "Spending over time chart"}
                >
                    {view === "breakdown"
                        ? <SpendingChart data={data} chartType={chartType} />
                        : <SpendingTimelineChart granularity={granularity} />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
