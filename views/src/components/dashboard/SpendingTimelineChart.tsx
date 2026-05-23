"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
    Calendar, CalendarRange, CalendarDays, CalendarClock, X, Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { flagOutliers } from "@/lib/outliers";
import { iconFor, type IconName } from "@/lib/categoryIcons";

export type Granularity = "daily" | "weekly" | "monthly" | "yearly";

interface TopExpense {
    _id: string;
    amount: number;
    description: string;
    categoryId: string | null;
    categoryName: string;
    categoryColor: string;
    categoryIcon: IconName;
    date: string;
}
interface Bucket {
    period: string;
    label: string;
    total: number;
    count: number;
    maxExpenseId: string | null;
    hasMore: boolean;
    topExpenses: TopExpense[];
}
interface TimelineData {
    granularity: Granularity;
    from: string | null;
    to: string;
    buckets: Bucket[];
    grandTotal: number;
    grandCount: number;
}

type ChartRow = Bucket & { isOutlier: boolean };

export const GRANULARITIES: { key: Granularity; label: string; Icon: typeof Calendar }[] = [
    { key: "daily",   label: "Daily",   Icon: Calendar },
    { key: "weekly",  label: "Weekly",  Icon: CalendarRange },
    { key: "monthly", label: "Monthly", Icon: CalendarDays },
    { key: "yearly",  label: "Yearly",  Icon: CalendarClock },
];

