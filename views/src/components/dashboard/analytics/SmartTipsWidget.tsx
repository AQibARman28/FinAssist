"use client";

import { Clapperboard, Lightbulb, PiggyBank, Scale, Utensils } from "lucide-react";
import { Card, Empty, Skeleton } from "../ui";
import { LoadError } from "../LoadNotice";

// One tip from GET /ai/smart-tips. They come from fixed rules about this
// month's spending against income (controllers/aiController.js), not a model.
export interface Tip {
    category: string;
    message: string;
}

// A short line for each rule the server has; anything new falls back to its
// category name.
const HEADLINE: Record<string, string> = {
    Food: "Food is taking a big share",
    Entertainment: "Entertainment is taking a big share",
    Savings: "A surplus you could put to work",
    Budget: "Spending has passed income",
};
const ICON: Record<string, typeof Lightbulb> = {
    Food: Utensils,
    Entertainment: Clapperboard,
    Savings: PiggyBank,
    Budget: Scale,
};

// What to change, as rows: a quiet icon, the point in a few words, and the
// tip itself under it.
export function SmartTipsWidget({ tips, loading, failed, onRetry, className }: {
    tips: Tip[] | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    className?: string;
}) {
    const rows = tips ?? [];
    return (
        <Card title="Tips" id="tips" className={className} aside={<span className="label-caps text-zinc-400">Rule-based</span>}>
            {loading ? (
                <div aria-hidden className="grid md:grid-cols-2 gap-x-10 gap-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : failed ? (
                <LoadError what="your tips" onRetry={onRetry} className="py-6" />
            ) : rows.length === 0 ? (
                <Empty title="No tips right now" className="py-8">
                    Tips appear here when something in this month&apos;s spending stands out against your income.
                </Empty>
            ) : (
                <ul className="grid md:grid-cols-2 gap-x-10">
                    {rows.map((tip, i) => {
                        const Icon = ICON[tip.category] ?? Lightbulb;
                        return (
                            <li key={`${tip.category}-${i}`} className="flex gap-3.5 py-4 border-t border-white/[0.07] first:border-t-0 first:pt-0 md:[&:nth-child(2)]:border-t-0 md:[&:nth-child(2)]:pt-0">
                                <Icon aria-hidden className="w-[18px] h-[18px] mt-0.5 shrink-0 text-zinc-400" />
                                <span className="min-w-0">
                                    <span className="block font-semibold text-white">{HEADLINE[tip.category] ?? tip.category}</span>
                                    <span className="mt-1 block text-[13.5px] leading-relaxed text-zinc-400 max-w-prose">{tip.message}</span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
}
