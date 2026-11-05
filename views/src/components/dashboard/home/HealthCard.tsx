"use client";

import { motion } from "framer-motion";
import { CircleCheck, Minus, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { factorState } from "@/lib/healthFactor";
import { CardLink, Card, StateNote } from "../ui";
import { RollingNumber } from "./RollingNumber";
import { LoadError } from "../LoadNotice";

export interface HealthFactor {
    label: string;
    weight: number;
    // null: no data yet, so the factor isn't counted.
    score: number | null;
    detail: string;
    // The detail names something to fix (lib/healthFactor.ts).
    attention?: boolean;
}

export interface Health {
    status: "ok" | "building";
    score: number | null;
    band: string | null;
    message?: string;
    factors?: HealthFactor[];
}

// The financial health score with what moves it: five weighted factors, each
// with its own bar. The score is rule-based (PRODUCT.md › Claim only what
// ships), and the label says so.
export function HealthCard({ health, loading, failed, onRetry, className }: {
    health: Health | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    className?: string;
}) {
    const ok = health?.status === "ok" && health.score !== null;
    const good = ok && (health.band === "Good" || health.band === "Excellent");
    return (
        <Card title="Health" id="health" className={className} aside={<span className="label-caps text-zinc-400">Rule-based</span>}>
            {loading ? (
                <div aria-hidden className="space-y-4"><div className="h-16 w-40 rounded-xl bg-white/[0.05] animate-pulse" />{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-white/[0.05] animate-pulse" />)}</div>
            ) : failed || !health ? (
                <LoadError what="your health score" onRetry={onRetry} className="py-6" />
            ) : !ok ? (
                <p className="text-sm text-zinc-300 max-w-prose">Your score starts once you&apos;ve added income or a budget. <CardLink href="/dashboard/analytics">How it works</CardLink></p>
            ) : (
                <>
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <RollingNumber text={String(health.score)} className="figure-wide text-[4.25rem] text-white" />
                        <span className="text-sm text-zinc-300">out of 100 · <StateNote tone={good ? "good" : "warn"} icon={good ? CircleCheck : TriangleAlert} className="text-sm text-zinc-100">{health.band}</StateNote></span>
                    </p>
                    {health.message && <p className="mt-3 text-sm text-zinc-300 max-w-prose">{health.message}</p>}
                    {!!health.factors?.length && (
                        <ul className="mt-5 space-y-3">
                            {health.factors.map((f, i) => {
                                const state = factorState(f);
                                const weak = state === "attention";
                                return (
                                    <li key={f.label}>
                                        <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                                            <span className="font-semibold text-white">{f.label}</span>
                                            <span className="shrink-0 text-xs text-zinc-500">{state === "uncounted" ? "Not counted" : `${f.weight}% of score`}</span>
                                        </div>
                                        {state === "uncounted" ? (
                                            <StateNote tone="neutral" icon={Minus} className="mt-1 text-zinc-400">{f.detail}</StateNote>
                                        ) : (
                                            <>
                                                <div aria-hidden className="mt-2 mb-1.5 h-1 rounded-full bg-plat/[0.12] overflow-hidden">
                                                    <motion.div
                                                        className={cn("h-full rounded-full", weak ? "bg-amber-400" : "bg-plat")}
                                                        style={{ width: `${Math.max(0, Math.min(100, f.score ?? 0))}%`, originX: 0 }}
                                                        initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                                                        transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                                                    />
                                                </div>
                                                <StateNote tone={weak ? "warn" : "good"} icon={weak ? TriangleAlert : CircleCheck} className="text-zinc-400">
                                                    {f.detail}<span className="sr-only">, scoring {f.score} out of 100</span>
                                                </StateNote>
                                            </>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <div className="mt-4"><CardLink href="/dashboard/analytics">See the breakdown</CardLink></div>
                </>
            )}
        </Card>
    );
}