export function SpendingTimelineChart({ granularity }: { granularity: Granularity }) {
    const { currency, format: fmtFull } = useCurrency();
    const fmtAxis = useMemo(
        () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0, notation: "compact" }),
        [currency],
    );
    const fmt0 = useMemo(
        () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }),
        [currency],
    );

    const [data, setData] = useState<TimelineData | null>(null);
    const [loading, setLoading] = useState(true);
    const [pinned, setPinned] = useState<Bucket | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setPinned(null);
        api.get(`/analytics/spending-timeline?granularity=${granularity}`)
            .then((res) => { if (!cancelled) setData(res.data?.data ?? null); })
            .catch((err) => { if (!cancelled) { console.error("spending-timeline fetch failed", err); setData(null); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [granularity]);

    const rows: ChartRow[] = useMemo(() => {
        const buckets = data?.buckets ?? [];
        const flags = flagOutliers(buckets.map((b) => b.total));
        return buckets.map((b, i) => ({ ...b, isOutlier: flags[i] }));
    }, [data]);

    return (
        <>
            {loading ? (
                <div className="h-[320px] flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                </div>
            ) : rows.length === 0 ? (
                <div className="h-[320px] flex items-center justify-center text-zinc-600 text-sm">
                    No spending in this period
                </div>
            ) : (
                <div className="h-[320px]" aria-label="Spending over time chart">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={rows}
                            onClick={(state) => {
                                const idx = Number(state?.activeTooltipIndex);
                                const p = Number.isInteger(idx) ? rows[idx] : undefined;
                                if (p) setPinned(p);
                            }}
                        >
                            <defs>
                                <linearGradient id="timelineFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dy={8} minTickGap={16} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 12 }} dx={-6} tickFormatter={(v: number) => fmtAxis.format(v)} width={64} />
                            <Tooltip
                                cursor={{ stroke: "#a855f7", strokeOpacity: 0.3 }}
                                content={(p) => <TimelineTooltip payload={p.active ? (p.payload as { payload: ChartRow }[]) : undefined} fmt0={fmt0} fmtFull={fmtFull} />}
                            />
                            <Area
                                type="monotone"
                                dataKey="total"
                                stroke="#a855f7"
                                strokeWidth={3}
                                fill="url(#timelineFill)"
                                fillOpacity={1}
                                activeDot={{ r: 5, fill: "#a855f7", stroke: "#fff", strokeWidth: 1 }}
                                dot={(props: { cx?: number; cy?: number; index?: number; payload?: ChartRow }) => {
                                    const { cx, cy, index, payload } = props;
                                    const key = `dot-${index}`;
                                    if (cx == null || cy == null || !payload?.isOutlier) return <g key={key} />;
                                    return (
                                        <g key={key}>
                                            <circle cx={cx} cy={cy} r={7} fill="#ef4444" fillOpacity={0.2} />
                                            <circle cx={cx} cy={cy} r={3.5} fill="#ef4444" stroke="#fff" strokeWidth={1.2} />
                                        </g>
                                    );
                                }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {!loading && rows.length > 0 && (
                <p className="mt-2 text-xs text-zinc-600">
                    Red markers flag unusually high {granularity === "daily" ? "days" : granularity === "weekly" ? "weeks" : granularity === "monthly" ? "months" : "years"}. Click a point for the full breakdown.
                </p>
            )}

            {pinned && (
                <TimelineBucketDetail
                    bucket={pinned}
                    granularity={granularity}
                    onClose={() => setPinned(null)}
                />
            )}
        </>
    );
}

// ── Hover tooltip ────────────────────────────────────────────────────────────

function TimelineTooltip({
    payload, fmt0, fmtFull,
}: {
    payload?: { payload: ChartRow }[];
    fmt0: Intl.NumberFormat;
    fmtFull: (v: number) => string;
}) {
    if (!payload || payload.length === 0) return null;
    const b = payload[0].payload;
    const more = b.count - b.topExpenses.length;
    return (
        <div className="min-w-[16rem] max-w-[20rem] p-3 rounded-xl bg-zinc-900/95 backdrop-blur border border-white/10 shadow-2xl shadow-black/50">
            <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-white">{b.label}</span>
                <span className="text-sm font-semibold text-amber-300 tabular-nums">{fmt0.format(b.total)}</span>
            </div>
            <div className="text-[11px] text-zinc-500 mb-2">{b.count} {b.count === 1 ? "expense" : "expenses"}</div>
            <div className="space-y-1">
                {b.topExpenses.map((e) => {
                    const isMax = e._id === b.maxExpenseId;
                    const Icon = iconFor(e.categoryIcon);
                    return (
                        <div
                            key={e._id}
                            className={cn(
                                "flex items-center gap-2 text-xs pl-2 border-l-2",
                                isMax ? "border-red-500/70" : "border-transparent",
                            )}
                        >
                            <Icon className="w-3 h-3 shrink-0" style={{ color: e.categoryColor }} />
                            <span className={cn("truncate flex-1", isMax ? "text-red-400" : "text-zinc-300")}>{e.description}</span>
                            <span className={cn("tabular-nums shrink-0", isMax ? "text-red-400 font-medium" : "text-zinc-400")}>{fmtFull(e.amount)}</span>
                        </div>
                    );
                })}
                {more > 0 && (
                    <div className="text-[11px] text-purple-400 pt-1">+{more} more — click to see all</div>
                )}
            </div>
        </div>
    );
}

// ── Click-to-pin bucket detail ───────────────────────────────────────────────

interface DetailRow {
    _id: string;
    amount: number;
    description: string;
    categoryName: string;
    categoryColor: string;
    categoryIcon: IconName;
}

function bucketBounds(granularity: Granularity, period: string): { start: Date; end: Date } {
    const start = new Date(`${period}T00:00:00.000Z`);
    const end = new Date(start);
    if (granularity === "daily") {
        end.setUTCHours(23, 59, 59, 999);
    } else if (granularity === "weekly") {
        end.setUTCDate(start.getUTCDate() + 6);
        end.setUTCHours(23, 59, 59, 999);
    } else if (granularity === "monthly") {
        return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999)) };
    } else {
        return { start, end: new Date(Date.UTC(start.getUTCFullYear(), 11, 31, 23, 59, 59, 999)) };
    }
    return { start, end };
}

function TimelineBucketDetail({
    bucket, granularity, onClose,
}: {
    bucket: Bucket;
    granularity: Granularity;
    onClose: () => void;
}) {
    const { format: fmtFull } = useCurrency();
    const [rows, setRows] = useState<DetailRow[] | null>(null);
    const [loading, setLoading] = useState(false);

    // Keyboard-dismissible.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    useEffect(() => {
        // If the preview already holds the whole bucket, reuse it. Otherwise
        // fetch the full list for the bucket window + a category map.
        if (!bucket.hasMore) {
            setRows(bucket.topExpenses.map((e) => ({
                _id: e._id, amount: e.amount, description: e.description,
                categoryName: e.categoryName, categoryColor: e.categoryColor, categoryIcon: e.categoryIcon,
            })));
            return;
        }
        let cancelled = false;
        setLoading(true);
        const { start, end } = bucketBounds(granularity, bucket.period);
        Promise.all([
            api.get("/expenses", { params: { startDate: start.toISOString(), endDate: end.toISOString(), limit: 100 } }),
            api.get("/categories?type=expense&includeArchived=true"),
        ])
            .then(([expRes, catRes]) => {
                if (cancelled) return;
                const catMap = new Map<string, { name: string; color: string; icon: IconName }>();
                for (const c of catRes.data?.data ?? []) catMap.set(c._id, { name: c.name, color: c.color, icon: c.icon });
                const list: DetailRow[] = (expRes.data?.data ?? []).map((e: { _id: string; amount: number; description: string; category: string }) => {
                    const c = catMap.get(e.category);
                    return {
                        _id: e._id, amount: e.amount, description: e.description,
                        categoryName: c?.name ?? "Uncategorized",
                        categoryColor: c?.color ?? "#6B7280",
                        categoryIcon: (c?.icon ?? "more") as IconName,
                    };
                });
                list.sort((a, b) => b.amount - a.amount);
                setRows(list);
            })
            .catch((err) => { if (!cancelled) { console.error("bucket detail fetch failed", err); setRows([]); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [bucket, granularity]);

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-4 pt-4 border-t border-white/5"
        >
            <div className="flex items-center justify-between mb-3">
                <div>
                    <span className="text-sm font-medium text-white">{bucket.label}</span>
                    <span className="text-xs text-zinc-500 ml-2">{bucket.count} {bucket.count === 1 ? "expense" : "expenses"}</span>
                </div>
                <button type="button" onClick={onClose} aria-label="Close detail" className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg hover:bg-white/5">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {loading ? (
                <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
            ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                    {(rows ?? []).map((e) => {
                        const isMax = e._id === bucket.maxExpenseId;
                        const Icon = iconFor(e.categoryIcon);
                        return (
                            <div
                                key={e._id}
                                className={cn(
                                    "flex items-center gap-3 p-2.5 rounded-xl border-l-2",
                                    isMax ? "border-red-500/70 bg-red-500/5" : "border-transparent bg-black/20",
                                )}
                            >
                                <div className="p-1.5 rounded-lg shrink-0" style={{ backgroundColor: `${e.categoryColor}22` }}>
                                    <Icon className="w-3.5 h-3.5" style={{ color: e.categoryColor }} />
                                </div>
                                <span className={cn("text-sm truncate flex-1", isMax ? "text-red-400" : "text-zinc-200")}>{e.description}</span>
                                <span className="text-xs text-zinc-500 truncate hidden sm:block">{e.categoryName}</span>
                                <span className={cn("text-sm tabular-nums shrink-0", isMax ? "text-red-400 font-medium" : "text-white")}>{fmtFull(e.amount)}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </motion.div>
    );
}
