"use client";

import { useState } from "react";
import { rankSpending, type SpendingRow } from "@/lib/dashboard";
import type { MoneyFormatter } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, Segmented } from "../ui";
import { LoadError } from "../LoadNotice";

export type WhereMonth = "this" | "last";
const OTHER_COLOR = "#71717a";
// Past six slices a part-to-whole ring stops reading at a glance; the rest fold into "Other".
const MAX_SLICES = 6;
// The ring, in its 200 × 200 drawing: a thin stroke, 2px apart between slices.
const R = 78;
const C = 2 * Math.PI * R;
const GAP = 3;

// Where the month's money went: a thin ring split by category, each in its
// own colour (colour follows the category, never its rank), with the month's
// total in the middle and every amount in the list below. Hovering a slice or
// a row lights both.
export function WhereItWentCard({
    rows, loading, failed, onRetry, month, onMonth, monthNames, periodLabel, fmt, className,
}: {
    rows: SpendingRow[];
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    month: WhereMonth;
    onMonth: (m: WhereMonth) => void;
    // Short names for the toggle: [this month, last month], e.g. ["Nov", "Oct"].
    monthNames: [string, string];
    periodLabel: string;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const [hot, setHot] = useState<string | null>(null);
    const ranked = rankSpending(rows);
    const shown = ranked.length > MAX_SLICES
        ? [...ranked.slice(0, MAX_SLICES - 1), {
            name: "Other",
            amount: ranked.slice(MAX_SLICES - 1).reduce((s, r) => s + r.amount, 0),
            share: ranked.slice(MAX_SLICES - 1).reduce((s, r) => s + r.share, 0),
            color: OTHER_COLOR,
        }]
        : ranked;
    const total = ranked.reduce((s, r) => s + r.amount, 0);
    const hotRow = shown.find((r) => r.name === hot);

    // Each slice starts where the ones before it end.
    const starts = shown.map((_, i) => shown.slice(0, i).reduce((s, r) => s + r.share * C, 0));
    const slices = shown.map((r, i) => {
        const len = r.share * C;
        const gap = shown.length > 1 ? Math.min(GAP, len / 2) : 0;
        return { ...r, dash: `${Math.max(0, len - gap).toFixed(2)} ${C.toFixed(2)}`, offset: (-(starts[i] + gap / 2)).toFixed(2) };
    });

    return (
        <Card title="Where it went" id="where-it-went" className={className}
            aside={<Segmented items={[{ key: "this", label: monthNames[0] }, { key: "last", label: monthNames[1] }]} value={month} onChange={onMonth} label="Month shown" />}>
            {loading ? (
                <div aria-hidden className="grid justify-items-center gap-6">
                    <div className="w-44 h-44 rounded-full border-[10px] border-white/[0.05] animate-pulse" />
                    <div className="w-full space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-5 rounded bg-white/[0.05] animate-pulse" />)}</div>
                </div>
            ) : failed ? (
                <LoadError what="your spending" onRetry={onRetry} className="py-6" />
            ) : shown.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">{month === "this" ? "Nothing spent this month yet." : "Nothing was spent last month."}</p>
            ) : (
                <>
                    <div className="relative mx-auto w-[min(100%,190px)] aspect-square" onPointerLeave={() => setHot(null)}>
                        <svg viewBox="0 0 200 200" aria-hidden className="block w-full h-full -rotate-90">
                            <circle cx={100} cy={100} r={R} fill="none" className="stroke-white/[0.05]" strokeWidth={10} />
                            {slices.map((s, i) => (
                                <circle
                                    key={s.name}
                                    cx={100} cy={100} r={R} fill="none"
                                    stroke={s.color || OTHER_COLOR}
                                    strokeWidth={hot === s.name ? 16 : 10}
                                    strokeDasharray={s.dash}
                                    strokeDashoffset={s.offset}
                                    onPointerEnter={() => setHot(s.name)}
                                    className={cn("ring-draw transition-[stroke-width,opacity] duration-200 ease-out-expo", hot && hot !== s.name && "opacity-25")}
                                    style={{ animationDelay: `${0.15 + i * 0.12}s` }}
                                />
                            ))}
                        </svg>
                        {/* The middle says the total, or the slice being pointed at. */}
                        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                            <span className="text-[26px] font-light [font-stretch:112%] leading-none text-white tabular-nums">{fmt.format(hotRow ? hotRow.amount : total)}</span>
                            <span className="mt-1.5 text-[12px] text-zinc-400">{hotRow ? `${hotRow.name} · ${Math.round(hotRow.share * 100)}%` : `spent · ${periodLabel}`}</span>
                        </div>
                    </div>
                    <ul className="mt-6 space-y-3" onPointerLeave={() => setHot(null)}>
                        {shown.map((r) => (
                            <li
                                key={r.name}
                                onPointerEnter={() => setHot(r.name)}
                                className={cn("grid grid-cols-[10px_minmax(0,1fr)_auto_42px] items-center gap-3 text-sm transition-opacity duration-150", hot && hot !== r.name && "opacity-45")}
                            >
                                <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color || OTHER_COLOR }} />
                                <span className="truncate text-zinc-100">{r.name}</span>
                                <span className="tabular-nums text-white">{fmt.format(r.amount)}</span>
                                <span className="text-right text-[13px] tabular-nums text-zinc-400">{Math.round(r.share * 100)}%</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Card>
    );
}
