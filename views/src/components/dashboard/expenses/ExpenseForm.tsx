"use client";

import { useState } from "react";
import { Plus, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { CategoryPicker } from "@/components/CategoryPicker";

interface ExpenseFormProps {
    onAdd: () => void;
}

export function ExpenseForm({ onAdd }: ExpenseFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        title: "",                                  // backend field: description
        amount: "",
        category: "" as string,                     // backend field: category (ObjectId)
        date: new Date().toISOString().split("T")[0],
        note: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setServerError(null);
        setCategoryError(null);

        if (!formData.title || !formData.amount) return;
        if (!formData.category) {
            setCategoryError("Pick a category");
            return;
        }

        setIsLoading(true);
        try {
            await api.post("/expenses", {
                description: formData.title,
                amount:      parseFloat(formData.amount),
                category:    formData.category,
                date:        formData.date,
                ...(formData.note ? { note: formData.note } : {}),
            });
            setFormData({ ...formData, title: "", amount: "", note: "" });
            onAdd();
        } catch (err: any) {
            const errs = err.response?.data?.errors;
            if (errs?.category) setCategoryError(errs.category);
            setServerError(
                err.response?.data?.message
                || (errs && Object.values(errs).join(", "))
                || "Failed to add expense"
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 mb-6">
            <h3 className="text-white font-medium mb-4">Add New Expense</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex flex-col md:flex-row gap-4 md:items-end">

                    <div className="w-full md:flex-1 space-y-2 min-w-0">
                        <label className="text-xs text-zinc-500">What was it for?</label>
                        <input
                            type="text"
                            placeholder="e.g. Starbucks, Uber"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                            required
                        />
                    </div>

                    <div className="w-full md:w-32 space-y-2">
                        <label className="text-xs text-zinc-500">Amount</label>
                        <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={formData.amount}
                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors tabular-nums"
                            required
                        />
                    </div>

                    <div className="w-full md:w-44 space-y-2">
                        <label className="text-xs text-zinc-500">Date</label>
                        <input
                            type="date"
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 transition-colors tabular-nums"
                            required
                        />
                    </div>

                    <div className="w-full md:w-48 space-y-2">
                        <label className="text-xs text-zinc-500">Category</label>
                        <CategoryPicker
                            type="expense"
                            value={formData.category}
                            onChange={(id) => { setFormData({ ...formData, category: id }); setCategoryError(null); }}
                            error={categoryError ?? undefined}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full md:w-auto px-6 py-3 bg-white text-black font-medium rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                        <span>Add</span>
                    </button>
                </div>

                <div className="space-y-2">
                    <label className="text-xs text-zinc-500">Private note (optional)</label>
                    <textarea
                        placeholder="Visible only to you"
                        value={formData.note}
                        onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                        rows={2}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors resize-y"
                    />
                </div>

                {serverError && !categoryError && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{serverError}</span>
                    </div>
                )}
            </form>
        </div>
    );
}
