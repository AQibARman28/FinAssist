"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { IncomeForm } from "@/components/dashboard/income/IncomeForm";

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
            } catch (err: any) {
                if (!cancelled) setError(err.response?.data?.message || "Failed to load income");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [id]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
        );
    }

    if (error || !loaded) {
        return (
            <div className="p-6 max-w-2xl mx-auto">
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error || "Income not found"}</span>
                </div>
            </div>
        );
    }

    return (
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
    );
}
