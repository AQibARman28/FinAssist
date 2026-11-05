"use client";

import { useMemo, useRef, useState } from "react";
import type { MoneyFormatter } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useWidth } from "@/lib/useWidth";
import { axisNumber, barPath, niceMax } from "@/lib/chart";

export interface ColumnRow {
    key: string;
    label: string;       // under the column ("Mar")
    title?: string;      // in the readout ("March 2026"); defaults to label
    values: number[];    // one per series
}

export interface ColumnSeries {
    label: string;
    // "plat" is the figure being read; "dim" is the one it is compared with.
    tone: "plat" | "dim";
}

// Columns over time or category in the Timeline style (DESIGN.md › Runway):
// thin platinum bars with 4px tops that rise from the baseline left to right,
// a readout at the top right for the column being read, and a table for
// screen readers. Point, drag or use the arrow keys to read a column.
export function ColumnChart({
    rows, series, fmt, title, initial, className,
}: {
    rows: ColumnRow[];
    series: ColumnSeries[];
    fmt: MoneyFormatter;
    title: string;           // names the chart for screen readers
    initial?: number;        // the column read before anything is picked
    className?: string;
}) {
    const [boxRef, width] = useWidth<HTMLDivElement>();
    const start = Math.min(rows.length - 1, Math.max(0, initial ?? rows.length - 1));
    const [picked, setPicked] = useState<number | null>(null);
    const cur = picked ?? start;
    const dragging = useRef(false);

    const geo = useMemo(() => {
        if (!width || rows.length === 0) return null;
        const narrow = width < 560;
        const H = narrow ? 220 : 260, L = narrow ? 34 : 44, R = 6, T = 14, B = 34;
        const pw = width - L - R, ph = H - T - B, base = T + ph;
        const n = rows.length, band = pw / n;
        const groupW = Math.min(series.length * 28, band * 0.62);
        const bw = Math.max(3, (groupW - (series.length - 1) * 2) / series.length);
        const max = niceMax(Math.max(0, ...rows.flatMap((r) => r.values)), 100);
        const y = (v: number) => base - (Math.min(v, max) / max) * ph;
        const cx = (i: number) => L + band * (i + 0.5);
        // Every column is labelled when there is room; otherwise every other.
        const every = band < 34 ? 2 : 1;
        return { H, L, R, T, base, band, bw, groupW, max, y, cx, every };
    }, [width, rows, series.length]);

    const row = rows[cur];
    const indexAt = (clientX: number, el: HTMLElement) => {
        if (!geo) return cur;
        const r = el.getBoundingClientRect();
        return Math.min(rows.length - 1, Math.max(0, Math.floor((clientX - r.left - geo.L) / geo.band)));
    };
    const onKey = (e: React.KeyboardEvent) => {
        const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (step) { e.preventDefault(); setPicked(Math.min(rows.length - 1, Math.max(0, cur + step))); }
        if (e.key === "Home") { e.preventDefault(); setPicked(0); }
        if (e.key === "End") { e.preventDefault(); setPicked(rows.length - 1); }
        if (e.key === "Escape") setPicked(null);
    };
    const said = row ? `${row.title ?? row.label}: ${series.map((s, i) => `${s.label} ${fmt.format(row.values[i] ?? 0)}`).join(", ")}` : "";

    return (
        <div className={cn("min-w-0", className)}>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                {series.length > 1 ? (
                    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-zinc-300" aria-label="Key">
                        {series.map((s) => (
                            <li key={s.label} className="inline-flex items-center gap-2">
                                <span aria-hidden className={cn("w-2.5 h-2.5 rounded-[3px]", s.tone === "plat" ? "bg-plat" : "bg-plat/30")} />{s.label}
                            </li>
                        ))}
                    </ul>
                ) : <span />}
                {row && (
                    <div className="min-h-[60px] text-right">
                        <p className="text-[12.5px] text-zinc-400">{row.title ?? row.label}</p>
                        <p key={cur} className="mt-1 text-[30px] font-light [font-stretch:112%] leading-tight text-white tabular-nums motion-safe:animate-[runway-in_.22s_cubic-bezier(.16,1,.3,1)]">
                            {fmt.format(row.values[series.findIndex((s) => s.tone === "plat")] ?? row.values[0] ?? 0)}
                            {series.length > 1 && (
                                <span className="ml-2 text-sm font-normal text-zinc-300 [font-stretch:100%]">
                                    vs {fmt.format(row.values[series.findIndex((s) => s.tone === "dim")] ?? 0)}
                                </span>
                            )}
                        </p>
                    </div>
                )}
            </div>

            <div
                ref={boxRef}
                tabIndex={0}
                role="slider"
                aria-label={`${title}. Use the arrow keys to read each column.`}
                aria-valuemin={1}
                aria-valuemax={rows.length}
                aria-valuenow={cur + 1}
                aria-valuetext={said}
                onKeyDown={onKey}
                onBlur={() => setPicked(null)}
                onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } setPicked(indexAt(e.clientX, e.currentTarget)); }}
                onPointerMove={(e) => { if (e.pointerType === "touch" && !dragging.current) return; const i = indexAt(e.clientX, e.currentTarget); if (i !== cur) setPicked(i); }}
                onPointerUp={() => { dragging.current = false; }}
                onPointerCancel={() => { dragging.current = false; }}
                onPointerLeave={(e) => { if (!dragging.current && document.activeElement !== e.currentTarget) setPicked(null); }}
                className="relative mt-4 rounded-xl touch-pan-y select-none cursor-ew-resize focus-ring"
            >
                {geo ? (
                    <svg viewBox={`0 0 ${width} ${geo.H}`} width={width} height={geo.H} aria-hidden className="block overflow-visible">
                        <rect x={geo.cx(cur) - geo.band / 2} y={geo.T} width={geo.band} height={geo.base - geo.T} rx={8} className="fill-white/[0.035]" />
                        {[geo.max / 2, geo.max].map((v) => (
                            <g key={v}>
                                <line x1={geo.L} x2={width - geo.R} y1={geo.y(v)} y2={geo.y(v)} className="stroke-[#232327]" />
                                <text x={geo.L - 8} y={geo.y(v)} textAnchor="end" dominantBaseline="central" className="fill-zinc-400 text-[11px] font-medium tabular-nums">{axisNumber.format(v)}</text>
                            </g>
                        ))}
                        <line x1={geo.L} x2={width - geo.R} y1={geo.base} y2={geo.base} className="stroke-[#3a3a40]" />
                        {rows.map((r, i) => {
                            const x0 = geo.cx(i) - geo.groupW / 2;
                            const hot = i === cur;
                            return (
                                <g key={r.key}>
                                    {series.map((s, k) => {
                                        const v = r.values[k] ?? 0;
                                        const x = x0 + k * (geo.bw + 2);
                                        if (v <= 0) return <rect key={s.label} x={x} y={geo.base - 2} width={geo.bw} height={2} rx={1} className="fill-zinc-700" />;
                                        return (
                                            <path
                                                key={s.label}
                                                d={barPath(x, geo.y(v), geo.bw, geo.base)}
                                                className={cn("runway-rise transition-[fill,fill-opacity] duration-150",
                                                    s.tone === "dim" ? cn("fill-plat", hot ? "[fill-opacity:0.45]" : "[fill-opacity:0.28]") : hot ? "fill-white" : "fill-plat")}
                                                style={{ animationDelay: `${0.2 + i * 0.06 + k * 0.03}s` }}
                                            />
                                        );
                                    })}
                                    {i % geo.every === 0 && (
                                        <text x={geo.cx(i)} y={geo.base + 22} textAnchor="middle" className={cn("text-[11px] font-medium tabular-nums", hot ? "fill-zinc-100" : "fill-zinc-400")}>{r.label}</text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                ) : <div className="h-[220px] md:h-[260px]" />}
            </div>

            <div className="sr-only">
                <table>
                    <caption>{title}</caption>
                    <thead><tr><th scope="col">Period</th>{series.map((s) => <th key={s.label} scope="col">{s.label}</th>)}</tr></thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.key}><td>{r.title ?? r.label}</td>{series.map((s, k) => <td key={s.label}>{fmt.format(r.values[k] ?? 0)}</td>)}</tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
