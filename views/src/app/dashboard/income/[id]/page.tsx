"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { IncomeForm, IncomeFormFrame } from "@/components/dashboard/income/IncomeForm";
import { Notice, Skeleton } from "@/components/dashboard/ui";

interface IncomeApi {
    _id: string;
    amount: number;
    category: string;
    description: string;
    date: string;
    isRecurring: boolean;
    recurringFrequency?: "weekly" | "biweekly" | "monthly" | "yearly";
    isPostTax: boolean;
    note?: string | null;
}

export default function EditIncomePage() {
    const params = useParams<{ id: string }>();
    const id = params.id;

    const [loaded, setLoaded] = useState<IncomeApi | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]   = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await api.get(`/incomes/${id}`);
                if (!cancelled) setLoaded(res.data?.data ?? null);
            } catch (err: unknown) {
                if (!cancelled) setError(apiErrorMessage(err, "Failed to load income"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [id]);

    return (
        <IncomeFormFrame mode="edit">
            {loading ? (
                <>
                    <p role="status" className="sr-only">Loading this income entry</p>
                    {/* The form's shape: two fields side by side, then full-width rows. */}
                    <div aria-hidden className="p-5 md:p-7 rounded-3xl bg-graphite space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5"><Skeleton className="h-[76px]" /><Skeleton className="h-[76px]" /></div>
                        <Skeleton className="h-[76px]" />
                        <Skeleton className="h-[76px]" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Skeleton className="h-[92px]" /><Skeleton className="h-[92px]" /></div>
                        <Skeleton className="h-[76px]" />
                    </div>
                </>
            ) : error || !loaded ? (
                <div role="alert">
                    <Notice tone="bad" action={<Link href="/dashboard/income" className="btn-secondary">Back to Income</Link>}>
                        {error || "Income not found"}
                    </Notice>
                </div>
            ) : (
                <IncomeForm
                    mode="edit"
                    incomeId={loaded._id}
                    initial={{
                        amount:             String(loaded.amount),
                        category:           loaded.category,
                        description:        loaded.description,
                        date:               new Date(loaded.date).toISOString().split("T")[0],
                        isRecurring:        loaded.isRecurring,
                        recurringFrequency: loaded.recurringFrequency ?? "",
                        isPostTax:          loaded.isPostTax,
                        note:               loaded.note ?? "",
                    }}
                />
            )}
        </IncomeFormFrame>
    );
}
