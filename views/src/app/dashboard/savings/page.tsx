"use client";

import { useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, PiggyBank } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { calendarDay, formatDay } from "@/lib/dates";
import { savingsByMonth } from "@/lib/savings";
import { ColumnChart } from "@/components/dashboard/ColumnChart";
import { LoadError } from "@/components/dashboard/LoadNotice";
import { Card, Empty, FieldError, FieldLabel, HeroFigure, Page, PageHeader, Segmented, Skeleton, Term } from "@/components/dashboard/ui";

interface Entry {
    _id: string;
    amount: number;
    direction: "deposit" | "withdraw";
    source: "manual" | "rollover";
    note?: string;
    date: string;
}
interface SavingsData {
    balance: number;
    wallet: number;
    entries: Entry[];
}

type Mode = "deposit" | "withdraw";

// Enough history rows to end level with the chart beside them.
const HISTORY_ROWS = 5;

export default function SavingsPage() {
    const money = useCurrency();
    const { format: fmt, currency } = money;
    // Cached; a deposit or withdrawal is a write, which refreshes it in the
    // background, so the page never blanks to a spinner after each one.
    const savings = useApi<SavingsData>("/savings");
    const data = savings.data ?? null;
    const loading = savings.isLoading;
    const failed = !data && savings.error !== undefined;
    const [mode, setMode] = useState<Mode>("deposit");
    const [amount, setAmount] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);
    const [now] = useState(() => new Date());
    const ids = { amount: useId(), hint: useId(), error: useId() };

    const months = useMemo(() => (data ? savingsByMonth(data.entries, now) : []), [data, now]);
    const thisMonth = months.at(-1)?.net ?? 0;
    const entries = data?.entries ?? [];
    const shown = showAll ? entries : entries.slice(0, HISTORY_ROWS);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (!value || value <= 0) { setError("Enter an amount above 0."); return; }
        // The limit is in the hint below; say it here before the server does.
        if (data && mode === "deposit" && value > data.wallet) { setError("That's more than is in your wallet."); return; }
        if (data && mode === "withdraw" && value > data.balance) { setError("That's more than is in your savings."); return; }
        setSubmitting(true);
        setError(null);
        try {
            await api.post(`/savings/${mode}`, { amount: value });
            setAmount("");
        } catch (err) {
            const e2 = err as { response?: { data?: { message?: string } } };
            setError(e2.response?.data?.message || `Couldn't ${mode}.`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Page>
            <PageHeader title="Savings" sub="Money set aside from your wallet. Move it in or out whenever you need it." />

            {failed ? (
                <Card><LoadError what="your savings" onRetry={() => { void savings.refresh(); }} /></Card>
            ) : (
                <>
                    <div className="grid gap-6 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] items-center py-2 md:py-4">
                        <HeroFigure label="In savings" value={data ? fmt(data.balance) : null} loading={loading}>
                            <dl className="mt-6 grid grid-cols-2 gap-6 sm:flex sm:gap-x-12">
                                <Term label="In your wallet">{data ? fmt(data.wallet) : "…"}</Term>
                                <Term label="This month">
                                    {data ? `${thisMonth > 0 ? "+" : thisMonth < 0 ? "−" : ""}${fmt(Math.abs(thisMonth))}` : "…"}
                                </Term>
                            </dl>
                        </HeroFigure>

                        <Card title="Move money" id="move-money">
                            <Segmented<Mode>
                                label="Direction"
                                value={mode}
                                onChange={(m) => { setMode(m); setError(null); }}
                                items={[
                                    { key: "deposit", label: "Add to savings", icon: ArrowDownToLine },
                                    { key: "withdraw", label: "Withdraw", icon: ArrowUpFromLine },
                                ]}
                            />
                            <form onSubmit={submit} className="mt-5 space-y-4">
                                <div>
                                    <FieldLabel htmlFor={ids.amount}>Amount ({currency})</FieldLabel>
                                    <input
                                        id={ids.amount}
                                        type="number" min={1} step="any" inputMode="decimal" placeholder="e.g. 500"
                                        value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }}
                                        aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
                                        aria-invalid={error ? true : undefined}
                                        className="field tabular-nums"
                                        required
                                    />
                                    {error && <FieldError id={ids.error}>{error}</FieldError>}
                                    <p id={ids.hint} className="mt-2 text-[12.5px] text-zinc-400 tabular-nums">
                                        {!data ? " " : mode === "deposit"
                                            ? `You can set aside up to ${fmt(data.wallet)} from your wallet.`
                                            : `You can move up to ${fmt(data.balance)} back to your wallet.`}
                                    </p>
                                </div>
                                <button type="submit" disabled={submitting || !data} className="btn-primary w-full">
                                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">Moving</span></> : mode === "deposit" ? "Move to savings" : "Move to wallet"}
                                </button>
                            </form>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
                        <Card title="Savings by month" id="savings-by-month" className="lg:col-span-7">
                            {loading || !data ? (
                                <Skeleton className="h-[300px]" />
                            ) : (
                                <>
                                    <ColumnChart
                                        title="Savings balance at the end of each month"
                                        rows={months.map((m) => ({ key: m.key, label: m.label, title: m.title, values: [m.closing] }))}
                                        series={[{ label: "Balance", tone: "plat" }]}
                                        fmt={money}
                                    />
                                    <p className="mt-3 text-[12.5px] text-zinc-400">Each bar is what you had saved at the end of that month.</p>
                                </>
                            )}
                        </Card>

                        <Card title="History" id="savings-history" className="lg:col-span-5"
                            aside={entries.length > 0 ? <span className="label-caps text-zinc-400">{entries.length} move{entries.length === 1 ? "" : "s"}</span> : undefined}>
                            {loading || !data ? (
                                <div aria-hidden className="space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
                            ) : entries.length === 0 ? (
                                <Empty icon={PiggyBank} title="Nothing saved yet" className="py-8">
                                    Move some money from your wallet and it shows up here.
                                </Empty>
                            ) : (
                                <>
                                    <ul>
                                        {shown.map((e) => {
                                            const isDeposit = e.direction === "deposit";
                                            const day = calendarDay(e.date);
                                            return (
                                                <li key={e._id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 py-3.5 border-t border-white/[0.07] first:border-t-0 first:pt-0">
                                                    <span aria-hidden className="grid justify-items-center leading-none text-zinc-400">
                                                        <b className="text-[23px] font-light [font-stretch:112%] text-white">{day.getDate()}</b>
                                                        <span className="mt-1.5 text-[10.5px] font-medium tracking-[0.14em] [font-stretch:118%] uppercase">{format(day, "MMM")}</span>
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block truncate font-semibold text-white">{e.note || (isDeposit ? "Added to savings" : "Moved to wallet")}</span>
                                                        <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-zinc-400">
                                                            {isDeposit ? <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden /> : <ArrowUpFromLine className="w-3.5 h-3.5" aria-hidden />}
                                                            <span className="truncate">{isDeposit ? "Into savings" : "Out to wallet"}{e.source === "rollover" ? " · month-end" : ""} · {formatDay(e.date, now)}</span>
                                                        </span>
                                                    </span>
                                                    <span className="font-medium text-white tabular-nums shrink-0">{isDeposit ? "+" : "−"}{fmt(e.amount)}</span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    {entries.length > HISTORY_ROWS && (
                                        <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="btn-quiet -ml-3 mt-2 text-plat hover:text-white">
                                            {showAll ? "Show fewer" : `Show all ${entries.length}`}
                                        </button>
                                    )}
                                </>
                            )}
                        </Card>
                    </div>
                </>
            )}
        </Page>
    );
}
