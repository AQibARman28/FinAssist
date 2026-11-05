"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { MoneyFormatter } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Missing } from "../ui";
import { RollingNumber } from "./RollingNumber";

// The wallet as an object: a brushed-titanium card (globals.css › .metal-card)
// with the balance engraved on it and, across its face, the wallet's closing
// balance on each day so far this stretch. It leans toward the pointer and its
// light follows; both hold still with reduced motion. The whole card opens Savings.

// The engraved line: one point per day, scaled to the card's own range.
function Trace({ values, className }: { values: number[]; className?: string }) {
    if (values.length < 2) return null;
    const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
    const points = values.map((v, i) => `${((i / (values.length - 1)) * 300).toFixed(1)},${(44 - ((v - min) / span) * 38).toFixed(1)}`).join(" ");
    return (
        <svg aria-hidden viewBox="0 0 300 48" preserveAspectRatio="none" className={cn("pointer-events-none block h-9 opacity-60", className)}>
            <polyline points={points} fill="none" stroke="rgb(255 255 255 / 0.6)" strokeWidth={1.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
export function WalletCard({
    wallet, savings, name, trace, loading, failed, fmt, className,
}: {
    wallet: number | undefined;
    savings: number | undefined;
    name: string;
    // Closing balance on each day of the stretch so far (lib/runway.ts walletTrace).
    trace: number[] | undefined;
    loading: boolean;
    failed: boolean;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const ref = useRef<HTMLAnchorElement>(null);
    const reduce = useReducedMotion();

    const lean = (e: React.PointerEvent) => {
        const el = ref.current;
        if (reduce || !el || e.pointerType === "touch") return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--rx", `${((0.5 - py) * 10).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${((px - 0.5) * 14).toFixed(2)}deg`);
        el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    };
    const rest = () => { for (const p of ["--rx", "--ry", "--mx", "--my"]) ref.current?.style.removeProperty(p); };

    const label = wallet === undefined ? "Wallet and savings. Open Savings" : `Wallet ${fmt.format(wallet)}${savings !== undefined ? `, savings ${fmt.format(savings)}` : ""}. Open Savings`;

    return (
        <motion.div
            className={cn("[perspective:1100px]", className)}
            initial={{ opacity: 0, y: 28, rotateX: 16 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
            <Link
                ref={ref}
                href="/dashboard/savings"
                aria-label={label}
                onPointerMove={lean}
                onPointerLeave={rest}
                className="metal-card relative grid grid-rows-[auto_1fr_auto] aspect-[1.586] w-full rounded-[22px] p-[clamp(18px,5%,26px)] overflow-hidden text-[#e8e8eb] [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] transition-transform duration-500 ease-out-expo focus-ring"
            >
                <div className="relative flex items-center justify-between">
                    <span className="text-[11px] font-medium tracking-[0.32em] [font-stretch:125%] text-[#b9b9be]">FINASSIST</span>
                    <span className="metal-chip grid place-items-center w-[34px] h-[26px] rounded-md text-[10px] font-semibold tracking-[0.1em] [font-stretch:125%]">FA</span>
                </div>

                <div className="relative self-stretch grid grid-rows-[auto_auto_1fr] gap-2 sm:pt-2">
                    <span className="label-caps text-[#a9a9ae]">Wallet</span>
                    <span className="text-[clamp(1.9rem,8vw,2.6rem)] font-light [font-stretch:118%] leading-none tracking-[-0.01em] text-[#ededf0] [text-shadow:0_-1px_0_rgb(0_0_0/0.6),0_1px_0_rgb(255_255_255/0.1)]">
                        {loading ? <span aria-hidden className="inline-block h-[1em] w-40 rounded-md bg-white/10 animate-pulse align-middle" />
                            : failed || wallet === undefined ? <Missing className="text-[#77777c]" />
                            : <RollingNumber text={fmt.format(wallet)} delay={600} />}
                    </span>
                    {/* The trace sits centred in the band between the amount and the savings line. */}
                    <span aria-hidden className="grid items-center -mx-[clamp(18px,5%,26px)]">{trace && <Trace values={trace} className="h-4 sm:h-5 w-full" />}</span>
                </div>

                <div className="relative flex items-end justify-between gap-3 text-[10.5px] font-medium tracking-[0.16em] [font-stretch:118%] uppercase text-[#b3b3b8]">
                    <span>
                        Savings
                        <b className="block mt-1.5 text-[15px] font-normal tracking-normal normal-case [font-stretch:112%] text-[#e2e2e6] tabular-nums">
                            {loading ? <span aria-hidden className="inline-block h-[1em] w-16 rounded bg-white/10 animate-pulse align-middle" />
                                : savings === undefined ? <Missing className="text-[#77777c]" /> : fmt.format(savings)}
                        </b>
                    </span>
                    <span className="max-w-[55%] truncate text-right">{name}</span>
                </div>
            </Link>
        </motion.div>
    );
}
