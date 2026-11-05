"use client";

import { useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import type { IncomePeriod } from "@/lib/dashboard";
import type { MoneyFormatter } from "@/lib/money";
import { runwayScale, type RunwayDay } from "@/lib/runway";
import { cn } from "@/lib/utils";
import { useWidth } from "@/lib/useWidth";
import { axisNumber, barPath } from "@/lib/chart";
import { LoadError } from "../LoadNotice";

interface Reading { title: string; value: string; unit: string; detail: string; said: string }

function readingFor(day: RunwayDay, perDay: number, nextLabel: string, fmt: MoneyFormatter): Reading {
    const date = format(day.date, "EEE d MMM");
    const items = day.entries.slice(0, 3).map((e) => `${e.description?.trim() || "Expense"} ${fmt.format(e.amount)}`);
    const more = day.entries.length > 3 ? ` and ${day.entries.length - 3} more` : "";
    const came = day.incomes.map((i) => `${i.description?.trim() || "Income"} came in: ${fmt.format(i.amount)}`);
    const spentDetail = [items.join(" · ") + more, ...came].filter(Boolean).join(". ");

    if (day.kind === "ahead" && day.spent === 0) {
        return perDay > 0
            ? { title: date, value: fmt.format(perDay), unit: "you can spend", detail: `Your daily amount until ${nextLabel}.`, said: `${date}: you can spend ${fmt.format(perDay)}` }
            : { title: date, value: fmt.format(0), unit: "set aside", detail: "Add income and every day ahead gets a safe amount.", said: `${date}: nothing set aside` };
    }
    if (day.kind === "today") {
        return {
            title: `Today · ${date}`,
            value: fmt.format(day.spent),
            unit: perDay > 0 ? `spent of ${fmt.format(perDay)}` : "spent",
            detail: spentDetail || "Add an expense and today's bar fills up.",
            said: `Today: ${fmt.format(day.spent)} spent${perDay > 0 ? ` of ${fmt.format(perDay)}` : ""}`,
        };
    }
    return {
        title: date,
        value: fmt.format(day.spent),
        unit: "spent",
        detail: spentDetail || "No spending recorded.",
        said: `${date}: ${fmt.format(day.spent)} spent`,
    };
}

// The pay period as one row of days, the dashboard's signature (DESIGN.md ›
// Runway). Days spent rise as bars; today is an outline at the daily amount;
// the days ahead stand faintly at that amount, so the month left is visible
// at a glance. Drag, point or use the arrow keys to read any day.
export function RunwayChart({
    days, period, perDay, loading, failed, onRetry, partial = false, fmt, className,
}: {
    days: RunwayDay[] | undefined;
    period: IncomePeriod | null;
    perDay: number;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    // More entries in the period than were fetched: say so, never imply less was spent.
    partial?: boolean;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const [boxRef, width] = useWidth<HTMLDivElement>();
    const todayIndex = days?.find((d) => d.kind === "today")?.index ?? days?.length ?? 1;
    const [picked, setPicked] = useState<number | null>(null);
    const cur = picked ?? todayIndex;
    const dragging = useRef(false);

    const last = period ? (period.kind === "income" ? period.end : addDays(period.end, -1)) : null;
    const nextLabel = period && last ? `${period.kind === "income" ? "your next income on" : "the month ends on"} ${format(last, "d MMM")}` : "the end of the month";
    const lastDay = period ? addDays(period.end, -1) : null;
    const title = period && lastDay
        ? (period.start.getMonth() === lastDay.getMonth() ? `${format(period.start, "MMMM")}, day by day` : `${format(period.start, "d MMM")} to ${format(lastDay, "d MMM")}, day by day`)
        : "Day by day";

    const geo = useMemo(() => {
        if (!days || !width) return null;
        const narrow = width < 560;
        const H = narrow ? 212 : 252, L = narrow ? 30 : 40, R = 6, T = 28, B = 40;
        const pw = width - L - R, ph = H - T - B, base = T + ph;
        const n = days.length, band = pw / n, bw = Math.max(3, Math.min(18, band * 0.62));
        const { max } = runwayScale(perDay, Math.max(0, ...days.map((d) => d.spent)));
        const y = (v: number) => base - (Math.min(v, max) / max) * ph;
        const cx = (i: number) => L + band * (i - 0.5);
        const every = narrow ? 10 : 5;
        const labels = days.filter((d, k) => k === 0 || k === n - 1 || (d.date.getDate() % every === 0 && k > 1 && k < n - 2));
        // The top row holds a cut bar's amount and the "Today" mark; on a narrow
        // chart they can meet, and then the amount wins (the outline and the
        // readout still show today).
        const todayDay = days.find((d) => d.kind === "today");
        const showToday = !!todayDay && !days.some((d) => d.spent > max && d.index !== todayDay.index && Math.abs(cx(d.index) - cx(todayDay.index)) < 72);
        // When it can't sit on top, "Today" takes its day's place on the axis row.
        const todayBelow = !showToday && !!todayDay;
        return { narrow, H, L, R, T, base, band, bw, max, y, cx, labels, showToday, todayBelow, todayIndex: todayDay?.index };
    }, [days, width, perDay]);

    const reading = days ? readingFor(days[Math.min(cur, days.length) - 1], perDay, nextLabel, fmt) : null;

    const dayAt = (clientX: number, el: HTMLElement) => {
        if (!geo || !days) return cur;
        const r = el.getBoundingClientRect();
        return Math.min(days.length, Math.max(1, Math.floor((clientX - r.left - geo.L) / geo.band) + 1));
    };
    const onKey = (e: React.KeyboardEvent) => {
        if (!days) return;
        const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (step) { e.preventDefault(); setPicked(Math.min(days.length, Math.max(1, cur + step))); }
        if (e.key === "Home") { e.preventDefault(); setPicked(1); }
        if (e.key === "End") { e.preventDefault(); setPicked(days.length); }
        if (e.key === "Escape") setPicked(null);
    };

    return (
        <section aria-labelledby="runway-title" className={cn("min-w-0 p-5 md:p-7 rounded-3xl bg-graphite shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]", className)}>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,auto)] md:items-start">
                <div>
                    <h2 id="runway-title" className="label-caps text-[12px] text-zinc-300">{title}</h2>
                    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-zinc-300" aria-label="Key">
                        <li className="inline-flex items-center gap-2"><span aria-hidden className="w-2.5 h-2.5 rounded-[3px] bg-plat" />Spent</li>
                        <li className="inline-flex items-center gap-2"><span aria-hidden className="w-2.5 h-2.5 rounded-[3px] bg-plat/25" />You can spend</li>
                        <li className="inline-flex items-center gap-2"><span aria-hidden className="w-2.5 h-2.5 bg-emerald-500 [clip-path:polygon(50%_0,100%_100%,0_100%)]" />Income</li>
                    </ul>
                </div>
                {reading && (
                    <div className="min-h-[84px] md:text-right">
                        <p className="text-[12.5px] text-zinc-400">{reading.title}</p>
                        <p key={cur} className="mt-1 text-[30px] font-light [font-stretch:112%] leading-tight text-white tabular-nums motion-safe:animate-[runway-in_.22s_cubic-bezier(.16,1,.3,1)]">
                            {reading.value}<span className="ml-2 text-sm font-normal text-zinc-300 [font-stretch:100%]">{reading.unit}</span>
                        </p>
                        <p className="mt-1 text-[12.5px] text-zinc-300 max-w-[52ch] md:ml-auto">{reading.detail}</p>
                    </div>
                )}
            </div>

            <div
                ref={boxRef}
                tabIndex={days ? 0 : -1}
                role={days ? "slider" : undefined}
                aria-label={days ? `${title}. Use the arrow keys to read each day.` : undefined}
                aria-valuemin={days ? 1 : undefined}
                aria-valuemax={days?.length}
                aria-valuenow={days ? cur : undefined}
                aria-valuetext={reading?.said}
                onKeyDown={onKey}
                onBlur={() => setPicked(null)}
                onPointerDown={(e) => { if (!days) return; dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } setPicked(dayAt(e.clientX, e.currentTarget)); }}
                onPointerMove={(e) => { if (!days || (e.pointerType === "touch" && !dragging.current)) return; const d = dayAt(e.clientX, e.currentTarget); if (d !== cur) setPicked(d); }}
                onPointerUp={() => { dragging.current = false; }}
                onPointerCancel={() => { dragging.current = false; }}
                onPointerLeave={(e) => { if (!dragging.current && document.activeElement !== e.currentTarget) setPicked(null); }}
                className="relative mt-4 rounded-xl touch-pan-y select-none cursor-ew-resize focus-ring"
            >
                {loading ? (
                    <div aria-hidden className="flex items-end gap-[3%] h-[212px] md:h-[252px] px-10 pb-10 pt-7">
                        {Array.from({ length: 24 }, (_, i) => <div key={i} className="flex-1 rounded-t bg-white/[0.05] animate-pulse" style={{ height: `${20 + ((i * 37) % 60)}%` }} />)}
                    </div>
                ) : failed || !days ? (
                    <LoadError what="your day-by-day spending" onRetry={onRetry} />
                ) : geo && (
                    <svg viewBox={`0 0 ${width} ${geo.H}`} width={width} height={geo.H} aria-hidden className="block overflow-visible">
                        {[geo.max / 2, geo.max].map((v) => (
                            <g key={v}>
                                <line x1={geo.L} x2={width - geo.R} y1={geo.y(v)} y2={geo.y(v)} className="stroke-[#232327]" />
                                <text x={geo.L - 8} y={geo.y(v)} textAnchor="end" dominantBaseline="central" className="fill-zinc-400 text-[11px] font-medium tabular-nums">{axisNumber.format(v)}</text>
                            </g>
                        ))}
                        <line x1={geo.L} x2={width - geo.R} y1={geo.base} y2={geo.base} className="stroke-[#3a3a40]" />

                        {days.map((d, k) => {
                            const x = geo.cx(d.index) - geo.bw / 2;
                            const hot = d.index === cur;
                            const over = d.spent > geo.max;
                            const allowance = perDay > 0 && (d.kind === "today" || (d.kind === "ahead" && d.spent === 0));
                            return (
                                <g key={d.index}>
                                    {d.kind === "ahead" && allowance && (
                                        <path
                                            d={barPath(x, geo.y(perDay), geo.bw, geo.base)}
                                            className={cn("runway-fade fill-plat transition-[fill-opacity] duration-150", hot ? "[fill-opacity:0.32]" : "[fill-opacity:0.13]")}
                                            style={{ animationDelay: `${0.8 + k * 0.02}s` }}
                                        />
                                    )}
                                    {d.kind === "today" && allowance && (
                                        <rect x={x + 0.75} y={geo.y(perDay)} width={geo.bw - 1.5} height={geo.base - geo.y(perDay)} rx={4} className="fill-plat/[0.08] stroke-plat [stroke-width:1.5]" />
                                    )}
                                    {d.spent > 0 && (
                                        <path
                                            d={barPath(x, geo.y(d.spent), geo.bw, geo.base)}
                                            className={cn("runway-rise transition-[fill] duration-150", d.kind === "today" && perDay > 0 && d.spent > perDay ? "fill-amber-400" : hot ? "fill-white" : "fill-plat")}
                                            style={{ animationDelay: `${0.35 + k * 0.06}s` }}
                                        />
                                    )}
                                    {d.spent === 0 && d.kind === "past" && (
                                        <rect x={x} y={geo.base - 2} width={geo.bw} height={2} rx={1} className="fill-zinc-700" />
                                    )}
                                    {over && (
                                        <>
                                            <path d={`M${x - 2} ${geo.T + 18}L${x + geo.bw + 2} ${geo.T + 11}`} className="stroke-graphite [stroke-width:3]" />
                                            <text x={geo.cx(d.index)} y={geo.T - 10} textAnchor={k < 2 ? "start" : "middle"} className="fill-zinc-300 text-[11px] font-medium tabular-nums">{fmt.format(d.spent)}</text>
                                        </>
                                    )}
                                    {d.kind === "today" && !over && geo.showToday && (
                                        <text x={geo.cx(d.index)} y={geo.T - 10} textAnchor="middle" className="fill-zinc-300 text-[11px] font-medium">Today</text>
                                    )}
                                    {d.incomes.length > 0 && (
                                        <path
                                            d={`M${geo.cx(d.index)} ${geo.base + 6}l5.5 9h-11z`}
                                            className="runway-fade fill-emerald-500"
                                            style={{ animationDelay: `${1.2 + k * 0.04}s` }}
                                        />
                                    )}
                                </g>
                            );
                        })}

                        {geo.labels.filter((d) => !(geo.todayBelow && Math.abs(geo.cx(d.index) - geo.cx(geo.todayIndex ?? 0)) < 26)).map((d) => (
                            <text key={d.index} x={geo.cx(d.index)} y={geo.base + 32} textAnchor="middle" className="fill-zinc-400 text-[11px] font-medium tabular-nums">{d.date.getDate()}</text>
                        ))}
                        {geo.todayBelow && geo.todayIndex && (
                            <text x={geo.cx(geo.todayIndex)} y={geo.base + 32} textAnchor="middle" className="fill-zinc-100 text-[11px] font-semibold">Today</text>
                        )}
                        {last && (
                            <text x={width - geo.R} y={geo.T - 10} textAnchor="end" className="fill-zinc-400 text-[11px] font-medium">
                                {period?.kind === "income" ? "Next income" : "Month ends"} · {format(last, "d MMM")}
                            </text>
                        )}
                        <line
                            x1={0} x2={0} y1={geo.T - 2} y2={geo.base}
                            className="stroke-zinc-100 [stroke-opacity:0.45] transition-transform duration-100 ease-linear"
                            style={{ transform: `translateX(${geo.cx(cur)}px)` }}
                        />
                    </svg>
                )}
            </div>

            {partial && <p className="mt-3 text-[12.5px] text-zinc-400">This shows your latest 300 entries in this stretch. Earlier days may have more on the Expenses page.</p>}

            {days && (
                <div className="sr-only">
                    <table>
                        <caption>Spending by day</caption>
                        <thead><tr><th scope="col">Day</th><th scope="col">Spent</th></tr></thead>
                        <tbody>
                            {days.filter((d) => d.kind !== "ahead" || d.spent > 0).map((d) => (
                                <tr key={d.index}><td>{format(d.date, "EEE d MMM")}</td><td>{fmt.format(d.spent)}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
