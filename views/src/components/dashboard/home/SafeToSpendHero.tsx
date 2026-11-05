import Link from "next/link";
import { format } from "date-fns";
import { Info, TriangleAlert } from "lucide-react";
import type { SafeToSpend } from "@/lib/dashboard";
import type { MoneyFormatter } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Missing } from "../ui";
import { RollingNumber } from "./RollingNumber";

function untilText(s: SafeToSpend): string {
    if (s.untilKind === "monthEnd") return s.days === 1 ? "for today, the last day of the month." : `for the ${s.days} days left this month.`;
    const on = format(s.until, "EEE d MMM");
    return s.days === 1 ? `for today. Your next income arrives tomorrow, ${on}.` : `for the next ${s.days} days, until your next income on ${on}.`;
}

// Today against the daily amount. It fills as the day's expenses are added;
// past the amount it says so in words, with a warning mark.
function TodayMeter({ spent, perDay, fmt }: { spent: number; perDay: number; fmt: MoneyFormatter }) {
    const over = spent > perDay;
    return (
        <div className="mt-7 max-w-md">
            <div className="flex items-baseline justify-between gap-3 text-[13.5px] text-zinc-300">
                <span>Spent today</span>
                <span className="tabular-nums"><span className="font-semibold text-white">{fmt.format(spent)}</span> of {fmt.format(perDay)}</span>
            </div>
            <div aria-hidden className="mt-2.5 h-1.5 rounded-full bg-plat/15 overflow-hidden">
                <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out-expo", over ? "bg-amber-400" : "bg-plat")} style={{ width: `${Math.min(100, (spent / perDay) * 100)}%` }} />
            </div>
            <p className="mt-2 text-[12.5px] text-zinc-400">
                {over
                    ? <span className="inline-flex items-center gap-1.5 text-zinc-300"><TriangleAlert className="w-[15px] h-[15px] text-amber-300" aria-hidden />{fmt.format(spent - perDay)} over today&apos;s amount. Tomorrow&apos;s will be a little lower.</span>
                    : spent > 0 ? `${fmt.format(perDay - spent)} left for today.` : "The bar fills as you add today's expenses."}
            </p>
        </div>
    );
}

// The one answer the dashboard leads with: how much a day is safe to spend
// until money next comes in, set extra-wide and light at display size.
export function SafeToSpendHero({
    stats, wallet, spentToday, loading, failed, needsIncome = false, fmt, className,
}: {
    stats: SafeToSpend | null;
    wallet: number | undefined;
    // Today's spending so far, once the day-by-day read has arrived.
    spentToday: number | undefined;
    loading: boolean;
    failed: boolean;
    // No income recorded yet: there is nothing to divide, so ask for it.
    needsIncome?: boolean;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const showFigure = !loading && !failed && !!stats && wallet !== undefined && !needsIncome && stats.over === 0 && stats.perDay > 0;
    return (
        <section aria-labelledby="safe-to-spend" className={cn("min-w-0", className)}>
            <h2 id="safe-to-spend" className="label-caps text-zinc-400">Safe to spend</h2>

            {loading ? (
                <div aria-hidden className="mt-4 space-y-4">
                    <div className="h-20 md:h-28 w-72 max-w-full rounded-2xl bg-white/[0.05] animate-pulse" />
                    <div className="h-4 w-80 max-w-full rounded-md bg-white/[0.05] animate-pulse" />
                </div>
            ) : failed || !stats || wallet === undefined ? (
                <p className="mt-3 figure-wide text-7xl"><Missing /></p>
            ) : needsIncome ? (
                <>
                    <p className="mt-3 text-3xl md:text-4xl font-light [font-stretch:112%] text-white">Add your income first</p>
                    <p className="mt-3 text-[15px] text-zinc-300 max-w-prose">
                        FinAssist works out a safe amount per day from what comes in.
                        {stats.over > 0 && <> So far you&apos;ve spent <span className="text-white font-medium tabular-nums">{fmt.format(stats.over)}</span>.</>}
                    </p>
                    <Link href="/dashboard/income/new" className="mt-6 inline-flex items-center justify-center min-h-11 px-5 rounded-full bg-plat text-plat-ink text-sm font-semibold hover:bg-white transition-colors focus-ring">
                        Add income
                    </Link>
                </>
            ) : stats.over > 0 ? (
                <>
                    <p className="mt-3 text-3xl md:text-4xl font-light [font-stretch:112%] text-white">Nothing left to spend</p>
                    <p className="mt-3 text-[15px] text-zinc-300 max-w-prose">
                        Your wallet is <span className="text-red-300 font-medium tabular-nums">{fmt.format(stats.over)}</span> below zero.{" "}
                        {stats.untilKind === "income"
                            ? `Your next income arrives on ${format(stats.until, "EEE d MMM")}.`
                            : "It carries into next month, so your balance stays honest."}
                    </p>
                </>
            ) : stats.perDay === 0 ? (
                <>
                    <p className="mt-3 text-3xl md:text-4xl font-light [font-stretch:112%] text-white">Nothing to spend yet</p>
                    <p className="mt-3 text-[15px] text-zinc-300 max-w-prose">Add your income and this shows what you can spend each day.</p>
                </>
            ) : (
                <>
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-white">
                        <RollingNumber text={fmt.format(stats.perDay)} delay={200} className="figure-wide text-[clamp(4rem,11vw,7.5rem)]" />
                        <span className="text-xl text-zinc-300">a day</span>
                    </p>
                    <p className="mt-4 text-base md:text-[17px] text-zinc-300 max-w-prose">{untilText(stats)}</p>
                </>
            )}

            {showFigure && stats && wallet !== undefined && (
                <>
                    {spentToday !== undefined && <TodayMeter spent={spentToday} perDay={stats.perDay} fmt={fmt} />}
                    <details className="mt-4">
                        <summary className="inline-flex items-center gap-1.5 min-h-11 -ml-1 px-1 rounded-lg text-[12.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer list-none [&::-webkit-details-marker]:hidden focus-ring">
                            <Info className="w-3.5 h-3.5" aria-hidden /> How this is worked out
                        </summary>
                        <p className="mt-1 text-[13px] text-zinc-300 max-w-prose">
                            Your wallet as today began ({fmt.format(wallet + (spentToday ?? 0))}) divided by the {stats.days} {stats.days === 1 ? "day" : "days"}{" "}
                            {stats.untilKind === "income" ? "until your next income" : "left this month"}, rounded down. It stays the same until tomorrow.
                            Nothing is held back for goals; what they need is shown under Goals. What you don&apos;t spend carries into next month.
                        </p>
                    </details>
                </>
            )}
        </section>
    );
}
