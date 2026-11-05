"use client";

import Link from "next/link";
import { CircleAlert, CircleCheck, Minus, TriangleAlert } from "lucide-react";
import { Card, Empty, Meter, Skeleton, StateNote } from "../ui";
import { RollingNumber } from "../home/RollingNumber";
import { LoadError } from "../LoadNotice";
import { factorState } from "@/lib/healthFactor";

interface Factor {
    label: string;
    score: number | null;
    weight: number;
    detail: string;
    // The detail names something to fix (lib/healthFactor.ts).
    attention?: boolean;
}

// GET /ai/financial-health-score (services/healthScore.js).
export interface HealthData {
    status: "ok" | "building";
    score: number | null;
    band: string | null;
    factors: Factor[];
    contributor: { label: string; score: number } | null;
    detractor: { label: string; score: number } | null;
    message: string;
}

function BandNote({ band }: { band: string }) {
    const cls = "text-sm text-zinc-100";
    if (band === "Good" || band === "Excellent") return <StateNote tone="good" icon={CircleCheck} className={cls}>{band}</StateNote>;
    if (band === "Fair") return <StateNote tone="warn" icon={TriangleAlert} className={cls}>{band}</StateNote>;
    return <StateNote tone="bad" icon={CircleAlert} className={cls}>{band}</StateNote>;
}

// The financial health score in full: the score extra-wide and light, its
// band in words, and each weighted factor with its own thin meter. It is
// worked out by fixed rules, and the header says so.
export function FinancialHealthScore({ health, loading, failed, onRetry, className }: {
    health: HealthData | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    className?: string;
}) {
    return (
        <Card title="Health score" id="health-score" className={className} aside={<span className="label-caps text-zinc-400">Rule-based</span>}>
            {loading ? (
                <div aria-hidden className="space-y-5">
                    <Skeleton className="h-[4.25rem] w-40 rounded-xl" />
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
                </div>
            ) : failed || !health ? (
                <LoadError what="your health score" onRetry={onRetry} className="py-6" />
            ) : health.status === "building" || health.score === null ? (
                <Empty
                    title="No score yet"
                    className="py-8"
                    action={
                        <div className="flex flex-wrap justify-center gap-2">
                            <Link href="/dashboard/budgets" className="btn-primary">Set a budget</Link>
                            <Link href="/dashboard/income" className="btn-secondary">Log income</Link>
                        </div>
                    }
                >
                    {health.message}
                </Empty>
            ) : (
                <>
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <RollingNumber text={String(health.score)} className="figure-wide text-[4.25rem] text-white" />
                        <span className="text-sm text-zinc-300">out of 100</span>
                    </p>
                    {health.band && <div className="mt-1"><BandNote band={health.band} /></div>}
                    {health.message && <p className="mt-3 text-sm text-zinc-300 max-w-prose">{health.message}</p>}

                    {health.factors.length > 0 && (
                        <ul className="mt-6 pt-5 border-t border-white/[0.07] space-y-4">
                            {health.factors.map((f, i) => {
                                const state = factorState(f);
                                const counted = state !== "uncounted";
                                const weak = state === "attention";
                                return (
                                    <li key={f.label}>
                                        <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                                            <span className="font-semibold text-white">{f.label}</span>
                                            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{counted ? `${f.weight}% of score` : "Not counted"}</span>
                                        </div>
                                        {counted && <Meter fraction={(f.score as number) / 100} tone={weak ? "warn" : "plat"} size="sm" delay={i * 0.08} className="mt-2 mb-1.5" />}
                                        <StateNote
                                            tone={!counted ? "neutral" : weak ? "warn" : "good"}
                                            icon={!counted ? Minus : weak ? TriangleAlert : CircleCheck}
                                            className={counted ? "text-zinc-400" : "mt-1 text-zinc-400"}
                                        >
                                            {f.detail}{counted && <span className="sr-only">, scoring {f.score} out of 100</span>}
                                        </StateNote>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <p className="mt-5 text-[12.5px] text-zinc-400 max-w-prose">
                        Worked out from the last 90 days. A factor without data is left out and the others share its weight.
                    </p>
                </>
            )}
        </Card>
    );
}
